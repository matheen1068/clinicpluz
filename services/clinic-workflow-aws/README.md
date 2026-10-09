# ClinicPluz synthetic staging clinic workflow

This service implements staff reception and a first nurse-to-doctor consultation flow behind the existing staff sign-in. Reception and consultation passed Goodwell synthetic staging checks on 2026-10-10. The medicine shortlist changes in this branch have **not** been deployed. Neither slice is ready for real clinic records. The shared product contracts are in `docs/CLINIC_WORKFLOW_V1.md` and `docs/CONSULTATION_V1.md`.

## API and access boundary

The same-origin routes are under `/api/workflow/clinics/:slug`:

| Method | Path | Entitlement | Result |
| --- | --- | --- | --- |
| GET | `/doctors` | `appointments` | Active doctor roster |
| POST | `/patients/search` | `patient_intake` | Prefix search from JSON `{ "query": "..." }` |
| POST | `/patients` | `patient_intake` | Register with name, phone, integer `ageYears`, sex, optional email |
| GET | `/appointments?date=YYYY-MM-DD` | `appointments` | Clinic-local date list |
| POST | `/appointments` | `appointments` | Book with `patientId`, `doctorId`, timezone-bearing `startAt`, and `source` |
| GET | `/consultations?date=YYYY-MM-DD` | `consultations` | Nurse clinic queue or doctor-assigned queue |
| POST | `/consultations/read` | `consultations` | Read one encounter with IDs in the JSON body |
| POST | `/consultations/medicines/search` | `consultations` | Doctor searches the clinic's medicine shortlist by name or strength |
| POST | `/consultations/vitals` | `consultations` | Nurse or assigned doctor saves measured vitals |
| POST | `/consultations/draft` | `consultations` | Assigned doctor saves notes and medication entries |
| POST | `/consultations/finalize` | `consultations` | Assigned doctor finalizes a complete draft |

Every route requires the existing opaque `__Host-cpz_session` cookie and independently checks its hash in the auth table, expiry, clinic path, active clinic, active membership, Cognito user state, role, and the clinic's `ENTITLEMENTS` record. Only `clinic_admin`, `receptionist`, and `nurse` can access these first reception routes. Missing or disabled entitlement fails closed. POST additionally requires the exact configured `Origin` and the session's `X-CSRF-Token`; patient search is POST so names and phone numbers stay out of URLs. All responses are JSON with `Cache-Control: no-store`. No browser-supplied clinic ID, role, or entitlement grants access.

The consultation routes are separate clinician permissions: `nurse` can see the clinic queue, read patient identity and vitals, and record vitals; `doctor` sees only appointments whose persisted doctor roster item has `staffSub` equal to that doctor's authenticated Cognito `sub`. Only that doctor can read, draft, and finalize clinical notes and prescription entries for those appointments. A nurse's read response omits notes, medication entries, and print data. `clinic_admin`, receptionist, lab, and billing roles have no consultation access, even if an entitlement is enabled. An old entitlement map without `consultations` is interpreted as disabled for consultation while reception continues to work. The browser cannot supply `staffSub` or a doctor role.

### Clinic medicine shortlist

The doctor can search a **clinic-specific** shortlist while entering a prescription. Search fills only the selected item's name and strength; dose, route, frequency, duration, and instructions remain doctor-entered. The doctor can edit any populated text or enter a medicine manually when no item matches. A `favorite` flag sorts clinic-preferred items first, but is not a treatment recommendation. This does not perform medicine safety checks.

`POST /consultations/medicines/search` accepts only `{ "query": "..." }` with 2–64 letters/numbers and common name punctuation, after whitespace normalization. It returns at most 20 active matches as `{ "items": [{ "id", "name", "strength", "favorite" }] }`. It requires the existing doctor role, consultation entitlement, session, clinic match, Origin, and CSRF checks. No medicine text appears in the URL.

For the synthetic pilot, operators may create shortlist items in the existing **clinical** DynamoDB table. Each item has `pk` (String) = `CLINIC#goodwell#MEDICINES`, `sk` (String) = `MEDICINE#<unique-id>`, `id` (String) = the same unique ID, `name` (String, including dosage form when applicable), `strength` (String), `active` (Boolean) = `true`, and optional `favorite` (Boolean). Use only fictitious medicine names in staging. There is no global medicine list or automatic import. The pilot caps each clinic partition at 200 items; exceeding that limit fails closed until search indexing and pagination are designed. No new AWS resource or CloudFront behavior is needed, but the workflow SAM stack must be redeployed for the new route and the clinic frontend uploaded again.

### Exact consultation JSON contract

All consultation POST requests have `Content-Type: application/json`, an exact public `Origin`, and the authenticated `X-CSRF-Token`; identifiers go in the body, never in a URL. `appointmentId` is the server-issued appointment UUID and `clinicDate` is its local `YYYY-MM-DD` date. The server uses them only to look up the persisted appointment in the path clinic; it derives patient and doctor IDs from that row and verifies the patient and assigned roster doctor before returning clinical data.

| Method/path suffix | JSON request | Success |
| --- | --- | --- |
| `GET /consultations?date=YYYY-MM-DD` | none | `{ "items": [{ "appointmentId", "clinicDate", "patientId", "patientName", "doctorId", "doctorName", "startAt", "appointmentStatus", "encounterStatus" }] }` |
| `POST /consultations/read` | `{ "appointmentId", "clinicDate" }` | `{ "encounter": { ... } }` |
| `POST /consultations/medicines/search` | `{ "query" }` | `{ "items": [{ "id", "name", "strength", "favorite" }] }` |
| `POST /consultations/vitals` | `{ "appointmentId", "clinicDate", "expectedRevision", "vitals": { "observedAt", "systolicBpMmHg"?, "diastolicBpMmHg"?, "pulseBpm"?, "spo2Percent"?, "temperatureC"?, "weightKg"?, "heightCm"? } }` | `200` with updated `{ "encounter": { ... } }` |
| `POST /consultations/draft` | `{ "appointmentId", "clinicDate", "expectedRevision", "note": { "chiefComplaint", "history", "exam", "assessment", "plan" }, "medications": [{ "name", "strength", "dose", "route", "frequency", "duration", "instructions" }] }` | `200` with updated `{ "encounter": { ... } }` |
| `POST /consultations/finalize` | `{ "appointmentId", "clinicDate", "expectedRevision" }` | `200` with finalized `{ "encounter": { ... } }` and print payload only if medications exist |

`encounter` contains `appointmentId`, `clinicDate`, `status` (`draft` or `finalized`), numeric `revision`, `vitals`, `finalizedAt`, and server-sourced `patient:{id,fullName,ageYears,sex}`, `doctor:{id,displayName}`, and `clinic:{slug,displayName}`. For an assigned doctor it also contains the five-field `note` and medication array. Before the first save, an authorized read returns an unsaved draft at revision `0`, `vitals:null`, empty note strings, empty medications, and `finalizedAt:null`. A nurse receives the shared encounter fields but **no** `note` or `medications` properties. `encounterStatus` in the queue is `draft` for an unsaved or draft encounter and `finalized` after finalization.

Vitals need at least one finite numeric measurement. Both blood-pressure values must be supplied together. Their property names carry explicit units; `observedAt` is an ISO timestamp with `Z` or an offset, while `recordedAt`, `recordedBySub`, and `recordedByDisplayName` come from the server and appear on subsequent reads. Technical input bounds reject malformed data but make no medical judgment. Notes are capped at 3,000 characters per field; medication entries at 20, with bounded text. Draft fields may be incomplete. Finalization requires a nonempty assessment and plan and complete dosage instructions for every medication entry. Clinical decisions and medicine selection are entirely clinician-entered.

Every mutation increments `revision`; the caller must send the current `expectedRevision`. Stale writes and edits after finalization return `409`. Successful saves atomically write an audit event with actor, timestamp, action, and revision, without note or medicine text. Finalized encounters are immutable in this slice. `printablePrescription` is a **top-level sibling** of `encounter` only in an assigned doctor's read/finalize response when the server reports a finalized encounter with at least one medication. It contains `{clinic:{slug,displayName},doctor:{id,displayName},patient:{id,fullName,ageYears,sex},appointmentDate,finalizedAt,medications:[{name,strength,dose,route,frequency,duration,instructions}]}`. It is omitted for drafts, nurse reads, and finalized encounters without medication. The browser must escape clinician-entered text when rendering and print only this server-confirmed payload; the API does not create PDFs or send emails.

Finalization freezes the authenticated doctor's staff `sub`, staff display name, and appointment doctor ID inside the encounter. Later roster or staff-profile renaming cannot change the clinician shown on a reprint. A doctor whose roster assignment is removed loses access; another doctor who inherits that roster mapping cannot read the already finalized encounter because its finalizer `sub` differs. This identity snapshot improves attribution in the synthetic pilot but does not establish legal prescription readiness or verified clinician credentials.

An origin-only `X-ClinicPluz-Edge-Key` is checked before the session lookup. It is a boundary for the public API Gateway endpoint, not a substitute for staff authorization. Store it only in Secrets Manager and a CloudFront origin custom header. Do not send it from the browser or commit it. The service currently accepts a single exact `https://*.cloudfront.net` public origin for the synthetic staging host; owned clinic subdomains need a separately reviewed host-routing design.

## Separate data store and appointment behavior

`template.yaml` declares a dedicated DynamoDB clinical table with encryption, point-in-time recovery, and a retained deletion policy. It reads sessions, clinic status, memberships, and entitlements from the existing auth table; it never writes clinical records there. Clinical table partition keys start with `CLINIC#<slug>`. Registration transactionally writes one patient record, two bounded search lookups, and a PII-free audit event. Booking transactionally checks the patient and active doctor, claims a unique doctor/UTC-start slot, and writes the appointment and audit event. A competing booking for the same doctor slot returns `409` without a partial appointment.

Phone bookings start as `booked`; walk-ins start as `checked_in`. Both use the same 30-minute doctor slots and appear in the date list. A slot that has already ended is rejected; a walk-in may use the currently running slot. The pilot schedule is read per clinic from the clinical table. It is provisionally `Asia/Kolkata`, 09:30–18:30, with `:00` and `:30` starts and 18:00 as the last start. The service does not infer opening hours from the browser.

## Required synthetic setup before a connected test

The stack does **not** create clinic schedules, doctors, patients, or entitlements. Without the schedule item, appointment creation returns `503`; without an active doctor it cannot book; without `ENTITLEMENTS` every workflow route returns `403`. Goodwell's synthetic intake and appointment entitlements were exercised in the 2026-10-10 staging smoke test. An operator must review the following **synthetic** records for a clinic such as `goodwell`:

1. In the existing **auth table**, keep the clinic `CLINIC#goodwell / META` and staff `CLINIC#goodwell / STAFF#<username>` records established by `clinic-auth-aws`. Add or update the `CLINIC#goodwell / ENTITLEMENTS` item with string `clinicSlug=goodwell` and a DynamoDB map `modules` containing boolean `patient_intake=true` and `appointments=true`. Preserve any other module keys already managed by the Control Panel; do not replace its record blindly. A suitable active receptionist, nurse, or clinic admin membership and Cognito account are also required.
2. In the new **clinical table**, create one schedule item with `pk=CLINIC#goodwell#CONFIG`, `sk=SCHEDULE`, string `timezone=Asia/Kolkata`, numeric `openMinute=570`, numeric `closeMinute=1110`, and numeric `slotMinutes=30`. These are minutes after local midnight, so 570 is 09:30 and 1110 is 18:30. Treat this as pilot configuration, not a default for every clinic.
3. In the clinical table, create at least one synthetic active doctor item with `pk=CLINIC#goodwell#DOCTORS`, `sk=DOCTOR#doctor-001`, string `id=doctor-001`, string `displayName=Dr Demo`, and boolean `active=true`. The `id` must match the suffix after `DOCTOR#`. A reception-only roster entry can omit the consultation staff mapping below.
4. Confirm the clinic app's authenticated session works, then test the workflow through its own same-origin CloudFront path using **synthetic** patient details only. Repeat wrong-clinic and disabled-entitlement checks before widening access.

For the consultation slice, additionally set `modules.consultations=true` as a DynamoDB boolean in the **existing** clinic entitlement map without removing reception keys. Create active `nurse` and `doctor` memberships/Cognito accounts for synthetic staff. On each doctor roster item that should be accessible to a doctor, set string `staffSub` to that doctor's immutable Cognito `sub`; this is server-owned configuration and is not returned by `/doctors`. A missing or mismatched mapping hides the doctor's consultation queue and denies read/write for that appointment. Existing doctor roster entries without `staffSub` still work for reception scheduling. No new AWS table or public origin is required for consultation; the same workflow Lambda and clinical table receive additional route events.

The staging CloudFront `/api/*` behavior points at the auth API. The more specific `/api/workflow/*` behavior is already deployed above it and points at this service's HTTP API origin. Keep caching disabled and forward the staff cookie, `Origin`, `Content-Type`, and `X-CSRF-Token`. The workflow origin's `X-ClinicPluz-Edge-Key` value must match its own generated secret, distinct from the auth origin's secret; keep API Gateway's own `Host` header. Review `template.yaml`, IAM, secret rotation, and origin behavior before updating the consultation Lambda. This repository does not deploy the stack automatically.

## Checks and limits

With Node.js 24 available, run `npm test` for the pure domain/security tests and `npm run typecheck` after installing dependencies. The tests cover cross-clinic denial, role and entitlement gates, Cognito revocation, CSRF and private search, schedule boundaries, appointment conflict, doctor queue scoping, nurse vitals, doctor draft/finalization, print availability, stale revision, malformed input, and clinic medicine search. The medicine-search route and AWS adapter changes have not yet been built or validated by SAM, deployed, or tested against live DynamoDB.

This slice deliberately omits cancellation, rescheduling, doctor shifts, holidays, correction/addendum to finalized notes, clinical signatures/credentials, billing, and email dispatch. Search keys currently include plaintext normalized names and phone digits, and lookup rows duplicate patient fields. That data layout, privacy controls, retention, recovery, audit access, printed prescription legal fields, and operational monitoring need review before real patient data. `ageYears` is a registration snapshot, not a calculated current age. No real clinic or patient data should be entered into this synthetic staging service.

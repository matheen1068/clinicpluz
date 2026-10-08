# ClinicPluz synthetic staging reception workflow

This service implements the first Clinic App workflow behind the existing staff sign-in: list doctors, search or register a patient, and list or book a 30-minute appointment. It is a **reviewable staging implementation**, not a deployed service or a place for real clinic records. The shared product contract is in `docs/CLINIC_WORKFLOW_V1.md`.

## API and access boundary

The same-origin routes are under `/api/workflow/clinics/:slug`:

| Method | Path | Entitlement | Result |
| --- | --- | --- | --- |
| GET | `/doctors` | `appointments` | Active doctor roster |
| POST | `/patients/search` | `patient_intake` | Prefix search from JSON `{ "query": "..." }` |
| POST | `/patients` | `patient_intake` | Register with name, phone, integer `ageYears`, sex, optional email |
| GET | `/appointments?date=YYYY-MM-DD` | `appointments` | Clinic-local date list |
| POST | `/appointments` | `appointments` | Book with `patientId`, `doctorId`, timezone-bearing `startAt`, and `source` |

Every route requires the existing opaque `__Host-cpz_session` cookie and independently checks its hash in the auth table, expiry, clinic path, active clinic, active membership, Cognito user state, role, and the clinic's `ENTITLEMENTS` record. Only `clinic_admin`, `receptionist`, and `nurse` can access these first reception routes. Missing or disabled entitlement fails closed. POST additionally requires the exact configured `Origin` and the session's `X-CSRF-Token`; patient search is POST so names and phone numbers stay out of URLs. All responses are JSON with `Cache-Control: no-store`. No browser-supplied clinic ID, role, or entitlement grants access.

An origin-only `X-ClinicPluz-Edge-Key` is checked before the session lookup. It is a boundary for the public API Gateway endpoint, not a substitute for staff authorization. Store it only in Secrets Manager and a CloudFront origin custom header. Do not send it from the browser or commit it. The service currently accepts a single exact `https://*.cloudfront.net` public origin for the synthetic staging host; owned clinic subdomains need a separately reviewed host-routing design.

## Separate data store and appointment behavior

`template.yaml` declares a dedicated DynamoDB clinical table with encryption, point-in-time recovery, and a retained deletion policy. It reads sessions, clinic status, memberships, and entitlements from the existing auth table; it never writes clinical records there. Clinical table partition keys start with `CLINIC#<slug>`. Registration transactionally writes one patient record, two bounded search lookups, and a PII-free audit event. Booking transactionally checks the patient and active doctor, claims a unique doctor/UTC-start slot, and writes the appointment and audit event. A competing booking for the same doctor slot returns `409` without a partial appointment.

Phone bookings start as `booked`; walk-ins start as `checked_in`. Both use the same 30-minute doctor slots and appear in the date list. A slot that has already ended is rejected; a walk-in may use the currently running slot. The pilot schedule is read per clinic from the clinical table. It is provisionally `Asia/Kolkata`, 09:30–18:30, with `:00` and `:30` starts and 18:00 as the last start. The service does not infer opening hours from the browser.

## Required synthetic setup before a connected test

The stack does **not** create clinic schedules, doctors, patients, or entitlements. Without the schedule item, appointment creation returns `503`; without an active doctor it cannot book; without `ENTITLEMENTS` every workflow route returns `403`. The product owner reported creating Goodwell's synthetic intake and appointment entitlements on 2026-10-09, but the workflow API has not verified them yet. An operator must review the following **synthetic** records for a clinic such as `goodwell`:

1. In the existing **auth table**, keep the clinic `CLINIC#goodwell / META` and staff `CLINIC#goodwell / STAFF#<username>` records established by `clinic-auth-aws`. Add or update the `CLINIC#goodwell / ENTITLEMENTS` item with string `clinicSlug=goodwell` and a DynamoDB map `modules` containing boolean `patient_intake=true` and `appointments=true`. Preserve any other module keys already managed by the Control Panel; do not replace its record blindly. A suitable active receptionist, nurse, or clinic admin membership and Cognito account are also required.
2. In the new **clinical table**, create one schedule item with `pk=CLINIC#goodwell#CONFIG`, `sk=SCHEDULE`, string `timezone=Asia/Kolkata`, numeric `openMinute=570`, numeric `closeMinute=1110`, and numeric `slotMinutes=30`. These are minutes after local midnight, so 570 is 09:30 and 1110 is 18:30. Treat this as pilot configuration, not a default for every clinic.
3. In the clinical table, create at least one synthetic active doctor item with `pk=CLINIC#goodwell#DOCTORS`, `sk=DOCTOR#doctor-001`, string `id=doctor-001`, string `displayName=Dr Demo`, and boolean `active=true`. The `id` must match the suffix after `DOCTOR#`. This roster entry is independent of a staff account; doctor-to-staff mapping is future work.
4. Confirm the clinic app's authenticated session works, then test the workflow through its own same-origin CloudFront path using **synthetic** patient details only. Repeat wrong-clinic and disabled-entitlement checks before widening access.

The existing CloudFront `/api/*` behavior points at the auth API. A new, more specific `/api/workflow/*` behavior must target this service's HTTP API origin; otherwise these routes will reach the wrong API. Disable caching and forward the staff cookie, `Origin`, `Content-Type`, and `X-CSRF-Token`. Configure the generated edge secret as an origin custom header, and keep API Gateway's own `Host` header. Review `template.yaml`, IAM, secret rotation, and origin behavior before any deployment. This repository does not deploy the stack automatically.

## Checks and limits

With Node.js 24 available, run `npm test` for the pure domain/security tests and `npm run typecheck` after installing dependencies. The tests cover cross-clinic denial, role and entitlement gates, Cognito revocation, CSRF and private search, schedule boundaries, current versus ended slots, concurrent booking conflict, and same-clinic listing. The SAM template and AWS adapter have not been built, validated by SAM, deployed, or tested against live DynamoDB in this branch.

This slice deliberately omits cancellation, rescheduling, doctor shifts, holidays, pagination beyond its bounded search/list limits, clinical notes, billing, and email dispatch. Search keys currently include plaintext normalized names and phone digits, and lookup rows duplicate patient fields. That data layout, privacy controls, retention, recovery, audit access, and operational monitoring need review before real patient data. `ageYears` is a registration snapshot, not a calculated current age. Staff-to-doctor mapping is needed before a doctor-facing queue can safely be added. No real clinic or patient data should be entered into this synthetic staging service.

# Clinic App first workflow — implementation contract

Status: first synthetic staging slice deployed to the Goodwell demo on 2026-10-10. The product owner verified the flow described below. This is not approval for real patient data or production use.

## User flow

Authorized clinic staff can search or register a patient, select a doctor and an available 30-minute slot, and create an appointment. `phone` bookings begin as `booked`; `walk_in` bookings begin as `checked_in`. Both appear in the clinic's date-based appointment list. Patients never use this app directly. Name, phone, age in years, and sex are required at registration. Email is optional when unavailable; printouts are handled by the clinic. No WhatsApp integration.

The first UI is a working Clinic App module behind the existing authenticated shell, not a copy of the AI Studio prototype. The frontend must display loading, validation, empty, conflict, and service-error states. No patient records or mock credentials belong in the deployed bundle.

## Shared same-origin API contract

All routes are under `/api/workflow/clinics/:slug` and return JSON with `Cache-Control: no-store`. The browser sends the existing host-only staff session cookie. Every POST sends the authenticated `X-CSRF-Token` and exact public `Origin`. Identifiers and times below are strings; `startAt` is an ISO 8601 timestamp with timezone offset or `Z`. Do not place patient names or phone numbers in URL query strings.

| Method/path | Request | Successful result |
| --- | --- | --- |
| `GET /doctors` | none | `{ "items": [{ "id", "displayName" }] }` |
| `POST /patients/search` | `{ "query": "..." }`, at least 2 characters | `{ "items": [{ "id", "fullName", "phone", "ageYears", "sex", "email" }] }` |
| `POST /patients` | `{ "fullName", "phone", "ageYears", "sex", "email"? }` | `201` with `{ "patient": { "id", "fullName", "phone", "ageYears", "sex", "email" } }` |
| `GET /appointments?date=YYYY-MM-DD` | clinic-local calendar date | `{ "items": [{ "id", "patientId", "patientName", "doctorId", "doctorName", "startAt", "source", "status" }] }` |
| `POST /appointments` | `{ "patientId", "doctorId", "startAt", "source": "phone" | "walk_in" }` | `201` with `{ "appointment": { "id", "patientId", "doctorId", "startAt", "source", "status" } }` |

The backend owns slot conflict prevention: appointments occupy a 30-minute slot, with clinic-local starts at `:00` or `:30`. The pilot's provisional schedule is `Asia/Kolkata`, 09:30–18:30, with 18:00 as the last start. Treat these as clinic configuration, not a global product rule. A doctor cannot have two active appointments in the same slot, even under concurrent requests. Return `409` for an occupied slot. `ageYears` is an integer captured at registration, not a live age computed from birth date; record registration time so it is not mistaken for a perpetually current age. `sex` is one of `female`, `male`, `other`, or `undisclosed`. Do not treat phone number as a globally unique patient ID. Return `400` for invalid input, `401` for missing session, `403` for wrong clinic/role/module, and `503` for unavailable dependencies. No clinical notes, prescriptions, billing, or email dispatch are in this slice.

For this first reception workflow, `clinic_admin`, `receptionist`, and `nurse` may read the doctor roster, search/register patients, and list/create appointments. `doctor`, `lab_tech`, and `billing` have no access to these routes yet. A doctor-facing queue needs a reviewed mapping from the staff identity to the doctor record so doctors see only their assigned visits; that is a later slice. Patient routes require the `patient_intake` entitlement; doctor-roster and appointment routes require `appointments`. The UI may hide controls by role, but the backend must enforce this mapping independently.

## Security and data boundary

Use the clinic slug only as context. Every request must recheck the server-side session, active clinic, active staff membership and role; clinical routes must also enforce the relevant module entitlement on the server. A missing entitlement record fails closed. Keep clinical records in a dedicated data store keyed by clinic and do not put patient details in the auth table. Goodwell's synthetic `patient_intake` and `appointments` entitlements were exercised in the staging smoke test below. Use only synthetic patients and doctors until real-clinic privacy, audit, backups, recovery, and access controls are ready.

The CloudFront `/api/*` behavior points to the authentication API. The more specific `/api/workflow/*` behavior points to the workflow API and must remain above `/api/*` in behavior order. Forward the existing staff cookie, `Origin`, `Content-Type`, and `X-CSRF-Token`; disable caching. The two API origins use the same `X-ClinicPluz-Edge-Key` header name but different secret values. Keep those values out of browser code and source control. This staging deployment is not production approval.

## Goodwell staging smoke test — 2026-10-10

The product owner reported and showed the authenticated clinic workspace, a doctor-roster response containing the synthetic doctor, a successful phone booking visible in the date queue after page refresh, rejection of a second booking for the same doctor and slot, and `401 Not signed in` from the workflow API after sign-out. These checks show the first reception flow functioning on the staging CloudFront host. They do not establish two-clinic isolation, full role coverage, disaster recovery, or readiness for real patient records. Avoid storing real names, phone numbers, or clinical details in this synthetic environment.

## Open product details

The product owner confirmed 30-minute slots, required name/phone/age/sex, and provisional pilot hours of 09:30–18:30 in Asia/Kolkata. A future clinic-settings service must own timezone, opening hours, holidays, and doctor schedules. Until that exists, label the slot grid as a provisional synthetic pilot schedule and do not allow real patient bookings.

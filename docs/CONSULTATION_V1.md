# Clinic App consultation — synthetic pilot contract

Status: in development. The reception workflow has passed a Goodwell staging smoke test; this consultation slice has not been deployed or validated in AWS. Use fictional records only.

## Staff flow

An authorized nurse or doctor opens an existing clinic appointment and records measured vitals with explicit units, observation time, and author. A doctor assigned to that visit records the complaint, examination, assessment, plan, and doctor-entered prescription items. Work can be saved as a draft. Only the assigned doctor can finalize it; a finalized record is read-only in this slice. A correction or addendum workflow must be designed before real clinical use.

The clinic can print a **finalized** prescription using a browser print layout that identifies the clinic, patient, doctor, and date. A draft must never be presented as a final prescription. The application does not choose medicines, suggest doses, diagnose, or claim to check allergies or drug interactions. Clinicians remain responsible for clinical decisions.

## Access and data boundary

Keep all routes on the existing same-origin Clinic App API. The server must derive clinic and staff from the authenticated session and recheck active membership, role, appointment-to-patient linkage, assigned doctor, and a `consultations` entitlement on each request. Missing mapping or entitlement fails closed. Nurses and doctors may record vitals; only the assigned doctor may author or finalize notes and prescription items. Clinic admins may manage access but cannot author clinical records. Preserve the existing reception endpoints and treat absent `consultations` in older entitlement items as disabled rather than breaking reception.

Store consultation records under clinic-scoped keys. Audit creation, edits, and finalization with actor and time. Do not put patient names, phone numbers, note text, medicines, cookies, or CSRF tokens in URLs, logs, analytics, or browser storage. Use bounded inputs and keep cached API responses disabled. A browser role check is only a presentation aid; all permission checks belong on the server.

## Acceptance before a staging deploy

- Reception login, patient lookup, appointment booking, queue, and conflict protection still work.
- Nurse/doctor vitals save against the intended patient and appointment; other-clinic and unassigned access is denied.
- A doctor can save a draft and finalize their own encounter; another doctor and a clinic admin cannot author it.
- A finalized encounter cannot be overwritten, and printing is available only from server-confirmed finalized data.
- Disabled or missing consultation entitlement denies access without breaking reception.
- Tests cover malformed clinical input, repeat/finalize conflicts, expired sessions, CSRF, wrong clinic, and unavailable dependencies.

## Deferred before real patient use

Printed prescription legal fields and signatures, clinician credential verification, corrections/addenda, retention and deletion policy, backup/recovery drills, patient consent, secure document delivery, and full two-clinic isolation testing need explicit review. No patient email, WhatsApp, AI clinical assistance, lab, billing, or patient portal belongs in this slice.

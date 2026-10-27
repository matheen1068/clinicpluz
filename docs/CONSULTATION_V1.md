# Clinic App consultation — synthetic pilot contract

Status: synthetic staging pilot. Reception and consultation screens have been exercised with fictional Goodwell records in AWS staging by 2026-10-10. This is not approval for real clinic records.

## Staff flow

An authorized receptionist, clinic admin, nurse, or doctor opens an existing clinic appointment and records measured vitals with explicit units, observation time, and author. The vitals are stored in the same encounter, so the assigned doctor sees the latest measurements and who recorded them. The doctor workspace separates schedule, visit overview, vitals, clinical notes, prescription, and final review into tabs. A doctor assigned to that visit records the complaint, examination, assessment, plan, and doctor-entered prescription items. Work can be saved as a draft. Only the assigned doctor can finalize it; a finalized record is read-only in this slice. A correction or addendum workflow must be designed before real clinical use.

The clinic can print a **finalized** prescription using a browser print layout that identifies the clinic, patient, doctor, and date. A draft must never be presented as a final prescription. The application does not choose medicines, suggest doses, diagnose, or claim to check allergies or drug interactions. Clinicians remain responsible for clinical decisions.

## Access and data boundary

Keep all routes on the existing same-origin Clinic App API. The server must derive clinic and staff from the authenticated session and recheck active membership, role, appointment-to-patient linkage, assigned doctor, and a `consultations` entitlement on each request. Missing mapping or entitlement fails closed. Receptionists, clinic admins, nurses, and doctors may read the clinic's visit queue, read the selected encounter's identity and vitals, and record measured vitals. Only the assigned doctor may read, author, or finalize notes and prescription items. Reception and clinic-admin vitals access does not grant history, medicine search, draft, finalization, or prescription authoring access. Preserve the existing reception endpoints and treat absent `consultations` in older entitlement items as disabled rather than breaking reception.

Store consultation records under clinic-scoped keys. Audit creation, edits, and finalization with actor and time. Do not put patient names, phone numbers, note text, medicines, cookies, or CSRF tokens in URLs, logs, analytics, or browser storage. Use bounded inputs and keep cached API responses disabled. A browser role check is only a presentation aid; all permission checks belong on the server.

## Acceptance before a staging deploy

- Reception login, patient lookup, appointment booking, queue, and conflict protection still work.
- Reception, clinic admin, nurse, and doctor vitals save against the intended patient and appointment; other-clinic access is denied, and doctor reads remain limited to assigned visits.
- A doctor can save a draft and finalize their own encounter; another doctor and a clinic admin cannot author it.
- A finalized encounter cannot be overwritten, and printing is available only from server-confirmed finalized data.
- Disabled or missing consultation entitlement denies access without breaking reception.
- Tests cover malformed clinical input, repeat/finalize conflicts, expired sessions, CSRF, wrong clinic, and unavailable dependencies.

## Deferred before real patient use

Printed prescription legal fields and signatures, clinician credential verification, corrections/addenda, retention and deletion policy, backup/recovery drills, patient consent, secure document delivery, and full two-clinic isolation testing need explicit review. No patient email, WhatsApp, AI clinical assistance, lab, billing, or patient portal belongs in this slice.

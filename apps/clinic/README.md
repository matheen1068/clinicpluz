# ClinicPluz clinic staff app

This is a fresh, standalone React/TypeScript/Vite clinic workspace, separate from the AI Studio prototype at repository root. It includes clinic-specific staff sign-in, reception workflow, and a synthetic consultation pilot UI. The workflow calls server APIs; it contains no bundled patient records or authentication bypass.

## Run locally

Use Node.js 20.19+ and pnpm. From `apps/clinic`:

```sh
pnpm install
pnpm dev
```

Open `http://goodwell.localhost:5174/login/`. The slug is taken from the hostname. You can also preview the path-based demo layout at `http://localhost:5174/clinic/goodwell/login/`; both `/login` and `/login/` endings are accepted. `localhost:5174/login/` alone does not resolve a clinic. For a backend running on another port, set `CLINIC_API_PROXY_TARGET` as shown in `.env.example`. Vite proxies `/api` to `http://127.0.0.1:8787` by default and preserves the original Host header.

For a working local login, run and seed the service in [`services/clinic-auth`](../../services/clinic-auth/README.md). If that service is absent, local development shows a **clearly labeled design preview**. It is not an authenticated clinic. A sign-in attempt first requires a real clinic bootstrap response and then calls the real API; there are no mock credentials or bypasses. The exact approved CloudFront demo host can also show this synthetic design preview when the API is absent. Owned-domain builds never show the preview and fail closed when clinic discovery or session checks fail.

There are three URL modes:

| Mode | Example | Clinic context |
| --- | --- | --- |
| Local clinic subdomain | `http://goodwell.localhost:5174/login/` | Exact one-label `.localhost` subdomain. |
| Domain-free demo | `https://d123456abcdef.cloudfront.net/clinic/goodwell/login/` | Exact CloudFront default hostname configured as `VITE_DEMO_HOSTNAME`, plus the path slug. The same path also works on `localhost:5174` in development. |
| Future owned domain | `https://goodwell.<owned-domain>/login/` | Exact one-label subdomain of `VITE_CLINIC_BASE_DOMAIN`. Configure this only after acquiring the domain. |

Both `/login` and `/login/` forms are accepted in each mode. For the CloudFront default hostname, set `VITE_DEMO_HOSTNAME` to the actual `d….cloudfront.net` host at build time; arbitrary CloudFront hosts are rejected. Route `/clinic/*` and `/login*` to the app's `index.html`, and route `/api/*` to the backend on the **same origin**. The frontend build is static; it does not create an authentication service. With no suitable `/api/*` backend, the demo shows a clearly labeled synthetic design preview; pressing Sign in still requires real bootstrap and authentication, so it cannot open the authenticated workspace. Do not use the local SQLite service in AWS or enter real clinic/patient data in a demo environment.

## Backend contract

All responses are JSON except successful logout. Every endpoint is same-origin and must use `Cache-Control: no-store`; do not cache `/api/*` at CloudFront.

| Endpoint | Response / request |
| --- | --- |
| `GET /api/clinics/<slug>/bootstrap` | `{ "clinic": { "slug": "goodwell", "displayName": "Goodwell Clinic" }, "csrfToken": "..." }`. Public clinic name only; no staff or patient data. |
| `GET /api/clinics/<slug>/auth/session` | `200` with `{ "clinicSlug": "goodwell", "csrfToken": "...", "user": { "id": "...", "displayName": "...", "role": "doctor" } }`; `401` when not signed in. `csrfToken` is the current authenticated token. |
| `POST /api/clinics/<slug>/auth/login` | JSON body `{ "username": "...", "password": "..." }` and `X-CSRF-Token` from bootstrap. On success, set the session cookie and return the authenticated session response above. Use `401` for bad credentials, `403` for forbidden clinic membership, `429` for throttling. |
| `POST /api/clinics/<slug>/auth/logout` | `X-CSRF-Token` from the authenticated session, clears the cookie, returns `204`. The UI then verifies that session retrieval returns `401`. |

Supported initial roles are `clinic_admin`, `doctor`, `receptionist`, `nurse`, `lab_tech`, `billing`, and `pharmacist`. The frontend uses role text only for display. **All role and tenant authorization belongs on the server for every clinical API request.**

The backend must validate the Host (or forwarded host from an explicitly trusted proxy) and verify that the authenticated staff member belongs to the clinic named by the API path. On an owned subdomain, it must also require the hostname clinic to match the API path clinic. On the approved CloudFront default host, the path slug is routing context only; session membership remains mandatory. A subdomain or path is never proof of access. Use an HttpOnly, Secure, SameSite cookie with no `Domain` attribute so it is host-only; a `__Host-` cookie with `Path=/` is suitable. For a shared demo host, keep sessions isolated per clinic in the server session store and use distinct cookie names or paths. Bind both pre-login and authenticated CSRF tokens to the browser's server-managed session and rotate on authentication. Do not expose tokens or credentials in URLs, localStorage, logs, or analytics. The client stores only transient in-memory UI state.

The repository includes a **local-only** authentication backend for development and separate AWS staging services. The product owner verified Goodwell login, reception, consultation screens, and a fictional medicine shortlist item in staging by 2026-10-10. That is not production approval. No real patient data belongs in staging.

## Reception workflow contract

The workflow is shown only to authenticated `clinic_admin`, `receptionist`, or `nurse` staff. The server must independently enforce role, clinic membership, and the `patient_intake` and `appointments` module entitlements. Other roles see no reception tools. Patient search sends a JSON `POST /api/workflow/clinics/<slug>/patients/search` with the authenticated CSRF token, keeping names and phones out of URLs. Registration, booking, doctor roster, and queue routes follow [`docs/CLINIC_WORKFLOW_V1.md`](../../docs/CLINIC_WORKFLOW_V1.md). The UI preserves booking details on a `409` conflict and reloads the queue; an uncertain network result is never automatically retried.

The 09:30–18:30, 30-minute `Asia/Kolkata` schedule is provisional for a **synthetic pilot**. The last start is 18:00. Slot selection is a request, not a claim of availability; the server prevents conflicts. Clinic timezone, opening hours, holidays, and doctor schedules must eventually come from clinic configuration. The Goodwell staging smoke test exercised a synthetic doctor list, phone booking, persistence after refresh, conflict rejection, and signed-out `401`; see [`docs/CLINIC_WORKFLOW_V1.md`](../../docs/CLINIC_WORKFLOW_V1.md). Do not enter real patient data.

## Consultation pilot contract

The **Consultations** module appears only for authenticated nurses and doctors. The server independently enforces the `consultations` entitlement and doctor-to-roster assignment on every request. Nurses can read clinic visits and record measured vitals with units and observed time; doctors can access only their assigned visits, record vitals, save their own note and medication entries as a draft, and deliberately finalize a saved draft. Clinic admins and receptionists do not see clinical authoring tools. Existing reception behavior stays separate.

Consultation calls use the same-origin `/api/workflow/clinics/<slug>/consultations` routes. Only the queue's clinic date appears in a URL. Encounter selection, notes, vitals, and medication details use JSON POST bodies with the authenticated CSRF token. Save requests include `expectedRevision`; on a conflict or uncertain network result, the UI preserves changed fields in memory, requires a server reload before another write, and shows a local recovery copy for comparison. It never retries an uncertain clinical write automatically. Finalized encounters are read-only in this slice. A browser print view appears **only** when the doctor receives a server-confirmed finalized `printablePrescription` payload with medications. It identifies clinic, doctor, patient, and date, and is clearly marked for synthetic pilot use. The receptionist handoff has a separate synthetic-demo PDF email flow described below; the doctor workspace has no email control. No WhatsApp, AI clinical advice, or automated drug-safety claim is provided.

The consultation UI and backend source match the contract in [`docs/CONSULTATION_V1.md`](../../docs/CONSULTATION_V1.md) and have been exercised with synthetic Goodwell records in AWS staging. The browser print layout has not yet had visual QA. Real-patient use requires review of legal prescription fields, clinician credentials, corrections/addenda, audit, privacy, retention, and recovery.

## Daily doctor schedule and medicine directions (new local slice)

The doctor workspace presents the **server-scoped daily appointment queue** as 30-minute visit cards for the provisional 09:30–18:30 Asia/Kolkata schedule. Empty cards say “No visit recorded”; they do not claim availability. Reception remains the only booking controller. Recorded visits outside the provisional grid remain visible separately. The cards are an interface to existing appointments, not a second scheduling database.

The assigned doctor can enter a manual medicine schedule with Morning, Afternoon, and Night checkboxes plus Before food, After food, With food, or Not specified. This is an alternative to typing a custom frequency. It does not choose a medicine, dose, or regimen. Dose, route, duration, and instructions remain doctor-entered. The draft API carries `timing:{timesOfDay,mealRelation}` or `timing:null`; older free-text frequency entries still display and print. Finalization requires one or the other, not conflicting directions. The backend is authoritative for validation.

## Finalized prescription handoff (new local slice)

Receptionists and pharmacists have a separate **Prescriptions** module. It uses `GET /api/workflow/clinics/<slug>/consultations/prescriptions?date=YYYY-MM-DD` and `POST .../prescriptions/read` with `{appointmentId,clinicDate}`. Only a finalized prescription containing medicines appears. The read response is restricted to `{status:'finalized',printablePrescription:{clinic,doctor,patient,appointmentDate,finalizedAt,medications}}`; it contains no doctor note, vitals, draft, phone number, or patient email. Both roles may review and browser-print the server-confirmed prescription. They cannot edit or finalize it. The server rechecks clinic membership, exact role, and the `consultations` entitlement on every request.

For the synthetic staging demo, **receptionists only** may check the patient email stored by the server using `POST .../prescriptions/email/preview` with appointment identity, confirm that displayed address, then call `POST .../prescriptions/email` with appointment identity, `confirmPatientEmail:true`, and `expectedRecipientEmail` for comparison. The browser supplies neither a delivery destination nor a PDF. The server re-reads the stored address, rejects changes since preview, creates the PDF, and submits it to SES only when staging sending is enabled. `accepted` means SES accepted the request, not that the patient received it. An unknown outcome is not retried automatically; staff must check the delivery log. Pharmacists have no email control. Browser print remains available when no stored email or supported PDF is available. This slice is **not yet deployed or visually verified** and is for synthetic data only.

## Previous finalized visits (synthetic pilot)

Within a verified assigned consultation, the doctor sees a separate, read-only **Previous finalized visits** section. It lists indexed earlier visits in pages of ten and can open a finalized visit's recorded vitals, note, and doctor-entered prescriptions. It does not copy any history into the current editable form or claim to provide a complete longitudinal record. Unindexed older staging visits may be absent until reviewed backfill.

The doctor-only same-origin history API uses `POST /api/workflow/clinics/<slug>/consultations/history/list` with `{appointmentId,clinicDate,cursor?}` and `POST .../history/detail` with `{appointmentId,clinicDate,historyId}`. The patient comes from the server's current appointment; opaque history IDs and cursors remain in request bodies. Responses must identify the same clinic and patient, have `status:'finalized'`, and refer to a visit earlier than the selected appointment. The frontend rejects a mismatch and keeps loading, detail errors, and pagination separate from the current consultation. See [`docs/PATIENT_HISTORY_V1.md`](../../docs/PATIENT_HISTORY_V1.md). The slice was deployed to synthetic Goodwell staging on 2026-10-11; the owner confirmed that the doctor-only section appears. A populated-history browser test remains pending.

## Checks

```sh
pnpm test
pnpm typecheck
pnpm build
```

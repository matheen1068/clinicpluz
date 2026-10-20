# ClinicPluz Control Panel V1

This is a separate platform-operator application for **synthetic staging data**. It does not open patient or clinical records. It has not been deployed or visually checked in a browser. The preserved Clinic App and AI Studio prototype are separate.

## What the app does

An allowlisted platform operator can view and search customer organizations, open each customer's branches, create a customer, create an inactive branch, link an already confirmed clinic staff identity, review or change branch staff membership, configure supported module flags, and activate or suspend a branch. The app shows real server status, versions, customer creation time, staff list, and module settings. It handles empty lists, loading, pagination, stale-write conflicts, API failure, expired sign-in and access denial.

The **Adopt existing clinic** action is only for an explicitly reviewed synthetic legacy clinic such as a seeded Goodwell tenant. The operator enters its known slug, inspects the server-returned name, status, versions and complete module map, then confirms the snapshot. The API conditionally associates it with a customer without changing its clinic slug, staff, active state or enabled modules. It never adopts a legacy clinic automatically.

Staff linking does **not** create a Cognito identity or password. Provision and confirm the person in the clinic staff identity service first. A customer may have multiple branches; branch name is unique within its customer, and clinic slug is globally unique. Branch membership grants no access to another branch. The Control Panel operator identity is separate from clinic staff identity.

## Operator authentication

The app uses the separate Cognito operator managed login with authorization-code **PKCE**. Configure the four public values in `.env.example` for the current origin. The redirect must be approved as `<PublicOrigin>/control/callback`, and the logout return as `<PublicOrigin>/control/`. Cognito handles the operator MFA step. The one-time PKCE verifier and state live in `sessionStorage` for the redirect only and are removed on callback. The access token is held in memory only; page refresh requires sign-in again. No token-paste field, clinic cookie, clinic staff role, or local demo bypass exists. Every control request sends the operator access token as a Bearer token; API Gateway and the control service validate the signed token, operator pool/client and server-side allowlist. Missing configuration shows a setup-required screen and makes no API call.

Browser configuration is public, not a secret. Do not put user-pool client secrets or AWS credentials in the frontend. The app never persists access, ID or refresh tokens in browser storage.

## Run and build

From this folder, install the pinned dependencies and run `pnpm dev`, `pnpm test`, `pnpm typecheck`, and `pnpm build`. The development server uses `http://127.0.0.1:5175/control/`; set `CONTROL_API_PROXY_TARGET` to the separately running authorized control API if needed. Without Cognito configuration and the backend, the screen stays in a setup/sign-in/unavailable state and displays no fabricated customer data.

The Vite base is `/control/`. Host its built files so `/control/` and `/control/callback` return the Control Panel `index.html`; asset URLs remain under `/control/assets/`. Route `/api/control/*` separately to the operator-authorized API with `Authorization`, `Origin`, and `Content-Type` forwarding and no caching. A static-hosting fallback must never rewrite API errors into the app's HTML. The operator pool, app client, approved callbacks, MFA, allowlisted operator subject, and API deployment are backend prerequisites. No cloud resource is created by this frontend.

## Current limits

- The service does not expose audit-history or aggregate-health read endpoints; the Operations screen says so and shows only verified record metadata.
- The current clinic workflow enforces `patient_intake`, `appointments`, `consultations` and `billing` entitlement flags. The other four flags remain visible but cannot be enabled in this UI until their consuming services enforce them. A toggle is never client-side authorization.
- The current API links an already confirmed staff identity; staff invitation, credential issuance, and recovery remain outside this UI.
- This is a synthetic staging slice. Privacy, audit review, backup, retention, and access controls need review before real clinic or patient data is used.

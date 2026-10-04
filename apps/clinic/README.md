# ClinicPluz clinic staff app

This is a fresh, standalone React/TypeScript/Vite clinic workspace. It is intentionally separate from the AI Studio prototype at repository root. This milestone contains the clinic-specific staff sign-in and a minimal authenticated shell; it has no patient data or clinic workflow screens yet.

## Run locally

Use Node.js 20.19+ and pnpm. From `apps/clinic`:

```sh
pnpm install
pnpm dev
```

Open `http://goodwell.localhost:5174/login/`. The slug is taken from the hostname. `localhost:5174` alone will not resolve a clinic. For a backend running on another port, set `CLINIC_API_PROXY_TARGET` as shown in `.env.example`. Vite proxies `/api` to `http://127.0.0.1:8787` by default and preserves the original Host header.

If the backend is absent, local development shows a **clearly labeled design preview**. It is not an authenticated clinic. A sign-in attempt first requires a real clinic bootstrap response and then calls the real API; there are no mock credentials or bypasses. Production builds never show the preview and fail closed when clinic discovery or session checks fail.

For production, set `VITE_CLINIC_BASE_DOMAIN` to the actual owned domain before building. The app accepts exactly one clinic label before that suffix, for example `goodwell.example.com`. A staging suffix can be configured separately. Route `/login/` to the app's `index.html`, and route `/api/*` to the backend on the **same origin**. The domain in `.env.example` is illustrative, not a claim that it has been registered.

## Backend contract

All responses are JSON except successful logout. Every endpoint is same-origin and must use `Cache-Control: no-store`; do not cache `/api/*` at CloudFront.

| Endpoint | Response / request |
| --- | --- |
| `GET /api/clinic/bootstrap` | `{ "clinic": { "slug": "goodwell", "displayName": "Goodwell Clinic" }, "csrfToken": "..." }`. Public clinic name only; no staff or patient data. |
| `GET /api/auth/session` | `200` with `{ "clinicSlug": "goodwell", "csrfToken": "...", "user": { "id": "...", "displayName": "...", "role": "doctor" } }`; `401` when not signed in. `csrfToken` is the current authenticated token. |
| `POST /api/auth/login` | JSON body `{ "username": "...", "password": "..." }` and `X-CSRF-Token` from bootstrap. On success, set the session cookie and return the authenticated session response above. Use `401` for bad credentials, `403` for forbidden clinic membership, `429` for throttling. |
| `POST /api/auth/logout` | `X-CSRF-Token` from the authenticated session, clears the cookie, returns `204`. The UI then verifies that session retrieval returns `401`. |

Supported initial roles are `clinic_admin`, `doctor`, `receptionist`, `nurse`, `lab_tech`, and `billing`. The frontend uses role text only for display. **All role and tenant authorization belongs on the server for every clinical API request.**

The backend must validate the Host (or forwarded host from an explicitly trusted proxy), derive the clinic from it, and verify that the authenticated staff member belongs to that clinic. A subdomain is routing context, not proof of access. Use an HttpOnly, Secure, SameSite cookie with no `Domain` attribute so it is host-only; a `__Host-` cookie with `Path=/` is suitable. Bind both pre-login and authenticated CSRF tokens to the browser's server-managed session and rotate on authentication. Do not expose tokens or credentials in URLs, localStorage, logs, or analytics. The client stores only transient in-memory UI state.

This app does **not** include a backend or AWS deployment. Until the contract is implemented, production login is unavailable by design.

## Checks

```sh
pnpm test
pnpm typecheck
pnpm build
```

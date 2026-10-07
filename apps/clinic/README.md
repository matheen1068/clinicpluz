# ClinicPluz clinic staff app

This is a fresh, standalone React/TypeScript/Vite clinic workspace. It is intentionally separate from the AI Studio prototype at repository root. This milestone contains the clinic-specific staff sign-in and a minimal authenticated shell; it has no patient data or clinic workflow screens yet.

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

Supported initial roles are `clinic_admin`, `doctor`, `receptionist`, `nurse`, `lab_tech`, and `billing`. The frontend uses role text only for display. **All role and tenant authorization belongs on the server for every clinical API request.**

The backend must validate the Host (or forwarded host from an explicitly trusted proxy) and verify that the authenticated staff member belongs to the clinic named by the API path. On an owned subdomain, it must also require the hostname clinic to match the API path clinic. On the approved CloudFront default host, the path slug is routing context only; session membership remains mandatory. A subdomain or path is never proof of access. Use an HttpOnly, Secure, SameSite cookie with no `Domain` attribute so it is host-only; a `__Host-` cookie with `Path=/` is suitable. For a shared demo host, keep sessions isolated per clinic in the server session store and use distinct cookie names or paths. Bind both pre-login and authenticated CSRF tokens to the browser's server-managed session and rotate on authentication. Do not expose tokens or credentials in URLs, localStorage, logs, or analytics. The client stores only transient in-memory UI state.

The repository now includes a **local-only** backend that implements this contract for development. It is not an AWS deployment or production identity provider. Production login remains unavailable by design until that separate implementation is built and reviewed.

## Checks

```sh
pnpm test
pnpm typecheck
pnpm build
```

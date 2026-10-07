# ClinicPluz local clinic authentication

This service makes the clinic staff login work end-to-end **on a developer machine**. It handles only clinic identity, staff credentials, CSRF, and sessions. It has no patient records and is deliberately not an AWS/production identity provider. It refuses `NODE_ENV=production`, requires `CLINIC_AUTH_LOCAL_ONLY=1`, accepts only one-label `*.localhost` or exact `localhost` hosts on the configured public port, and listens only on `127.0.0.1`.

## Local setup

Requires Node.js 24 and pnpm. From `services/clinic-auth`:

```sh
pnpm install
CLINIC_AUTH_LOCAL_ONLY=1 pnpm seed clinic goodwell "Goodwell Clinic"
CLINIC_AUTH_LOCAL_ONLY=1 pnpm seed clinic blesswell "Blesswell Clinic"
```

Create a staff member for each clinic. The CLI reads a password from standard input and never prints it. Use a unique password of at least 12 characters for each staff member. In zsh, for example:

```sh
printf 'Password: '
read -s CP_LOCAL_PASSWORD
printf '\n'
printf '%s\n' "$CP_LOCAL_PASSWORD" | CLINIC_AUTH_LOCAL_ONLY=1 pnpm seed staff goodwell reception.goodwell "Goodwell Reception" receptionist
unset CP_LOCAL_PASSWORD
```

Repeat for `blesswell` with a different username and password. Staff roles are `clinic_admin`, `doctor`, `receptionist`, `nurse`, `lab_tech`, or `billing`. No default clinic, staff account, or password is shipped. The SQLite file is stored at `data/local-auth.sqlite` by default; its database/WAL/SHM files are ignored by Git. Use `CLINIC_AUTH_DB_PATH` to choose another local path.

Start the service:

```sh
CLINIC_AUTH_LOCAL_ONLY=1 pnpm dev
```

Then start the clinic frontend from `apps/clinic` and open `http://goodwell.localhost:5174/login/` or `http://blesswell.localhost:5174/login/`. To test the domain-free path flow locally, use `http://localhost:5174/clinic/goodwell/login/` and `http://localhost:5174/clinic/blesswell/login/`. The frontend calls `/api/clinics/<slug>/bootstrap` and `/api/clinics/<slug>/auth/{session,login,logout}`. Vite sends same-origin `/api/*` requests to this loopback service on port 8787 while preserving the original Host header. `CLINIC_PUBLIC_PORT` (default 5174) must match Vite's port; `CLINIC_AUTH_PORT` (default 8787) controls the loopback listener.

## Local security behavior

- The Host must be exactly `<clinic>.localhost:5174` or `localhost:5174` (or the configured public port). Unsafe requests must have the exact matching Origin. Forwarded host headers are ignored. A clinic subdomain must match the API path slug. On `localhost`, the API path slug selects the clinic but the authenticated session must also belong to that clinic.
- Clinic discovery returns only the active clinic name. It creates a short-lived anonymous CSRF session in SQLite.
- Passwords use per-user random salts and scrypt hashes. Login checks the user **within the host's clinic**. Five failed attempts for the same clinic username cause a 15-minute lock.
- Successful login rotates from the anonymous session to a new opaque authenticated session. The browser gets a host-only, HttpOnly, SameSite=Lax cookie with a clinic-specific name, so two path-based clinics on `localhost` keep separate sessions. The session is stored server-side for at most eight hours. The local HTTP cookie intentionally lacks `Secure`; no production cookie is issued by this service.
- Logout requires the authenticated CSRF token, deletes the server session, and clears the cookie. Disabling a staff account or clinic denies subsequent session requests. A cookie from one clinic cannot authorize another clinic.
- Login and session endpoints do not return patient data. No access decision should be based on client-side role labels alone.

## AWS boundary

**Do not deploy this SQLite service or use it with real clinic/patient data.** The AWS pilot needs an explicit identity and persistence design. Before any live clinic use, replace this local identity provider with an AWS-ready implementation (for example Cognito-backed staff authentication), use a managed session/data store, configure HTTPS-only `__Host-` cookies, trustworthy Host forwarding and validation at the edge/API, audit logging, secrets management, backups, and operational monitoring. Every future clinical API must derive tenant context from the trusted host and independently verify authenticated clinic membership and role. The Control Panel will later own clinic/staff provisioning and module entitlements; this local seed CLI is not that Control Panel.

## Checks

```sh
pnpm typecheck
pnpm test
```

The tests exercise two clinics, cross-tenant denial, bad credentials, CSRF/Origin rejection, throttling, session expiry, staff revocation, logout, and SQLite persistence without opening a network port. Test passwords are generated at runtime.

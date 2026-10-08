# ClinicPluz staging clinic authentication API

This is the **AWS staging implementation** of the Clinic App's four same-origin endpoints. It is separate from `services/clinic-auth`, which remains local-only SQLite. The product owner deployed it behind CloudFront and verified Goodwell sign-in on 2026-10-09. It is for synthetic clinics and staff accounts only; do not enter patient data or invite real clinic staff yet.

## What it does

| Route | Behavior |
| --- | --- |
| `GET /api/clinics/<slug>/bootstrap` | Returns the active clinic's public name and a short-lived, server-bound pre-login CSRF token. |
| `POST /api/clinics/<slug>/auth/login` | Requires exact public `Origin`, pre-login cookie and CSRF token, individual Cognito password authentication, and active membership in the path clinic. Issues a one-hour opaque session cookie after authentication completes. |
| `GET /api/clinics/<slug>/auth/session` | Rechecks session expiry, active clinic, active membership and Cognito user status; returns current role and authenticated CSRF token. |
| `POST /api/clinics/<slug>/auth/logout` | Requires exact `Origin` and authenticated CSRF token, deletes the server-side session and clears the cookie. |

The browser never receives Cognito access, ID or refresh tokens. `__Host-cpz_pre` and `__Host-cpz_session` contain only random values; DynamoDB stores their SHA-256 hashes. Cookies are host-only, `Secure`, `HttpOnly`, `SameSite=Lax`, and `Path=/`. The shared CloudFront demo host permits one active clinic session at a time: a Goodwell session is denied on Blesswell paths, and staff must sign out before switching clinics. Expiry is checked in code because DynamoDB TTL deletion is asynchronous. Five failed attempts per clinic username in a 15-minute window are throttled; the HTTP API also has a route-level throttle. The server returns `Cache-Control: no-store` on every response and never logs credentials or token values.

The URL selects clinic **context**, not authority. A membership record must match the Cognito user's stable `sub`, and that membership is checked again for each session request. The current CloudFront hostname is a single configured HTTPS origin. API Gateway receives its own origin `Host`, so this service does **not** pretend to derive the viewer's clinic from that header. Owned clinic subdomains need a separately reviewed, trusted viewer-host forwarding design before use.

## Infrastructure and deployment boundary

[`template.yaml`](template.yaml) declares a Cognito staff user pool/client with public self-registration disabled, a DynamoDB auth table, a generated Secrets Manager origin key, an HTTP API, and a Node.js Lambda with scoped IAM. The stack uses the AWS Region selected at deployment; it does not hardcode a Region. `ap-south-1` is the current staging choice. The template intentionally configures MFA **off for synthetic staging only**: Cognito can return `NEW_PASSWORD_REQUIRED` or MFA challenges, and this four-endpoint UI cannot complete them. The Lambda refuses such challenges without creating a session. Password reset, MFA, invitation, and recovery must be designed before the real-clinic pilot.

The API Gateway endpoint is public at the network layer. Lambda requires an origin-only `X-ClinicPluz-Edge-Key` value retrieved from Secrets Manager; configure CloudFront to overwrite that header on origin requests. This prevents casual direct calls but is defense in depth, not identity or tenant authorization. Only tightly scoped operators should read the secret or edit the CloudFront distribution. Secrets Manager and the retained DynamoDB table incur charges; review the current AWS estimate before deployment. The generated secret needs coordinated rotation across Secrets Manager, CloudFront, and Lambda warm instances.

**Required CloudFront handoff:** point a separate `/api/*` behavior at the HTTP API `ApiOrigin` output, allow POST as well as GET, disable caching, and forward cookies, `Origin`, `Content-Type`, and `X-CSRF-Token`. With `AllViewerExceptHostHeader`, API Gateway receives its own Host. Install the generated edge key as a CloudFront origin custom header (never a browser header or repository value). Keep the S3 static behavior separate. No CORS access is needed because the Clinic App calls the same CloudFront origin. If `/api/*` falls back to the S3 SPA, the client rejects the non-JSON response and does not sign in, but this must be checked during integration.

The deployed staging stack uses `https://dpq5w4kpcyvb4.cloudfront.net` as the `PublicOrigin` parameter in `ap-south-1`. From this directory, build and review changes with `sam build` and `sam validate` before any further deployment. The AWS application Region is chosen with the deployment command. No command in this repository creates resources automatically.

## Synthetic clinic and staff setup

The stack creates no default clinic, user, membership, or password. For the two-clinic demo, provision only synthetic records through an operator-controlled AWS workflow:

1. Create Cognito users with distinct internal usernames for Goodwell and Blesswell. Set strong permanent passwords through a secure operator workflow; never commit, paste into a shell command, or send credentials in chat. A temporary-password user will receive `NEW_PASSWORD_REQUIRED` and cannot use this UI yet.
2. Record each Cognito user's immutable `sub` from `AdminGetUser`.
3. In the DynamoDB table, create clinic items using `pk=CLINIC#<slug>`, `sk=META`, plus string `slug`, string `displayName`, and boolean `active=true`.
4. Create one staff membership per user using `pk=CLINIC#<slug>`, `sk=STAFF#<lowercase-login-username>`, plus string `clinicSlug`, string `username`, string `cognitoUsername`, string `sub`, string `displayName`, string `role`, and boolean `active=true`. Allowed roles are `clinic_admin`, `doctor`, `receptionist`, `nurse`, `lab_tech`, and `billing`.
5. Verify each account can sign in only through its own clinic path. Disable one membership and confirm that its current session immediately loses access. Never place real patient or staff details in these demo records.

Control Panel clinic/user provisioning remains a separate future boundary. This manual staging setup is not the Control Panel.

## Checks and current limits

Node.js 24 is required to run the source-level tests (`node --experimental-strip-types --test test/*.test.mjs`). They exercise the pure authentication logic with in-memory fakes: two-clinic path denial, cookies, CSRF, bad credentials and throttle, Cognito challenge refusal, revocation, expiry, and the HTTP API v2 event adapter. The Lambda itself is transpiled for the Node.js 22 AWS runtime. The product owner ran `sam validate`, `sam build`, and `npm run typecheck` in CloudShell; after switching the esbuild output to CommonJS, the live Goodwell bootstrap and sign-in succeeded. Cross-clinic, logout, revocation, and expiry behavior still need live verification. CloudShell's Node 20 cannot run this repository's source-level test command; use Node 24 for it.

Before inviting real clinic staff, add MFA/password recovery UX, a trusted owned-domain routing design, a controlled provisioning flow, audit events, WAF/rate policy, secret rotation, backup/restore verification, and operational alarms. Every future clinical endpoint must independently enforce clinic membership, role and module entitlement; this auth service does not authorize patient records.

AWS references: [Cognito admin password flow](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_AdminInitiateAuth.html), [Cognito app-client auth flows](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_CreateUserPoolClient.html), [HTTP API payload v2 cookies](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html), [DynamoDB TTL](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html), [SAM esbuild](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-sam-cli-using-build-typescript.html).

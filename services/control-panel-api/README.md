# ClinicPluz Control Panel backend foundation

This is a **separate, synthetic-staging-only** platform API for clinic onboarding, staff membership, and module entitlements. It has not been deployed, connected to CloudFront, or integrated with a Control Panel frontend. It contains no patient or clinical-record endpoints. The preserved root AI Studio prototype and the Clinic App are unchanged.

## Security boundary

All routes in [`template.yaml`](template.yaml) require an API Gateway **JWT authorizer** backed by a separate Cognito *operator* user pool. The Lambda accepts only the authorizer's verified JWT claims, checks `token_use=access`, exact issuer and client, then requires the operator's stable `sub` in a server-side allowlist. A browser header such as `X-Operator-Sub`, a clinic staff session cookie, or a clinic admin role cannot authorize these routes. Mutations also require the exact configured same-origin `Origin` header. Responses are `no-store`. The default allowlisted subject is an all-zero sentinel, so a new stack denies every operator until an operator is separately provisioned and the stack parameter is updated.

The intended Control Panel UI is a **separate app** on its own origin. No login UI or operator invitation workflow is in this slice. MFA is required in the declared operator pool, but no operator account is created by the template. The Lambda's DynamoDB IAM policy is scoped to clinic and audit partition keys of the auth table, and it receives only `AdminGetUser` for the clinic staff user pool. No Scan, clinical-record table, credential issuance, password setting, or email permission is granted.

## API routes

All paths start with `/api/control`, require a valid platform-operator access token, and return JSON.

| Route | Input / result |
| --- | --- |
| `POST /clinics` | `{slug,displayName}`. Creates an **inactive** clinic and all-disabled entitlements, version 1. |
| `GET /clinics/<slug>` | Clinic status and entitlements; no patient data. |
| `POST /clinics/<slug>/staff` | `{username,cognitoUsername,displayName,role}`. Looks up an **already provisioned, active, confirmed** Cognito staff identity and writes a clinic membership. Does not create credentials. |
| `GET /clinics/<slug>/staff/<username>` | Membership's public fields, excluding Cognito `sub`. |
| `PATCH /clinics/<slug>/staff/<username>` | Full replacement `{expectedVersion,displayName,role,active}`. Suspension/role changes are visible to Green's auth service on its next membership check. Disable an active clinic before suspending or demoting one of its active clinic admins. |
| `PUT /clinics/<slug>/modules` | Full replacement `{expectedVersion,modules}` with exactly the eight boolean module keys in `src/core.ts`. |
| `PATCH /clinics/<slug>/state` | `{expectedVersion,active,adminUsername}`. Activation requires an active `clinic_admin` membership; disabling uses `adminUsername:null`. |

The client must refresh and retry on `409` version conflicts. No route lists all clinics or all staff yet; this avoids a broad scan and keeps the first backend slice small. Staff usernames are lowercase and unique **within a clinic**. Slugs are lowercase and unique across clinics.

## Contract with Clinic App authentication

This service writes the exact shared records consumed by `services/clinic-auth-aws` in its `AuthTable`:

| DynamoDB key | Required fields consumed by Green | Black-owned addition |
| --- | --- | --- |
| `pk=CLINIC#<slug>, sk=META` | `slug`, `displayName`, `active` | numeric `version` |
| `pk=CLINIC#<slug>, sk=STAFF#<username>` | `clinicSlug`, `username`, `cognitoUsername`, `sub`, `displayName`, `role`, `active` | numeric `version` |
| `pk=CLINIC#<slug>, sk=ENTITLEMENTS` | Not yet read by Green | `clinicSlug`, boolean `modules` map, numeric `version` |
| `pk=AUDIT#<slug>, sk=<UTC timestamp>#<UUID>` | Not read by Green | immutable operator change record |

The `sub` is read from `AdminGetUser`, never supplied in the request body. `role` is restricted to the exact six roles in Green's authentication service. Green's current session endpoint rechecks clinic and membership records, so deactivation and staff suspension revoke access on the next check. **Green's auth service does not enforce module entitlements**; every future clinical API must read the entitlement record and authorize the module server-side. The Control Panel operator is not automatically a clinic staff member and has no clinical-record access.

Conditional DynamoDB transactions write each state change and its audit item atomically, with optimistic version checks. This is an append-only operational audit foundation, not yet a complete regulatory audit or restore plan. Existing manually seeded clinics without `version` and `ENTITLEMENTS` records require a reviewed migration before this Control Panel can manage them.

## Local verification and deployment limits

Run source-level tests with Node 24: `node --experimental-strip-types --test test/*.test.mjs`. After dependencies are installed, run `pnpm typecheck` and `sam validate` from this directory; neither the concrete AWS adapter nor SAM transform has been verified against AWS yet. The template needs the clinic-auth stack's table and staff pool outputs plus the intended CloudFront origin. A future no-cache CloudFront `/api/control/*` behavior must forward `Authorization`, `Origin`, and `Content-Type` to this API and keep it separate from Clinic App auth routes. Deploy only after reviewing cost, IAM, CloudFront routing, operator sign-in and MFA setup, audit retention, and synthetic data. This backend does not make the product safe for real clinic staff or patient data.

AWS references: [HTTP API JWT authorizer in SAM](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-controlling-access-to-apis-oauth2-authorizer.html), [DynamoDB transaction IAM](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis-iam.html), [DynamoDB transaction atomicity](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactWriteItems.html).

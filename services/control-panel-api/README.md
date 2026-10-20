# ClinicPluz Control Panel API (synthetic staging)

This operator-only service manages customer organizations, their clinic branches, staff memberships, and module settings. One customer may own several branches. A branch name is unique within its customer; its lowercase clinic slug is globally unique and remains the Clinic App tenant key. This service has no patient or clinical-record access. It has not been deployed or connected to the Control Panel frontend.

## Operator boundary and staging topology

Every `/api/control/*` route in `template.yaml` uses an API Gateway JWT authorizer for a separate operator Cognito user pool. The handler accepts only authorizer-verified access-token claims with the configured issuer, client ID, and an individually allowlisted operator `sub`. Clinic staff cookies and browser-supplied identity headers are not accepted. Mutations require the exact configured `Origin`; responses use `Cache-Control: no-store`. The pool requires MFA and permits admin-created users only. `AllowedOperatorSubs` accepts one to five comma-separated Cognito `sub` UUIDs with no spaces; its all-zero default is a deny-all sentinel until real operators are separately provisioned and the parameter is updated. It does not create operator credentials or grant access by Cognito group membership alone.

The intended frontend uses Cognito managed login with authorization-code PKCE and a public, no-secret client. Its callback is `${PublicOrigin}/control/callback`, logout return is `${PublicOrigin}/control/`, and its access token stays in memory. No token-paste UI or operator-session endpoint is provided. For staging, the Control Panel static app is served under `/control/*` on the configured CloudFront host; a separate, no-cache `/api/control/*` behavior forwards `Authorization`, `Origin`, and `Content-Type` to this API. The app is logically separate from the Clinic App; a second CloudFront distribution is not required for this staging path design. CloudFront and static assets have not been configured here.

## API contract

All JSON requests use `Content-Type: application/json`. All routes require the operator Bearer access token. Mutations also require the exact configured `Origin`. A stale version or uniqueness conflict returns `409`; refresh before retrying. Directory results contain at most 20 records and an opaque signed `nextCursor`; pass it back with the same filter and scope. No table scans or aggregate counts are used.

| Route | Body or result |
| --- | --- |
| `POST /api/control/customers` | `{displayName}` returns `201 {customer:{id,displayName,createdAt,version}}`. |
| `GET /api/control/customers?prefix=&cursor=` | `{items:Customer[],nextCursor}`; case-normalized name prefix. |
| `GET /api/control/customers/:id` | `{customer}`. |
| `POST /api/control/customers/:id/branches` | `{slug,branchName,displayName}` returns `201 {branch,entitlements}`. New branch is inactive, with all eight modules disabled. |
| `GET /api/control/customers/:id/branches?cursor=` | `{items:Branch[],nextCursor}` in branch-name order. |
| `GET /api/control/customers/:id/branches/:slug` | `{branch,entitlements}`; branch must belong to that customer. |
| `GET /api/control/branches?prefix=&cursor=` | `{items:Branch[],nextCursor}` in globally unique slug order. |
| `GET /api/control/branches/:slug` | `{branch,entitlements}`. |
| `GET /api/control/clinics/:slug` | `{clinic,entitlements}`. Also permits reviewing an unowned legacy clinic before adoption. |
| `POST /api/control/customers/:id/branches/adopt` | Reviewed legacy adoption described below; returns `{branch,entitlements}` without changing existing slug, staff, active state, or enabled modules. |
| `POST /api/control/clinics/:slug/staff` | `{username,cognitoUsername,displayName,role}` links an already provisioned, active, confirmed Cognito identity; returns `{staff}` without its `sub`. It does not create credentials or send invitations. |
| `GET /api/control/clinics/:slug/staff?cursor=` | `{items:Staff[],nextCursor}`; 20 at most. |
| `GET /api/control/clinics/:slug/staff/:username` | `{staff}`. |
| `PATCH /api/control/clinics/:slug/staff/:username` | Full replacement `{expectedVersion,displayName,role,active}` returns `{staff}`. Disable an active clinic before demoting or suspending one of its active clinic admins. |
| `PUT /api/control/clinics/:slug/modules` | Full replacement `{expectedVersion,modules}` returns `{entitlements}`; all eight boolean keys required. |
| `PATCH /api/control/clinics/:slug/state` | `{expectedVersion,active,adminUsername}` returns `{clinic}`. Activation requires an active `clinic_admin`; use `adminUsername:null` when disabling. |

Supported staff roles are `clinic_admin`, `doctor`, `receptionist`, `nurse`, `lab_tech`, `billing`, and `pharmacist`. The eight module keys are `patient_intake`, `appointments`, `vitals`, `consultations`, `prescriptions`, `lab_reports`, `billing`, and `email_notifications`. `vitals` and `prescriptions` require `consultations` in the replacement map. This is only a Control Panel validation rule: the current Clinic App workflow enforces `patient_intake`, `appointments`, `consultations`, and `billing`. Prescription handoff/email use the `consultations` gate plus role and separate email environment guards; the `prescriptions` and `email_notifications` switches are stored but not yet independently enforced. Do not present all eight switches as effective to a customer until their consumers enforce them.

## Data and legacy Goodwell adoption

The existing clinic-auth DynamoDB table remains the auth/entitlement table. The service adds `CUSTOMER#<UUID>/META`, a bounded `CONTROL#CUSTOMERS` name directory, a unique `CUSTOMER#<id>/BRANCH#<normalized branchName>` row, and a `CONTROL#BRANCHES/SLUG#<slug>` directory. Existing `CLINIC#<slug>/META`, `STAFF#<username>`, and `ENTITLEMENTS` records stay at their original keys. The ENTITLEMENTS record stores a nested `modules` map, matching the current workflow reader. Every successful change writes an operational `AUDIT#...` item in the same conditional transaction. Directory state and clinic state change in one transaction. No clinical table permission, `Scan`, credential-creation permission, SES permission, or deployment is included.

For an already seeded clinic such as Goodwell, first read `GET /api/control/clinics/goodwell` and review the exact current display name, active flag, clinic version, entitlement version, and all eight module booleans. Create the owning customer, then call `POST /api/control/customers/:id/branches/adopt` with the reviewed snapshot:

```json
{
  "slug": "goodwell",
  "branchName": "Main",
  "expectedDisplayName": "Goodwell Clinic",
  "expectedActive": true,
  "expectedClinicVersion": 1,
  "expectedEntitlementsVersion": 1,
  "expectedModules": {
    "patient_intake": true,
    "appointments": true,
    "vitals": false,
    "consultations": true,
    "prescriptions": false,
    "lab_reports": false,
    "billing": true,
    "email_notifications": false
  }
}
```

These values are illustrative, not a claim about the live Goodwell record. Use the actual reviewed response. Adoption rejects a changed snapshot, a missing entitlement record, an already owned clinic, or an occupied customer branch name; it never silently remaps the clinic. It preserves existing staff and active status. Versionless legacy clinic/entitlement records read as version 1 and are stamped with version 1 during adoption. Versionless legacy staff also read as version 1; their first conditional staff update writes version 2, then later updates require the exact stored version. No migration is automatic and no AWS state has been touched.

## Verification and integration limits

With Node 24 and dependencies installed, run `node --experimental-transform-types --test test/*.test.mjs` (or `pnpm test`), then `pnpm typecheck` and `sam validate`. Source and AWS-adapter tests use stubs; they do not create AWS resources. The stack requires the clinic-auth table name and staff pool ID/ARN, exact CloudFront `PublicOrigin`, an explicit `AllowedOperatorSubs` list, and a random `CursorSigningKey` of at least 32 characters. The staff pool must already contain any clinic identities operators intend to link. To remove an operator, update the stack parameter to omit that `sub`; existing access tokens then fail the handler allowlist on the next API call.

This branch is still separate from the latest Clinic App auth/workflow code. Its pharmacist role and entitlements must be reconciled with that current code before deployment; the older auth service in this checkout is not proof of pharmacist login. Operator sign-in, CloudFront behaviors, staff credential provisioning, audit retention, and a synthetic end-to-end staging test remain integration work. No real patient data should be used for this unconnected slice.

AWS references: [Cognito managed login/domain](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-assign-domain-prefix.html), [SAM HTTP API JWT authorization](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-controlling-access-to-apis-oauth2-authorizer.html), [DynamoDB transaction atomicity](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactWriteItems.html).

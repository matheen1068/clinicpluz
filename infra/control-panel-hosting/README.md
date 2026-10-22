# Independent staging Control Panel hosting

This CloudFormation stack creates a private, versioned S3 bucket and a dedicated CloudFront distribution. It does not modify the Clinic App distribution or bucket. Its first deployment omits the API origin so the distribution hostname can be passed as `PublicOrigin` to the separate Control Panel API stack. A second update adds the `/api/control/*` behavior after that API exists.

The bucket holds `control/index.html` and `control/assets/*`. A viewer-request CloudFront function rewrites `/control/` and `/control/callback` to `control/index.html`. The API behavior is never rewritten or cached. API Gateway receives the viewer's authorization, origin, and query data through the managed `AllViewerExceptHostHeader` origin request policy; dynamic API responses use `CachingDisabled`.

## Staging order

1. Validate and deploy this template with `StageName=staging` and the empty default `ControlApiDomain`. Record `PublicOrigin`, `WebBucketName`, and `DistributionId` from stack outputs.
2. Build and deploy `services/control-panel-api` with that exact `PublicOrigin`, the existing clinic-auth stack's auth table and staff pool outputs, and a generated cursor signing key. Leave the operator-sub allowlist at its deny-all default for the first API deployment.
3. Update this hosting stack using `ControlApiDomain` equal to the API stack's `ApiOrigin` hostname, without `https://`.
4. Provision and verify one individual operator in the new operator pool, then redeploy the API stack with that operator's `sub` in `AllowedOperatorSubs`. Do not replace the cursor signing key during this update.
5. Build `apps/control-panel` with the API stack's hosted-login domain and public client ID and with callback/logout URLs under the new `PublicOrigin`. Upload assets and HTML to this stack's S3 bucket, then invalidate only this distribution's `/control/*` paths.
6. Verify the static app and callback return HTML, anonymous `/api/control/customers` returns 401, the operator completes MFA sign-in, and a synthetic customer/branch can be listed. Keep synthetic data only.

The Control Panel API stack and this hosting stack have separate release cycles. The auth table and clinic staff identity pool remain shared dependencies; this website isolation does not isolate all AWS account quotas or database writes. Before enabling runtime diagnostics, instrument clinic services with sanitized signals as specified in `docs/CONTROL_DIAGNOSTICS_V1.md`.

Do not put secrets in Vite variables, S3 objects, or browser code. The Cognito app client ID and hosted domain are public values; `CursorSigningKey` is an API-only CloudFormation `NoEcho` parameter.

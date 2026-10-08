# Domain-free AWS clinic-login demo

Status (2026-10-09): the product owner deployed the staging authentication stack, connected the CloudFront `/api/*` behavior, provisioned a synthetic Goodwell clinic and staff membership, and confirmed a real Goodwell sign-in in the browser. The authenticated Clinic App remains a placeholder workspace. The product owner also created a synthetic Blesswell clinic and observed `Clinic session mismatch` when using the Goodwell session on Blesswell's session endpoint. Sign-out, membership revocation, and a separate Blesswell login remain unverified. No real clinic or patient data is approved for this staging setup.

Known staging values (non-secret): AWS Region `ap-south-1`, S3 bucket `clinicpluz-staging-web-01`, CloudFront hostname `dpq5w4kpcyvb4.cloudfront.net`.

## Goal and URLs

Demonstrate the ClinicPluz staff login for two synthetic clinics without buying a domain. A CloudFront distribution supplies an HTTPS URL and its default certificate. For example:

- `https://<distribution>.cloudfront.net/clinic/goodwell/login/`
- `https://<distribution>.cloudfront.net/clinic/blesswell/login/`

The path chooses the clinic for this temporary demo. It is not authorization. Each API request must validate the clinic slug, active clinic record, authenticated staff membership, and role. A staff session for Goodwell must not access Blesswell by changing the path. The eventual owned-domain entry point will be `<clinic>.<domain>/login/`; keep both modes behind a tenant-resolution boundary so clinical workflows do not depend on URL shape.

## Staging architecture

```text
Browser -> CloudFront default HTTPS hostname
             |-- /clinic/<slug>/* -> private S3 Clinic App build
             `-- /api/clinics/<slug>/* -> API Gateway -> Lambda auth API
                                                |-- Cognito staff user pool
                                                `-- tenant/membership + session store
```

Use one staging staff user pool initially. Disable public self-registration. The backend owns the Cognito integration and uses a server-side sign-in flow; the browser never receives Cognito tokens or a client secret. The backend maps a clinic-visible username to an internal identity, verifies that the identity is an active member of the requested clinic, and then issues an opaque server-side session. The session cookie must be Secure, HttpOnly, SameSite, and host-only. The API must require CSRF protection for state-changing requests and return `Cache-Control: no-store`. CloudFront must not cache `/api/*` or expose the S3 bucket publicly.

For the API Gateway origin, use CloudFront's managed `AllViewerExceptHostHeader` origin request policy. It forwards cookies and the `Origin`/CSRF headers but lets API Gateway receive its own host name. Use the managed `CachingDisabled` cache policy for `/api/*`. Configure the API with the exact assigned CloudFront HTTPS origin for CSRF checks, and add an origin-only authentication header that CloudFront overwrites on the way to API Gateway; the Lambda must reject direct API requests missing that header. Keep the header value out of the browser and repository.

Because demo clinics share one `*.cloudfront.net` hostname, the server session is bound to a single clinic at a time. A request for another slug is denied; a user signs out before entering another clinic. This is a deliberate demo constraint. The final subdomain design will use separate host-only cookies per clinic.

The local `services/clinic-auth` SQLite service stays local-only and is never deployed to AWS. The AWS auth API needs a managed membership/session store, least-privilege IAM, audit events without credentials or patient data, rate limiting, session expiry/revocation, password-reset and MFA challenge handling, and two-clinic negative tests. Only synthetic staff and clinic records are permitted in this demo.

## Sequence

1. Completed: make the Clinic App and local test service understand the temporary clinic path. Preserve `<slug>.localhost` development URLs and leave the final subdomain mode configurable.
2. Completed for the first clinic: the product owner created the private S3 origin and CloudFront distribution, uploaded a build configured for the assigned hostname, attached [`infra/cloudfront/clinic-spa-rewrite.js`](../infra/cloudfront/clinic-spa-rewrite.js), and routed same-origin `/api/*` to the auth API. The Cognito staff pool, DynamoDB auth table, and Lambda are deployed in `ap-south-1`.
3. Completed for Goodwell only: one synthetic clinic, confirmed Cognito staff account, and matching membership were provisioned; the product owner verified sign-in. Blesswell and automated provisioning are not complete.
4. Cross-clinic session denial passed for a Goodwell session sent to the Blesswell path. Next verification: logout, expired/disabled sessions, no API caching, and CloudWatch logs. A separate Blesswell staff login is not yet tested. MFA and password recovery are not implemented and are prerequisites for a real-clinic pilot.
5. After a domain is purchased, add DNS and ACM certificates, route wildcard clinic subdomains, and enforce a hostname/path consistency check during migration.

## Current handoff

The Goodwell staging deployment was performed by the product owner. The CommonJS Lambda packaging fix was also applied in CloudShell; reconcile the corresponding local Git commit with GitHub before the next deployment. Continue with synthetic data only and record results of the remaining isolation tests.

Do not send access keys, client secrets, or passwords in chat.

## AWS references

- [CloudFront-assigned domain names](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/distribution-web-creating-console.html)
- [Default CloudFront HTTPS certificate](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistValuesGeneral.html)
- [Cognito server-side authentication](https://docs.aws.amazon.com/cognito/latest/developerguide/authentication-flows-public-server-side.html)
- [Cognito multi-tenant security recommendations](https://docs.aws.amazon.com/cognito/latest/developerguide/multi-tenancy-security-recommendations.html)
- [CloudFront API Gateway origin request policy](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-origin-request-policies.html)
- [CloudFront caching-disabled policy](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-cache-policies.html)
- [CloudFront origin custom headers](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/add-origin-custom-headers.html)

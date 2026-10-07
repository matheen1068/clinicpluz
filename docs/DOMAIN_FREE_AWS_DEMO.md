# Domain-free AWS clinic-login demo

Status: staging design for review. No AWS resources have been created by this repository.

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

1. Make the Clinic App and local test service understand the temporary clinic path. Preserve `<slug>.localhost` development URLs and leave the final subdomain mode configurable.
2. Create repeatable staging infrastructure for the private S3 origin, CloudFront distribution, same-origin API route, Cognito staff pool, and managed tenant/session storage. The application AWS Region is a deployment parameter. Attach [`infra/cloudfront/clinic-spa-rewrite.js`](../infra/cloudfront/clinic-spa-rewrite.js) to the default S3 behavior so a deep link to a clinic login loads the app. Route `/api/*` to the API origin before the default behavior, with caching disabled.
3. Deploy only after the stack, expected cost, IAM permissions, and environment inputs have been reviewed. Seed two synthetic clinics and staff accounts through a controlled setup path, never with committed passwords.
4. Verify both login flows, cross-clinic denial, logout, expired/disabled sessions, MFA and password recovery, no API caching, and CloudWatch logs. Share the assigned CloudFront URL for the demo.
5. After a domain is purchased, add DNS and ACM certificates, route wildcard clinic subdomains, and enforce a hostname/path consistency check during migration.

## User inputs needed before deployment

- AWS account and application Region to use for staging (the Region is not yet confirmed).
- Whether the AWS deployment will be made by the product owner or by the coordinating chat after review.
- A name for the first synthetic demo clinic. No real staff or patient details are needed.

Do not send access keys, client secrets, or passwords in chat.

## AWS references

- [CloudFront-assigned domain names](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/distribution-web-creating-console.html)
- [Default CloudFront HTTPS certificate](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistValuesGeneral.html)
- [Cognito server-side authentication](https://docs.aws.amazon.com/cognito/latest/developerguide/authentication-flows-public-server-side.html)
- [Cognito multi-tenant security recommendations](https://docs.aws.amazon.com/cognito/latest/developerguide/multi-tenancy-security-recommendations.html)
- [CloudFront API Gateway origin request policy](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-origin-request-policies.html)
- [CloudFront caching-disabled policy](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-cache-policies.html)
- [CloudFront origin custom headers](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/add-origin-custom-headers.html)

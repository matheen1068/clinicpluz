# Clinic App login: first implementation boundary

Agent Green's first deliverable is the Clinic App's login interface, a typed API contract, and a local-only service to exercise the flow with synthetic clinics. This is not a production authentication service until the AWS identity, persistence, and deployment configuration are implemented and verified.

## Expected flow

1. A staff member opens `https://<clinic-slug>.<owned-domain>/login/` once a domain is owned. The synthetic AWS staging demo may use `https://<distribution>.cloudfront.net/clinic/<slug>/login/`; local development uses a documented `*.localhost` hostname. In every mode, the server verifies clinic membership independently of the URL.
2. The Clinic App requests public clinic branding from a same-origin bootstrap endpoint. An unknown or disabled clinic shows an unavailable state. When no API responds, the approved synthetic demo host may display a clearly unverified design preview; it cannot establish a session.
3. Staff enter their individual username and password. The browser sends them only to the same-origin authentication endpoint over HTTPS in AWS (local development uses loopback HTTP). There is no demo bypass, default admin, self-assigned role, or one-click staff switching.
4. The backend authenticates the staff member, checks active membership in the clinic identified by the validated hostname or demo API path, and creates a host-only, HttpOnly, Secure session cookie. An owned clinic subdomain must match the API path clinic. Later API requests must recheck the session, clinic, role, and module entitlement as applicable.
5. The browser treats missing, expired, mismatched, or unavailable authentication as signed out. It does not store session tokens or clinical data in localStorage.

The server must validate allowed hostnames and trusted proxy forwarding before deriving the clinic. A subdomain is a routing hint, not authorization. Cross-clinic login and record access need negative tests with at least two synthetic clinics. The Control Panel will have a separate access boundary and will not inherit routine access to clinical records.

## Open implementation decisions

- Choose and configure the AWS identity provider and its multi-tenant user model. Amazon Cognito is a candidate. The local test credential store must not be used for the live pilot or as a substitute for this decision.
- Define staff invitation, password reset, MFA, suspension, and session expiry flows before inviting real clinic users.
- Choose the owned domain and staging hostnames. Example clinic names and `*.localhost` are for development only.
- Decide where clinic membership, roles, and module entitlements are stored, and how changes revoke existing access.

Do not use real patient data or call the login production-ready until the AWS backend, authorization checks, and two-clinic isolation tests pass.

# ClinicPluz working agreement

ClinicPluz is a staff-only clinic and small-hospital product. The immediate target is a safe pilot at one friend's clinic, with a path to a centralized multi-tenant SaaS later. Read `docs/PRODUCT_BRIEF.md` and `docs/LOGIN_SECURITY_NOTES.md` before implementing a feature. The AI Studio app at repository root is a visual reference; preserve it and build new work in dedicated `apps/` or `services/` folders.

## Team and scope

- **Coordinating chat:** works with the product owner, sets the next small milestone, reviews agent output, records decisions and blockers, and keeps the code branch coherent.
- **Agent Green — active:** owns the clinic-specific staff login, its Clinic App UI, the authentication API boundary, and verification for that slice. Green must demonstrate that the URL selects a clinic while the server independently checks staff membership. Green does not implement the Control Panel.
- **Agent Black — on hold:** will own the separate ClinicPluz Control Panel for clinic onboarding, staff access, and module entitlements. Black must not start product changes until the product owner lifts the hold.

Each handoff includes changed paths, the behavior proved, checks run, unresolved decisions, and the next dependency. Work on reviewable branches of the existing `matheen1068/clinicpluz` repository. Do not mix Control Panel and Clinic App changes into the same slice without a reviewed interface contract.

## Product boundaries

- Only authorized clinic staff use the product. Patients do not log in or book through it.
- Clinic staff enter both phone bookings and walk-ins, assign doctor and slot, and check in walk-ins.
- Each clinic has its own subdomain and staff login. A hostname is routing context, never proof of access. Enforce tenant isolation and role permissions on the server for every request.
- Until a domain is purchased, the synthetic AWS staging demo may use `/clinic/<slug>/login/` on one CloudFront-assigned hostname. The path is also routing context, never proof of access. See `docs/DOMAIN_FREE_AWS_DEMO.md`.
- No WhatsApp integration. Planned notifications use AWS SES when an email address is available.
- Keep staging and production distinct. The owned domain, production identity design, database, and AWS deployment details are not yet finalized. Do not present local demo storage or test credentials as production ready.
- Use synthetic records until clinical privacy, audit, backup, retention, and access controls are ready for real patient data.

Do not deploy, create external cloud resources, change sharing, send email, or delete prototype files as part of routine feature work. Ask the coordinating chat to resolve a decision that changes product scope or clinical workflow.

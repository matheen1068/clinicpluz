# ClinicPluz team

The product owner and this coordinating chat set priorities, resolve product decisions, and review work. GitHub `matheen1068/clinicpluz` is the source of truth for code. The root-level AI Studio prototype is preserved as reference material; new application work belongs in separate app folders and reviewable branches.

| Agent | Status | Ownership |
| --- | --- | --- |
| **Agent Green** | Active | Clinic App login, clinic-specific entry experience, and frontend authentication integration. Green must not present a mock or browser-only session as real authentication. |
| **Agent Black** | Active | Separate ClinicPluz Control Panel backend foundation for clinic onboarding, staff management, and module entitlements. No routine clinical-record access. |

Green hands off the login UI, its API contract, run instructions, checks, and any blocker to the coordinating chat. Black hands off the Control Panel API/data contract, tests, security boundary, and AWS prerequisites to the coordinator. Neither agent deploys, changes external sharing, sends emails, or uses real patient data without a separately scoped request.

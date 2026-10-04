# ClinicPluz pilot product brief

ClinicPluz is a staff-only management product for clinics and small hospitals. The first release will be tested at one pilot clinic before wider rollout. The current root-level AI Studio application is a design reference; keep its files and Git history intact while building the new product separately.

## Applications

- **Clinic App:** receptionists, nurses, doctors, lab staff, and clinic admins use it for daily care and operations. Patients do not log in.
- **ClinicPluz Control Panel:** the platform team creates clinics, manages clinic details and staff access, and enables modules. Platform access does not automatically grant access to clinical records.

Each clinic will have its own subdomain and `/login/` page. The exact owned domain remains to be chosen. Staff sign in with individual usernames and credentials. The subdomain selects the clinic experience; the server must independently verify that the staff member belongs to that clinic and is allowed to perform each action. There is no one-click role switching or default admin session in the real product.

## First clinic workflow

Patients either call the clinic to book or arrive as walk-ins. In both cases, authorized clinic staff find or register the patient, collect contact details including an email address when available, choose a doctor, and assign a time slot in ClinicPluz. Staff check a walk-in in immediately; a phone booking stays booked until arrival. Both paths feed the clinic's scheduling and queue view. Patients do not make bookings in the product themselves.

The pilot build should prove this path before expanding into vitals, consultation, prescription, reports, and billing. Appointment conflicts and queue/token assignment must be enforced by the backend, not just by browser state.

## Notifications and deployment

WhatsApp is out of scope. AWS SES will be used for email notifications, including patient-facing messages when an email address is available. Exact message types, content, consent, and secure delivery of clinical documents still need definition. The clinic handles its own printout process when a patient has no email.

AWS is the target cloud, with separate staging and production environments. The earlier architecture diagram was illustrative, so the primary database and API runtime are not yet fixed. Use synthetic data until the product's access control, audit, retention, backup, and privacy processes are ready for real patient records.

## First engineering milestone

Create a fresh Clinic App login experience without touching the root prototype. It must resolve the clinic from the URL, show the clinic identity, accept a staff username and password, and fail closed if the authentication service is unavailable. Backend authentication and tenant membership checks will be separate deliverables; a polished login screen alone is not a working sign-in system.

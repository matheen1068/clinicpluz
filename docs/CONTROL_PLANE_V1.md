# ClinicPluz Control Plane V1

## Purpose and boundary

The Control Panel is the platform team's workspace for onboarding and operating customer organizations and their clinic branches. Clinic App staff use a separate application for appointments, consultations, prescriptions, pharmacy handoff, and patient checkout. Platform operator access does not grant access to patient or clinical records.

The first release uses synthetic staging data. It must not be described as ready for real patient data until privacy, access review, audit, backup, retention, and operational controls are complete.

## Customer and branch model

- A **customer organization** is the business relationship and can own one or more clinic branches.
- A **branch** is a clinic operating location. Its branch name is unique within its customer. Its clinic slug is globally unique because the existing Clinic App authentication and URL routing use that slug. A label such as `Goodwell Clinic / Central` can produce a slug such as `goodwell-central`, but the slug is assigned and checked by the platform service; a label alone is not authorization.
- Staff memberships, modules, settings, and clinic data remain scoped to a branch unless a later, explicitly reviewed cross-branch access model is introduced. A staff identity linked to one branch does not gain another branch's access automatically.
- Existing synthetic clinics created before the customer model require an explicit migration or association. Do not silently change their slugs or tenant keys.

## Platform-owned workflows

1. Operator signs in through a separate identity boundary with MFA. Only allowlisted platform operators may call control APIs.
2. Operator creates a customer, then an inactive branch and its initial settings. All modules begin disabled.
3. Operator links an already provisioned and confirmed individual staff identity, assigns a branch role, and ensures there is an active clinic admin. Direct staff account creation/invitation is a follow-on workflow because the current Clinic App sign-in cannot complete Cognito's temporary-password challenge.
4. Operator enables an approved module set and activates the branch after reviewing its setup. Existing sessions must honor subsequent suspension and entitlement changes through server-side checks.
5. Operator can review customer/branch status, staff access, module settings, audit history, and aggregate operational health. Patient names, consultation notes, prescriptions, and clinical documents are outside routine Control Panel access.

The platform team owns clinic and user creation in V1. Clinic admins do not receive Control Panel access. The first dashboard shows operational data only: setup, staff access, feature status, and verified record metadata. Aggregate system-health counts may be added when a dedicated read API exists. It does not show patient names or clinical records. Patient billing remains in the Clinic App. A future ClinicPluz subscription billing system is a separate product feature.

## V1 screens and capabilities

| Area | First release | Later expansion |
| --- | --- | --- |
| Operator access | Separate sign-in, MFA, signed-out/error states | Operator roles, invitations, recovery and access reviews |
| Customers | Directory, create, detail, status | Contracts, subscription plan and multi-company account management |
| Branches | Create inactive, list/search, detail, unique branch name and clinic slug, activate/suspend | Self-service branch changes and owned-domain routing |
| Staff | List, link confirmed identity, edit role and access within a branch | Safe invitation and credential lifecycle, cross-branch grants |
| Modules | View and version-guard enabled modules; reject invalid dependencies | Plans, trials and scheduled changes |
| Operations | Basic setup status; administrative changes append audit records | Audit viewer, health metrics, delivery outcomes, alerting and support tooling |
| Settings | Document the ownership and contract for hours, doctor schedules, fees and email configuration | Editable settings once the consuming Clinic App services support them |

Supported clinic roles must match the Clinic App authentication service, including `pharmacist`. Module names and dependencies must match the services that enforce them; a Control Panel toggle alone cannot secure a feature.

## Engineering contract

- Keep the Control Panel app and API separate from the Clinic App. A clinic staff session cannot authorize a platform operation.
- Reuse the existing clinic authentication record shape for branch membership and entitlements while adding customer/branch metadata through a reviewed migration. Preserve tenant partitioning and globally unique clinic slugs.
- Authorize every control API server-side. Use conditional writes/version checks and append an audit event for administrative changes. Fail closed if operator identity or authorization cannot be verified.
- Do not put patient-level data or clinical-table read permissions in the routine Control Panel service. If support access is ever needed, design a separate, explicit, time-limited approval workflow.
- Keep staging and production distinct. Do not deploy as part of routine implementation; review infrastructure, access, migration, and cost first.

## Release checkpoints

1. Reconcile the older control backend with current clinic roles and entitlements; implement customer/branch directory and safe legacy-record handling.
2. Build an operator app against the verified API contract, with real authentication and clear loading, empty and error states.
3. Verify two-customer, multi-branch isolation; duplicate branch names/slugs; inactive-branch behavior; staff suspension; module dependencies; version conflicts; and audit writes.
4. Review the staging deployment and run a synthetic onboarding exercise before enabling it for operators.

Open decisions for a later slice: what aggregate operational metrics operators need, whether staff may work across branches, how clinic-owned settings are delegated, and how platform subscription billing will work.

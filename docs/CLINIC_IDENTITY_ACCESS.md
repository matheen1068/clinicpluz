# Clinic identity edit access (synthetic pilot)

The branch profile holds its logo, address, public phone, and public email. The Clinic App lets authorized staff update these details and uses them in prescription print and PDF output. The Control Panel controls which **roles** may edit them; individual clinic staff membership and active status are still checked by the clinic service.

The operator-only Control API exposes `GET` and `PUT /api/control/clinics/{slug}/profile-access`. A missing configuration returns the pilot defaults, `clinic_admin`, `receptionist`, and `doctor`, at version `0`. `PUT` accepts an exact `expectedVersion` and a list of distinct known role names. The write is conditional, branch scoped, and audited. An explicit empty list denies edits to every clinic role; the platform operator can restore access through the Control Panel.

The persisted record is in the shared auth table at `pk=CLINIC#<slug>`, `sk=PROFILE_ACCESS`, with a DynamoDB List of String `editRoles` and numeric `version`. Invalid saved roles fail closed. The clinic service reads this record strongly consistently on every profile mutation. A role change takes effect without changing a staff member's account or the clinic's module entitlements.

This is an operational permission setting. The Control Panel does not read patient records or clinical notes.

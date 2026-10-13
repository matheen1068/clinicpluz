# Clinic pilot: doctor schedule and prescription handoff

This slice is for the synthetic Goodwell staging demo. It does not make clinical decisions or permit real patient records.

## Decisions agreed with the product owner

- The doctor sees their own recorded appointments as 30-minute cards for the selected clinic day. Reception controls booking. An empty card means only that no visit is recorded in this view; it must not claim the doctor is available.
- Doctors enter medicine names and directions themselves. They may check morning, afternoon, and/or night and select before food, after food, with food, or not specified. Those structured choices replace the custom frequency field for that item; dose, route, duration, and additional instructions remain clinician-entered. No catalog or software rule chooses a medicine, dose, or timing.
- Only a doctor can save and finalize consultation notes and prescriptions. A finalized prescription is read-only. Reception and a separately signed-in pharmacist can see its medicine handoff, without full clinical notes or vitals.
- Reception can print a finalized prescription. Pharmacy can use the finalized medicine list to prepare the handoff. The staging email path is receptionist-only, uses the patient email saved at registration after address confirmation, and sends a server-generated PDF; it must stay unavailable until a sender identity and narrow SES permission are configured and tested with synthetic records.

## Security and release boundary

Every list, detail, and send request must recheck the staff session, clinic membership, role, and enabled module on the server. The handoff is limited to the canonical finalized encounter and excludes drafts. Pharmacy must not receive patient contact details through its handoff view. The email endpoint must not accept an arbitrary recipient from the browser. Do not log prescription content or the PDF.

AWS SES can use a [verified email address](https://docs.aws.amazon.com/ses/latest/dg/verify-addresses-and-domains.html) as the sender while ClinicPluz has no owned domain. In the SES sandbox, recipient addresses must also be verified; use only approved synthetic test addresses. [SES API v2 supports PDF attachments](https://docs.aws.amazon.com/ses/latest/dg/attachments.html). The clinic's real-patient email process still needs recipient verification, consent, document content review, delivery failure handling, and retention decisions before it is enabled.

The code for this slice is reviewable locally first. Updating the Cognito-backed auth Lambda, workflow Lambda, and static Clinic App in AWS is a separate staged deployment and verification step. The prior staging patient-history deployment does not include these changes.

## Staging rollout order

1. Deploy the updated clinic auth service so it recognizes the `pharmacist` role. Create a distinct synthetic pharmacist Cognito user and matching active Goodwell staff membership; never reuse a doctor's or receptionist's identity.
2. Deploy the workflow service with `EnablePrescriptionDemoEmail=false` (the default). Confirm the new handoff routes return `401` when signed out, that a pharmacist can only read finalized medicine orders, and that a receptionist can read and print them. Confirm a doctor can see only their own appointment cards and can save and finalize structured directions.
3. Publish the matching static Clinic App build after the workflow routes are live. Test with fresh fictional patient and medicine entries. A finalized prescription must stay read-only, appear in reception and pharmacy, and print without doctor notes or vitals.
4. For email testing, verify one sender and one synthetic recipient in SES in the stack's AWS Region. Review the exact recipient, IAM scope, message contents, and test record before enabling `EnablePrescriptionDemoEmail=true`. The saved patient email must equal that configured recipient. Confirm preview, explicit receptionist confirmation, SES acceptance, and one-shot behavior. A delivery failure or uncertain outcome needs a human review before any retry. Leave the feature disabled for other recipients and for real records.

The sender and recipient are deployment parameters, not source-code defaults. The application does not claim that SES acceptance proves delivery.

The first server PDF uses a built-in font that supports only basic Latin characters. If a patient name or clinician-entered direction contains an unsupported character, email fails before sending and reception can use the browser print view. A reviewed Unicode font and multilingual PDF layout are needed before wider use.

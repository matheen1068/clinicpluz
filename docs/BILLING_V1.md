# Clinic billing pilot: pharmacy fulfillment and combined checkout

Status: local synthetic-pilot implementation awaiting CloudShell build, staging deployment, and cross-role smoke tests. This does not authorize real-patient billing or a statutory tax invoice.

## Confirmed product decisions

- Only reception or a clinic admin performing reception duties may mark the combined bill paid.
- Pharmacy charges only for medicines and quantities actually handed to the patient, including partial fills. A prescription is a clinical order, not a sale.
- The doctor remains the only author of the prescription. Pharmacy records fulfillment and prices without changing the finalized clinical record.
- The existing `goodwell.admin` account can perform reception duties in the pilot; a new receptionist identity is not needed for this slice.
- Reception confirms a standard consultation fee at patient check-in. It may add the fee manually when check-in was not captured; the server still permits at most one consultation charge for that appointment.
- Goodwell's provisional standard consultation fee for the synthetic demo is INR 2,000. Store it as 200,000 paise; make the fee clinic-configurable rather than a global code constant.
- Goodwell's clinic and pharmacy use the same business and GST registration. The product may show one combined checkout, subject to review of the actual tax document format.

## Patient journey

1. Reception books or checks in a patient. The appointment is the billing episode. At check-in, reception confirms the standard consultation fee and the system stores a price snapshot. If an older booking has no recorded check-in, reception can add the same charge manually; a duplicate is rejected.
2. The assigned doctor completes and finalizes the encounter. If it contains medicines, the finalized order appears in the pharmacist's existing handoff queue.
3. The pharmacist records each product and quantity actually supplied, its unit price, and whether the order is completely or partly filled. Unsupplied items remain visible as not supplied and contribute zero to the charge. The system posts pharmacy charge lines to the same billing episode and makes it appear in the reception billing queue automatically.
4. Reception reviews the consultation and pharmacy line items and records the received payment. Money collected at check-in is an open-episode payment, even when it covers the current consultation charge: a final combined receipt waits until the consultation and pharmacy outcome are known and the balance is zero. The customer-facing final print view shows both sections and the payment confirmation. The pharmacist can print a pharmacy item slip if needed, but it must not claim that the combined bill is paid.
5. A bill with no clinic pharmacy purchase contains only the consultation charge. A partly paid episode remains visibly outstanding; it cannot be presented as paid.

This flow records cash, UPI, or card payments manually. It does not verify a bank transfer, initiate a payment, or integrate a payment gateway.

## Roles and screens

| Role | Pilot screen | Allowed actions |
| --- | --- | --- |
| Doctor | Consultations | Author and finalize clinical notes and prescriptions; no price or payment controls. |
| Pharmacist | Prescriptions / fulfillment | Read finalized medicines; record actual supplied product, quantity, and charge; view fulfillment status. No clinical notes, patient contact details, or paid control. |
| Receptionist or clinic admin | Billing dashboard | See doctor fee and posted pharmacy charges; record payment; print the paid customer receipt. Cannot edit the doctor's prescription. |
| Billing staff | Later | Separate access can be enabled after its exact clinic duties and account are defined. |

The billing dashboard should group episodes by **Awaiting consultation/pharmacy**, **Ready for checkout**, **Partly paid**, and **Paid**, with a date filter and a clear outstanding amount. Pharmacy needs **To prepare**, **Partly supplied**, **Not purchased**, and **Supplied** views. A fee prepayment does not make the combined episode final. A screen must not label an empty slot as available or an unverified payment as received.

Current workflow has no arrival check-in action for an existing phone booking: phone appointments remain `booked`, while a new walk-in starts `checked_in`. Add a receptionist **Check in** action for booked appointments as the first implementation dependency. Recording arrival and the standard fee must be coordinated so a retry cannot create a second charge.

## Record and API boundaries

- Key every record by clinic and appointment, and recheck session, active membership, role, and a new `billing` entitlement on every request. Pharmacy fulfillment also requires the existing consultations entitlement and a canonical finalized prescription. A browser-provided name, price, or role is never sufficient evidence of the source record; manual prices require explicit server validation and an audit trail.
- Store consultation charges, fulfillment lines, bill revisions, payments, and issued receipt snapshots as separate records. Keep monetary values as integer paise, with an explicit currency, quantity unit, item description, price source, and actor/time audit fields. The receipt captures the amounts as issued rather than recomputing against a later fee change.
- Treat payment entries and issued receipts as append-only. Corrections need a void, refund, or credit workflow with a reason and original document reference; do not silently edit a paid receipt.
- Use conditional writes and a stable operation ID when posting fulfillment, recording payment, and issuing the receipt. A repeated click or uncertain network response must not create duplicate charges, payments, or receipt numbers. DynamoDB transactions can atomically check a bill revision and update its related records; their client request token alone is only a short idempotency window, so the application also needs durable operation IDs.
- Do not put full clinical notes, vitals, patient phone, or email in pharmacy billing responses or application logs. A pharmacist may see the minimum patient identity needed to match the handoff.

## Price and tax boundary

The pilot can start with a clinic-configured standard consultation fee, confirmed by reception at check-in, and pharmacist-entered prices for synthetic supplied items. Each price needs an audit trail. Doctor-specific fee schedules can follow. The doctor does not set pharmacy prices. A later clinic-specific price and stock catalogue can replace manual pricing without changing finalized prescription records. Substitutions need an explicit clinic-approved process; they must not silently rewrite the doctor's order.

Pilot defaults: a clinic admin sets the standard fee; reception can add the fee to a visit but cannot silently change its price. Pharmacy records a manual unit price for each synthetic item actually supplied. There are no discounts in the first slice. The pharmacist may record handover before reception checkout, as described for this clinic, and the episode remains visibly unpaid until reception confirms the money received.

Build one **checkout summary** for the patient, with doctor and pharmacy sections. Whether it can also be a single statutory invoice depends on the clinic/pharmacy supplier identity, registration, tax treatment, and the clinic accountant's approved format. GST invoice rules include serial numbering and item-level goods/services details; no hard-coded tax rate or claim of compliance belongs in this synthetic pilot. Keep tax category and document type explicit so the final format can be reviewed before real use. See [CBIC invoice rules](https://cbic-gst.gov.in/gst-invoice-rules.html) and the [GST portal's goods-and-services invoice FAQ](https://tutorial.gst.gov.in/userguide/returns/GSTR_1.htm).

## Build order and acceptance checks

1. Add a receptionist arrival check-in action for booked visits and define the billing record and role contract. Add two-clinic isolation, duplicate-submit, stale-revision, partial-fill, and no-prescription cases before deploying any billing write route.
2. Add pharmacist fulfillment on top of the finalized handoff. Show only actual supplied lines in the pending bill; leave unfilled medicines uncharged.
3. Add the reception billing dashboard. Snapshot doctor fee, combine posted charges, record payment and outstanding balance, and issue an immutable synthetic-demo receipt only after the doctor and pharmacy outcome is closed and the balance reaches zero.
4. Verify role separation and the printed result in staging with fictional records. Test fee-only, full fill, partial fill, no supply, a fee prepayment followed by later pharmacy charges, split payments, duplicate clicks, and rejection of edits after receipt issue. Keep patient email and live payment processing out of this first release.

## Decisions for a later clinic policy review

- What authority should reception have for discounts, fee overrides, and refunds? The first slice grants none.
- Should the real clinic permit medicine handover before checkout is paid? The synthetic pilot allows it and shows the unpaid balance; the real policy needs clinic approval.

# Patient history: first clinic pilot

This slice lets an assigned doctor review a patient's **earlier finalized clinic visits** while working on the current appointment. It remains a synthetic staging feature; no real patient records should be entered yet.

## Staff workflow

1. The doctor opens one of their assigned visits in Consultations.
2. A separate history section lists that patient's earlier finalized encounters in this clinic, newest first. It identifies the visit date and clinician. Drafts and the current appointment are excluded.
3. The doctor opens a history item to read its recorded vitals, clinical note, and doctor-entered prescription text. This is read-only. It does not alter the current consultation form, copy medicine directions into it, or make clinical recommendations.
4. The list is bounded and can load older entries in pages. Empty, unavailable, and access-denied states are visible without blocking the current encounter.

## Access and data boundary

The browser supplies the current appointment identity, but the API finds its patient from the clinic's persisted appointment record. It confirms the signed-in doctor is currently assigned to that appointment before listing or reading history. Historical detail is returned only after the API verifies that it is finalized and belongs to the same patient and clinic. A different doctor may have authored the historical visit. Nurses, receptionists, clinic admins, and patients cannot use this first history endpoint.

The history index should contain pointers and limited display metadata, not copied note or prescription text. Create its entry atomically with encounter finalization. Keep searches scoped by clinic and patient, with a fixed page size; do not scan the whole clinical table. If an older finalized staging encounter predates the index, it needs a reviewed backfill before it appears. Do not silently expose drafts or infer a complete history from an incomplete index.

API responses remain uncached and avoid clinical text in URLs, logs, analytics, or browser storage. A history view is not a medication safety check. The clinician remains responsible for interpreting prior records and current care.

## Acceptance for this slice

- Two synthetic clinics and two synthetic patients cannot read each other's history.
- A doctor may view previous finalized visits for the patient on their assigned current appointment, including a visit finalized by another doctor in the same clinic.
- Drafts, unrelated patient visits, and another clinic's records are denied or absent.
- The current consultation remains editable independently of a history load or read failure.
- Listing remains bounded with many indexed visits and pagination does not duplicate or skip records.

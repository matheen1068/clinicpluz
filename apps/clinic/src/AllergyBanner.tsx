/** Always-visible allergy line for the visit record. null/undefined = never recorded; [] = recorded as none known. */
export function AllergyBanner({ allergies }: { allergies?: readonly string[] | null }) {
  if (!allergies) return <p className="allergy-banner is-unrecorded" role="status"><strong>Allergies:</strong> not recorded. Ask the patient.</p>;
  if (allergies.length === 0) return <p className="allergy-banner is-none" role="status"><strong>Allergies:</strong> none known (as recorded at registration).</p>;
  return <p className="allergy-banner is-listed" role="status"><strong>Allergies:</strong> {allergies.join(', ')}</p>;
}

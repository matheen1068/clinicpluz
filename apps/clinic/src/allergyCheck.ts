/**
 * Advisory text match between a doctor-entered medicine name and the patient's recorded allergy text.
 * It knows nothing about drug classes or cross-reactivity (for example penicillin vs amoxicillin), so a
 * missing match is never evidence of safety. The UI must say so and must never block the doctor.
 */
function words(value: string): string[] {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 4);
}

export function matchingAllergies(medicineName: string, allergies: readonly string[] | null | undefined): string[] {
  if (!allergies || allergies.length === 0) return [];
  const medicineWords = words(medicineName);
  if (medicineWords.length === 0) return [];
  return allergies.filter((allergy) => {
    const allergyWords = words(allergy);
    return allergyWords.some((a) => medicineWords.some((m) => m === a || m.includes(a) || a.includes(m)));
  });
}

export function parseAllergyInput(value: string): string[] {
  return value.split(/[,\n;]+/).map((part) => part.trim().replace(/\s+/g, ' ')).filter(Boolean);
}

import type { Medication } from './consultationApi.ts';

const TIME_LABELS = { morning: 'Morning', afternoon: 'Afternoon', night: 'Night' } as const;
const MEAL_LABELS = { before: 'Before food', after: 'After food', with: 'With food', unspecified: 'Food timing not specified' } as const;

// Displays exactly the clinician-entered direction fields; it does not infer dose or frequency.
export function medicationTimingText(medication: Medication): string {
  if (medication.timing) {
    return `${medication.timing.timesOfDay.map((time) => TIME_LABELS[time]).join(', ')} · ${MEAL_LABELS[medication.timing.mealRelation]}`;
  }
  return medication.frequency ? `Custom frequency: ${medication.frequency}` : 'Frequency not entered';
}

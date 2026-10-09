import type { ConsultationNote, Medication, Vitals, VitalsInput } from './consultationApi.ts';

export const VITAL_FIELDS = [
  { key: 'systolicBpMmHg', label: 'Systolic BP', unit: 'mmHg' },
  { key: 'diastolicBpMmHg', label: 'Diastolic BP', unit: 'mmHg' },
  { key: 'pulseBpm', label: 'Pulse', unit: 'bpm' },
  { key: 'spo2Percent', label: 'SpO₂', unit: '%' },
  { key: 'temperatureC', label: 'Temperature', unit: '°C' },
  { key: 'weightKg', label: 'Weight', unit: 'kg' },
  { key: 'heightCm', label: 'Height', unit: 'cm' },
] as const;

export type VitalKey = (typeof VITAL_FIELDS)[number]['key'];
export type VitalForm = { observedAt: string } & Record<VitalKey, string>;
export interface RecoverySnapshot {
  vitalChanges: Partial<VitalForm>;
  localObservedAt: string | null;
  noteChanges: Partial<ConsultationNote>;
  medications: Medication[] | null;
}
const VITAL_LIMITS: Record<VitalKey, readonly [number, number]> = {
  systolicBpMmHg: [1, 400], diastolicBpMmHg: [1, 300], pulseBpm: [1, 350],
  spo2Percent: [0, 100], temperatureC: [0, 50], weightKg: [0, 500], heightCm: [0, 300],
};

export function emptyNote(): ConsultationNote {
  return { chiefComplaint: '', history: '', exam: '', assessment: '', plan: '' };
}
export function emptyMedication(): Medication {
  return { name: '', strength: '', dose: '', route: '', frequency: '', duration: '', instructions: '' };
}
function kolkataParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (part: string) => parts.find((item) => item.type === part)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}
export function kolkataLocalInput(now = new Date()): string { return kolkataParts(now); }
export function toKolkataIso(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const parsed = new Date(`${local}:00+05:30`);
  return Number.isFinite(parsed.getTime()) && kolkataParts(parsed) === local ? parsed.toISOString() : null;
}
export function vitalFormFrom(vitals: Vitals | null, now = new Date()): VitalForm {
  const fields = Object.fromEntries(VITAL_FIELDS.map(({ key }) => [key, vitals?.[key] === undefined ? '' : String(vitals[key])])) as Record<VitalKey, string>;
  return { observedAt: vitals ? kolkataParts(new Date(vitals.observedAt)) : kolkataLocalInput(now), ...fields };
}
export function parseVitalForm(form: VitalForm, now = new Date()): VitalsInput | null {
  const observedAt = toKolkataIso(form.observedAt);
  if (!observedAt) return null;
  const observedMs = Date.parse(observedAt);
  if (observedMs > now.getTime() + 5 * 60_000 || observedMs < now.getTime() - 30 * 24 * 60 * 60_000) return null;
  const measurements: Partial<Record<VitalKey, number>> = {};
  for (const { key } of VITAL_FIELDS) {
    const raw = form[key].trim();
    if (!raw) continue;
    const number = Number(raw);
    const [min, max] = VITAL_LIMITS[key];
    if (!Number.isFinite(number) || number < min || number > max) return null;
    measurements[key] = number;
  }
  if (Object.keys(measurements).length === 0 ||
      (measurements.systolicBpMmHg === undefined) !== (measurements.diastolicBpMmHg === undefined)) return null;
  return { observedAt, ...measurements };
}
export function snapshotEdits(
  vitalForm: VitalForm, vitalBaseline: VitalForm,
  note: ConsultationNote, noteBaseline: ConsultationNote,
  medications: Medication[], medicationBaseline: Medication[],
): RecoverySnapshot | null {
  const vitalChanges: Partial<VitalForm> = {};
  for (const key of ['observedAt', ...VITAL_FIELDS.map(({ key }) => key)] as (keyof VitalForm)[]) {
    if (vitalForm[key] !== vitalBaseline[key]) vitalChanges[key] = vitalForm[key];
  }
  const noteChanges: Partial<ConsultationNote> = {};
  for (const key of ['chiefComplaint', 'history', 'exam', 'assessment', 'plan'] as const) {
    if (note[key] !== noteBaseline[key]) noteChanges[key] = note[key];
  }
  const medicineChanges = JSON.stringify(medications) !== JSON.stringify(medicationBaseline)
    ? medications.map((item) => ({ ...item })) : null;
  if (Object.keys(vitalChanges).length === 0 && Object.keys(noteChanges).length === 0 && medicineChanges === null) return null;
  return {
    vitalChanges,
    localObservedAt: Object.keys(vitalChanges).length ? vitalForm.observedAt : null,
    noteChanges,
    medications: medicineChanges,
  };
}
export function mergeRecoveredFields(snapshot: RecoverySnapshot, serverVitals: VitalForm, serverNote: ConsultationNote): {
  vitals: VitalForm;
  note: ConsultationNote;
} {
  return {
    vitals: { ...serverVitals, ...snapshot.vitalChanges },
    note: { ...serverNote, ...snapshot.noteChanges },
  };
}
export function completeForFinalize(note: ConsultationNote, medications: Medication[]): boolean {
  return note.assessment.trim().length > 0 && note.plan.trim().length > 0 &&
    medications.every((medication) => medication.name.trim().length > 0 && medication.dose.trim().length > 0 &&
      medication.route.trim().length > 0 && medication.frequency.trim().length > 0 &&
      medication.duration.trim().length > 0 && medication.instructions.trim().length > 0);
}

export interface Vitals {
  observedAt: string;
  recordedAt: string;
  recordedBySub: string;
  recordedByDisplayName: string;
  systolicBpMmHg?: number;
  diastolicBpMmHg?: number;
  pulseBpm?: number;
  spo2Percent?: number;
  temperatureC?: number;
  weightKg?: number;
  heightCm?: number;
}

export interface Note {
  chiefComplaint: string;
  history: string;
  exam: string;
  assessment: string;
  plan: string;
}

export interface Medication {
  name: string;
  strength: string;
  dose: string;
  route: string;
  frequency: string;
  duration: string;
  instructions: string;
}

export interface MedicationRecord extends Medication {
  prescriberSub: string;
  encounterAppointmentId: string;
  orderedAt: string;
}

export interface Encounter {
  appointmentId: string;
  clinicDate: string;
  patientId: string;
  doctorId: string;
  status: 'draft' | 'finalized';
  revision: number;
  vitals: Vitals | null;
  note: Note;
  medications: MedicationRecord[];
  noteAuthorSub: string | null;
  updatedAt: string | null;
  finalizedAt: string | null;
  finalizedBySub: string | null;
  finalizedByDisplayName: string | null;
  finalizedDoctorId: string | null;
}

export const EMPTY_NOTE: Note = {
  chiefComplaint: '', history: '', exam: '', assessment: '', plan: '',
};

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}
function isoInstant(value: unknown): Date | null {
  if (typeof value !== 'string' || value.length > 35) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match || Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59 ||
      (match[8] && (Number(match[8]) > 14 || Number(match[9]) > 59 ||
        (Number(match[8]) === 14 && Number(match[9]) !== 0)))) return null;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const calendar = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== date) return null;
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

const measurements = {
  systolicBpMmHg: [1, 400], diastolicBpMmHg: [1, 300], pulseBpm: [1, 350],
  spo2Percent: [0, 100], temperatureC: [0, 50], weightKg: [0, 500], heightCm: [0, 300],
} as const;

export function parseVitals(value: unknown, now: Date, actorSub: string, actorName: string): Vitals | null {
  if (!object(value) || typeof value.observedAt !== 'string' ||
      !exactKeys(value, ['observedAt', ...Object.keys(measurements)])) return null;
  const instant = isoInstant(value.observedAt);
  if (!instant || instant.getTime() > now.getTime() + 5 * 60_000 ||
      instant.getTime() < now.getTime() - 30 * 24 * 60 * 60_000) return null;
  const readings: Partial<Record<keyof typeof measurements, number>> = {};
  for (const [key, [min, max]] of Object.entries(measurements) as Array<[keyof typeof measurements, readonly [number, number]]>) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < min || value[key] > max) return null;
    readings[key] = value[key] as number;
  }
  if (Object.keys(readings).length === 0 ||
      (readings.systolicBpMmHg === undefined) !== (readings.diastolicBpMmHg === undefined)) return null;
  return { observedAt: value.observedAt, recordedAt: now.toISOString(),
    recordedBySub: actorSub, recordedByDisplayName: actorName, ...readings };
}

function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) return null;
  return value.trim();
}

export function parseNote(value: unknown): Note | null {
  const keys = Object.keys(EMPTY_NOTE) as Array<keyof Note>;
  if (!object(value) || !exactKeys(value, keys) || !keys.every((key) => key in value)) return null;
  const note = {} as Note;
  for (const key of keys) {
    const text = boundedText(value[key], 3000);
    if (text === null) return null;
    note[key] = text;
  }
  return note;
}

export function parseMedications(value: unknown, actorSub: string, appointmentId: string, now: Date): MedicationRecord[] | null {
  const keys: Array<keyof Medication> = ['name', 'strength', 'dose', 'route', 'frequency', 'duration', 'instructions'];
  if (!Array.isArray(value) || value.length > 20) return null;
  const records: MedicationRecord[] = [];
  for (const row of value) {
    if (!object(row) || !exactKeys(row, keys) || !keys.every((key) => key in row)) return null;
    const medication = {} as Medication;
    for (const key of keys) {
      const text = boundedText(row[key], key === 'instructions' ? 500 : 160);
      if (text === null) return null;
      medication[key] = text;
    }
    if (!medication.name) return null;
    records.push({ ...medication, prescriberSub: actorSub,
      encounterAppointmentId: appointmentId, orderedAt: now.toISOString() });
  }
  return records;
}

export function medicationForDisplay(record: MedicationRecord): Medication {
  const { name, strength, dose, route, frequency, duration, instructions } = record;
  return { name, strength, dose, route, frequency, duration, instructions };
}

export function readyToFinalize(encounter: Encounter): boolean {
  return encounter.note.assessment.length > 0 && encounter.note.plan.length > 0 &&
    encounter.medications.every((medication) => Boolean(medication.name && medication.dose &&
      medication.route && medication.frequency && medication.duration && medication.instructions));
}

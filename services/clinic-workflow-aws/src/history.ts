export interface HistoryEntry {
  historyId: string;
  clinicSlug: string;
  patientId: string;
  appointmentId: string;
  clinicDate: string;
  visitAt: string;
  visitUtc: string;
  finalizedAt: string;
  status: 'finalized';
  doctor: { id: string; displayName: string };
}

const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const HISTORY_ID = /^VISIT#(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)#APPOINTMENT#([A-Za-z0-9_-]{1,64})$/;

export function historyIdFor(visitUtc: string, appointmentId: string): string {
  if (!UTC_INSTANT.test(visitUtc) || new Date(visitUtc).toISOString() !== visitUtc ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(appointmentId)) throw new Error('Invalid history key');
  return `VISIT#${visitUtc}#APPOINTMENT#${appointmentId}`;
}

export function validHistoryId(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 128) return false;
  const match = HISTORY_ID.exec(value);
  if (!match) return false;
  const date = new Date(match[1]);
  return !Number.isNaN(date.getTime()) && date.toISOString() === match[1];
}

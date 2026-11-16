import { validClinicSlug } from './tenant.ts';

export interface DaybookMethods { cash: number; upi: number; card: number }
export interface DaybookRow {
  clinicDate: string; appointmentId: string; patientId: string; patientName: string;
  doctorId: string; doctorName: string; startAt: string; source: 'phone' | 'walk_in';
  attended: boolean; completed: boolean; consultationPaise: number | null;
  /** Clinic money fields are absent for the doctor's own view. */
  pharmacyPaise?: number | null; paidPaise?: number | null; receiptIssued?: boolean | null; methods?: DaybookMethods | null;
}
export interface Daybook { from: string; to: string; scope: 'clinic' | 'doctor'; money: boolean; rows: DaybookRow[] }
export interface DaybookTotals {
  booked: number; attended: number; completed: number; consultationPaise: number; pharmacyPaise: number;
  billedPaise: number; paidPaise: number; outstandingPaise: number; methods: DaybookMethods;
}
export interface DaybookDay extends DaybookTotals { date: string; rows: DaybookRow[] }

export class DaybookApiError extends Error {
  readonly status: number | null;
  constructor(status: number | null, message: string) { super(message); this.name = 'DaybookApiError'; this.status = status; }
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = 200): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const paise = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const optionalPaise = (value: unknown): boolean => value === undefined || value === null || paise(value);
export function validDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
export function shiftDay(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
export function validRange(from: string, to: string): boolean {
  if (!validDay(from) || !validDay(to)) return false;
  const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  return span >= 0 && span <= 30;
}

export function parseDaybook(value: unknown, from: string, to: string): Daybook {
  if (!isRecord(value) || value.from !== from || value.to !== to || (value.scope !== 'clinic' && value.scope !== 'doctor') ||
      typeof value.money !== 'boolean' || !Array.isArray(value.rows) || value.rows.length > 7000) {
    throw new DaybookApiError(null, 'Invalid daybook response');
  }
  const rows = value.rows.map((row: unknown): DaybookRow => {
    if (!isRecord(row) || !validDay(row.clinicDate) || row.clinicDate < from || row.clinicDate > to ||
        !text(row.appointmentId) || !text(row.patientId) || !text(row.patientName) || !text(row.doctorId) || !text(row.doctorName) ||
        !text(row.startAt, 40) || !Number.isFinite(Date.parse(row.startAt)) || (row.source !== 'phone' && row.source !== 'walk_in') ||
        typeof row.attended !== 'boolean' || typeof row.completed !== 'boolean' ||
        !(row.consultationPaise === null || paise(row.consultationPaise)) || !optionalPaise(row.pharmacyPaise) || !optionalPaise(row.paidPaise) ||
        !(row.receiptIssued === undefined || row.receiptIssued === null || typeof row.receiptIssued === 'boolean') ||
        !(row.methods === undefined || row.methods === null ||
          (isRecord(row.methods) && paise(row.methods.cash) && paise(row.methods.upi) && paise(row.methods.card)))) {
      throw new DaybookApiError(null, 'Invalid daybook row');
    }
    return row as unknown as DaybookRow;
  });
  return { from, to, scope: value.scope, money: value.money, rows };
}

export async function getDaybook(slug: string, from: string, to: string, signal?: AbortSignal): Promise<Daybook> {
  if (!validClinicSlug(slug) || !validRange(from, to)) throw new DaybookApiError(null, 'Invalid daybook range');
  let response: Response;
  try {
    response = await fetch(`/api/workflow/clinics/${slug}/daybook?from=${from}&to=${to}`, {
      credentials: 'include', cache: 'no-store', mode: 'same-origin', redirect: 'error', headers: { Accept: 'application/json' },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new DaybookApiError(null, 'Daybook service unavailable');
  }
  const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  const json = contentType === 'application/json' || contentType?.endsWith('+json');
  if (!response.ok) throw new DaybookApiError(json ? response.status : null, 'Daybook request failed');
  if (!json) throw new DaybookApiError(null, 'Invalid daybook response');
  let value: unknown;
  try { value = await response.json(); } catch { throw new DaybookApiError(null, 'Invalid daybook response'); }
  return parseDaybook(value, from, to);
}

function emptyTotals(): DaybookTotals {
  return { booked: 0, attended: 0, completed: 0, consultationPaise: 0, pharmacyPaise: 0, billedPaise: 0, paidPaise: 0,
    outstandingPaise: 0, methods: { cash: 0, upi: 0, card: 0 } };
}
function add(totals: DaybookTotals, row: DaybookRow): void {
  totals.booked += 1;
  if (row.attended) totals.attended += 1;
  if (row.completed) totals.completed += 1;
  const billed = (row.consultationPaise ?? 0) + (row.pharmacyPaise ?? 0);
  totals.consultationPaise += row.consultationPaise ?? 0;
  totals.pharmacyPaise += row.pharmacyPaise ?? 0;
  totals.billedPaise += billed;
  totals.paidPaise += row.paidPaise ?? 0;
  if (row.paidPaise !== undefined && row.paidPaise !== null) totals.outstandingPaise += Math.max(0, billed - row.paidPaise);
  if (row.methods) { totals.methods.cash += row.methods.cash; totals.methods.upi += row.methods.upi; totals.methods.card += row.methods.card; }
}
/** Filter by doctor ('' = all), then total the range and each day (newest day first). */
export function summarize(rows: DaybookRow[], doctorId: string): { totals: DaybookTotals; days: DaybookDay[]; doctors: { id: string; name: string; attended: number }[] } {
  const doctors = new Map<string, { id: string; name: string; attended: number }>();
  for (const row of rows) {
    const entry = doctors.get(row.doctorId) ?? { id: row.doctorId, name: row.doctorName, attended: 0 };
    if (row.attended) entry.attended += 1;
    doctors.set(row.doctorId, entry);
  }
  const totals = emptyTotals();
  const byDay = new Map<string, DaybookDay>();
  for (const row of rows) {
    if (doctorId && row.doctorId !== doctorId) continue;
    add(totals, row);
    let day = byDay.get(row.clinicDate);
    if (!day) { day = { date: row.clinicDate, rows: [], ...emptyTotals() }; byDay.set(row.clinicDate, day); }
    add(day, row); day.rows.push(row);
  }
  const days = [...byDay.values()].sort((a, b) => b.date.localeCompare(a.date));
  for (const day of days) day.rows.sort((a, b) => a.startAt.localeCompare(b.startAt));
  return { totals, days, doctors: [...doctors.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}

function cell(value: string | number): string {
  let out = String(value);
  // Stop spreadsheet apps from treating staff-entered text as a formula.
  if (/^[=+\-@\t\r]/.test(out) && typeof value === 'string') out = `'${out}`;
  return /[",\n\r]/.test(out) ? `"${out.replace(/"/g, '""')}"` : out;
}
const rupees = (value: number | null | undefined): string => value === null || value === undefined ? '' : (value / 100).toFixed(2);
/** CSV that Excel and Google Sheets open directly. Amounts are plain rupee numbers so they can be summed. */
export function daybookCsv(days: DaybookDay[], scope: 'clinic' | 'doctor'): string {
  const clinic = scope === 'clinic';
  const header = ['Date', 'Time', 'Patient', 'Patient ID', 'Doctor', 'Arrived by', 'Attended', 'Consultation completed', 'Consultation fee (INR)',
    ...(clinic ? ['Pharmacy (INR)', 'Total billed (INR)', 'Received (INR)', 'Outstanding (INR)', 'Cash (INR)', 'UPI (INR)', 'Card (INR)', 'Receipt issued'] : [])];
  const lines = [header.map(cell).join(',')];
  for (const day of [...days].reverse()) for (const row of day.rows) {
    const billed = (row.consultationPaise ?? 0) + (row.pharmacyPaise ?? 0);
    const time = new Date(row.startAt).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
    lines.push([row.clinicDate, time, row.patientName, row.patientId, row.doctorName, row.source === 'walk_in' ? 'Walk-in' : 'Phone',
      row.attended ? 'Yes' : 'No', row.completed ? 'Yes' : 'No', rupees(row.consultationPaise),
      ...(clinic ? [rupees(row.pharmacyPaise), row.paidPaise === null || row.paidPaise === undefined ? '' : rupees(billed), rupees(row.paidPaise),
        row.paidPaise === null || row.paidPaise === undefined ? '' : rupees(Math.max(0, billed - row.paidPaise)),
        rupees(row.methods?.cash), rupees(row.methods?.upi), rupees(row.methods?.card), row.receiptIssued ? 'Yes' : 'No'] : []),
    ].map(cell).join(','));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

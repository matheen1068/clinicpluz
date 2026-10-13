import type { ConsultationQueueItem } from './consultationApi.ts';

// Provisional pilot hours only. Empty cards do not assert that a doctor is available.
export const PILOT_DOCTOR_SLOTS = Array.from({ length: 18 }, (_, index) => {
  const minutes = 9 * 60 + 30 + index * 30;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
});

function clinicClock(startAt: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(startAt));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('hour')}:${part('minute')}`;
}

export function doctorDaySlots(items: ConsultationQueueItem[]) {
  const byTime = new Map<string, ConsultationQueueItem[]>();
  for (const item of items) {
    const time = clinicClock(item.startAt);
    byTime.set(time, [...(byTime.get(time) ?? []), item]);
  }
  const slots = PILOT_DOCTOR_SLOTS.map((time) => ({ time, visits: byTime.get(time) ?? [] }));
  const outside = items.filter((item) => !PILOT_DOCTOR_SLOTS.includes(clinicClock(item.startAt)))
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  return { slots, outside };
}

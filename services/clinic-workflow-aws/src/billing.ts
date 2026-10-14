import type { Appointment, Clinic } from './core.ts';
import type { Encounter } from './consultation.ts';

export const MAX_EPISODE_PAISE = 100_000_000;
export const QUANTITY_UNITS = ['tablet', 'capsule', 'ml', 'g', 'piece', 'pack'] as const;
export type QuantityUnit = typeof QUANTITY_UNITS[number];
export type PaymentMethod = 'cash' | 'upi' | 'card';
export type SupplyStatus = 'partly_supplied' | 'supplied';

export interface BillingConfig {
  currency: 'INR'; consultationFeePaise: number; version: number;
}
export interface BillEpisode {
  appointmentId: string; clinicDate: string; patientId: string; patientName: string;
  currency: 'INR'; revision: number; consultationTotalPaise: number;
  pharmacyTotalPaise: number; paidPaise: number; pharmacyClosed: boolean;
  pharmacyLineCount: number; paymentCount: number; receiptIssued: boolean;
  createdAt: string; updatedAt: string;
}
export interface BillCharge {
  id: string; kind: 'consultation' | 'pharmacy'; description: string;
  quantity: number; quantityUnit: string; unitPricePaise: number; amountPaise: number;
  source: 'clinic_config' | 'pharmacy_manual'; prescriptionIndex?: number;
  prescriptionRevision?: number; createdAt: string; actorSub: string;
}
export interface BillPayment {
  id: string; amountPaise: number; method: PaymentMethod; reference: string | null;
  recordedAt: string; actorSub: string;
}
export interface BillReceipt {
  id: string; label: 'SYNTHETIC DEMO RECEIPT';
  clinic: { slug: string; displayName: string };
  patient: { id: string; fullName: string };
  appointmentId: string; clinicDate: string; issuedAt: string; issuedBySub: string;
  currency: 'INR'; charges: BillCharge[]; payments: BillPayment[];
  totalPaise: number; paidPaise: number; outstandingPaise: 0;
}
export interface BillOperation { id: string; kind: string; fingerprint: string; at: string }
export interface FulfillmentEvent {
  id: string; prescriptionRevision: number; items: Array<{
    prescriptionIndex: number; quantity: number; quantityUnit: QuantityUnit;
    unitPricePaise: number; amountPaise: number; status: SupplyStatus;
    name: string; strength: string;
  }>;
  closeForCheckout: boolean; recordedAt: string; actorSub: string;
}
export interface EpisodeRecords {
  episode: BillEpisode | null; charges: BillCharge[]; payments: BillPayment[];
  fulfillment: FulfillmentEvent[]; receipt: BillReceipt | null;
}

export interface BillingWrite {
  appointment: Appointment;
  actorSub: string;
  previousRevision: number;
  nextEpisode: BillEpisode;
  operation: BillOperation;
  charges?: BillCharge[];
  payment?: BillPayment;
  fulfillment?: FulfillmentEvent;
  receipt?: BillReceipt;
  checkInBooked?: boolean;
  requireCheckedIn?: boolean;
  encounterRevision?: number;
  configVersion?: number;
}

export interface BillingStore {
  getConfig(slug: string): Promise<BillingConfig | null>;
  listEpisodes(slug: string, clinicDate: string): Promise<BillEpisode[]>;
  load(slug: string, appointmentId: string): Promise<EpisodeRecords>;
  getOperation(slug: string, appointmentId: string, operationId: string): Promise<BillOperation | null>;
  commit(slug: string, write: BillingWrite): Promise<boolean>;
}

export function validPaise(value: unknown, max = MAX_EPISODE_PAISE): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max;
}
export function validOperationId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
export function chargeAmount(quantity: unknown, unitPricePaise: unknown): number | null {
  if (typeof quantity !== 'number' || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10_000 ||
      !validPaise(unitPricePaise, 10_000_000)) return null;
  const amount = quantity * unitPricePaise;
  return validPaise(amount) ? amount : null;
}
export function totalPaise(episode: BillEpisode): number {
  const total = episode.consultationTotalPaise + episode.pharmacyTotalPaise;
  if (!validPaise(total) || !validPaise(episode.paidPaise) || episode.paidPaise > total) {
    throw new Error('Invalid billing totals');
  }
  return total;
}
export function episodeView(episode: BillEpisode, appointment: Appointment, encounter: Encounter | null) {
  if (episode.appointmentId !== appointment.id || episode.clinicDate !== appointment.clinicDate ||
      episode.patientId !== appointment.patientId || episode.patientName !== appointment.patientName ||
      episode.currency !== 'INR' || !Number.isSafeInteger(episode.revision) || episode.revision < 0) {
    throw new Error('Invalid billing episode link');
  }
  const total = totalPaise(episode);
  const outstandingPaise = total - episode.paidPaise;
  const finalized = encounter?.status === 'finalized';
  const hasPrescription = finalized && encounter.medications.length > 0;
  const pharmacyDisposition = !finalized ? 'awaiting' : !hasPrescription ? 'not_required' :
    episode.pharmacyClosed ? 'closed' : episode.pharmacyLineCount > 0 ? 'open' : 'awaiting';
  const checkoutStatus = episode.receiptIssued ? 'paid' : episode.consultationTotalPaise === 0 ? 'awaiting_fee' :
    !finalized ? 'awaiting_consultation' :
    hasPrescription && !episode.pharmacyClosed ? 'awaiting_pharmacy' :
      episode.paidPaise > 0 && outstandingPaise > 0 ? 'partly_paid' : 'ready_for_checkout';
  if (episode.receiptIssued && (episode.consultationTotalPaise === 0 || outstandingPaise !== 0 || !finalized ||
      (hasPrescription && !episode.pharmacyClosed))) throw new Error('Invalid issued receipt state');
  return {
    appointmentId: episode.appointmentId, clinicDate: episode.clinicDate,
    patientId: episode.patientId, patientName: episode.patientName,
    currency: episode.currency, revision: episode.revision,
    consultationTotalPaise: episode.consultationTotalPaise,
    pharmacyTotalPaise: episode.pharmacyTotalPaise, totalPaise: total,
    paidPaise: episode.paidPaise, outstandingPaise, pharmacyDisposition,
    checkoutStatus, receiptIssued: episode.receiptIssued,
    createdAt: episode.createdAt, updatedAt: episode.updatedAt,
  };
}

export function receiptSnapshot(id: string, episode: BillEpisode, appointment: Appointment,
  clinic: Clinic, charges: BillCharge[], payments: BillPayment[], at: string, actorSub: string): BillReceipt {
  const total = totalPaise(episode);
  if (total === 0 || episode.consultationTotalPaise === 0 || episode.paidPaise !== total ||
      charges.reduce((sum, charge) => sum + charge.amountPaise, 0) !== total ||
      payments.reduce((sum, payment) => sum + payment.amountPaise, 0) !== total) {
    throw new Error('Receipt balance is not settled');
  }
  return { id, label: 'SYNTHETIC DEMO RECEIPT',
    clinic: { slug: clinic.slug, displayName: clinic.displayName ?? clinic.slug },
    patient: { id: appointment.patientId, fullName: appointment.patientName },
    appointmentId: appointment.id, clinicDate: appointment.clinicDate,
    issuedAt: at, issuedBySub: actorSub, currency: 'INR',
    charges: structuredClone(charges), payments: structuredClone(payments),
    totalPaise: total, paidPaise: episode.paidPaise, outstandingPaise: 0 };
}

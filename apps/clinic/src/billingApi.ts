import { validClinicSlug } from './tenant.ts';

export type PharmacyDisposition = 'not_required' | 'awaiting' | 'open' | 'closed';
export type CheckoutStatus = 'awaiting_fee' | 'awaiting_consultation' | 'awaiting_pharmacy' | 'ready_for_checkout' | 'partly_paid' | 'paid';
export type PaymentMethod = 'cash' | 'upi' | 'card';
export type SupplyStatus = 'not_supplied' | 'partly_supplied' | 'supplied';
export type QuantityUnit = 'tablet' | 'capsule' | 'ml' | 'g' | 'piece' | 'pack';

export interface Episode {
  appointmentId: string; clinicDate: string; patientId: string; patientName: string; currency: 'INR';
  revision: number; consultationTotalPaise: number; pharmacyTotalPaise: number; totalPaise: number;
  paidPaise: number; outstandingPaise: number; pharmacyDisposition: PharmacyDisposition;
  checkoutStatus: CheckoutStatus; receiptIssued: boolean; createdAt: string; updatedAt: string;
}
export interface BillingConfig { currency: 'INR'; consultationFeePaise: number; version: number }
export interface Charge {
  id: string; kind: 'consultation' | 'pharmacy'; description: string; quantity: number; quantityUnit: string;
  unitPricePaise: number; amountPaise: number; source: 'clinic_config' | 'pharmacy_manual';
  prescriptionIndex?: number; prescriptionRevision?: number; createdAt: string; actorSub: string;
}
export interface Payment {
  id: string; amountPaise: number; method: PaymentMethod; reference: string | null; recordedAt: string; actorSub: string;
}
export interface Receipt {
  id: string; label: 'SYNTHETIC DEMO RECEIPT'; clinic: { slug: string; displayName: string };
  patient: { id: string; fullName: string }; appointmentId: string; clinicDate: string;
  issuedAt: string; issuedBySub: string; currency: 'INR'; charges: Charge[]; payments: Payment[];
  totalPaise: number; paidPaise: number; outstandingPaise: 0;
}
export interface EpisodeDetail { episode: Episode; charges: Charge[]; payments: Payment[]; receipt: Receipt | null }
export interface Supply { quantity: number; quantityUnit: string; unitPricePaise: number; amountPaise: number; recordedAt: string }
export interface FulfillmentItem {
  prescriptionIndex: number; name: string; strength: string; suppliedQuantity: number; quantityUnit: QuantityUnit | null;
  status: SupplyStatus; supplies: Supply[]; remainingQuantity: null;
}
export interface FulfillmentDetail {
  appointmentId: string; clinicDate: string; patient: { id: string; fullName: string };
  prescriptionRevision: number; items: FulfillmentItem[]; episode: Episode;
}
export interface EpisodeSelection { appointmentId: string; clinicDate: string }
export interface SupplyInput { prescriptionIndex: number; quantity: number; quantityUnit: QuantityUnit; unitPricePaise: number; status: 'partly_supplied' | 'supplied' }

export class BillingApiError extends Error {
  readonly status: number | null;
  constructor(status: number | null, message: string) { super(message); this.name = 'BillingApiError'; this.status = status; }
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const recordId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_#:-]{1,180}$/.test(value);
const date = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const timestamp = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const money = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const dispositions = new Set<PharmacyDisposition>(['not_required', 'awaiting', 'open', 'closed']);
const statuses = new Set<CheckoutStatus>(['awaiting_fee', 'awaiting_consultation', 'awaiting_pharmacy', 'ready_for_checkout', 'partly_paid', 'paid']);
const methods = new Set<PaymentMethod>(['cash', 'upi', 'card']);
const supplyStatuses = new Set<SupplyStatus>(['not_supplied', 'partly_supplied', 'supplied']);
export const QUANTITY_UNITS: readonly QuantityUnit[] = ['tablet', 'capsule', 'ml', 'g', 'piece', 'pack'];
const quantityUnits = new Set<QuantityUnit>(QUANTITY_UNITS);
function invalid(what: string): never { throw new BillingApiError(null, `Invalid ${what} response`); }

function path(slug: string, suffix: string): string {
  if (!validClinicSlug(slug)) throw new BillingApiError(null, 'Invalid clinic context');
  return `/api/workflow/clinics/${slug}/${suffix}`;
}
function selection(value: EpisodeSelection): void {
  if (!id(value.appointmentId) || !date(value.clinicDate)) throw new BillingApiError(null, 'Invalid appointment selection');
}
function csrf(value: string): HeadersInit {
  if (!text(value)) throw new BillingApiError(null, 'Missing authenticated CSRF token');
  return { 'Content-Type': 'application/json', 'X-CSRF-Token': value };
}
async function request(url: string, init: RequestInit = {}): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init, credentials: 'include', cache: 'no-store', mode: 'same-origin', redirect: 'error',
      headers: { Accept: 'application/json', ...init.headers },
      signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
    });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new BillingApiError(null, 'Billing service unavailable');
  }
  const type = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  const json = type === 'application/json' || type?.endsWith('+json');
  if (!response.ok) throw new BillingApiError(json ? response.status : null, 'Billing request failed');
  if (!json) throw new BillingApiError(null, 'Invalid billing response');
  try { return await response.json(); }
  catch { throw new BillingApiError(null, 'Invalid billing response'); }
}
function post(slug: string, suffix: string, body: object, csrfToken: string, signal?: AbortSignal): Promise<unknown> {
  return request(path(slug, suffix), { method: 'POST', headers: csrf(csrfToken), body: JSON.stringify(body), signal });
}
function parseEpisode(value: unknown): Episode {
  if (!isRecord(value) || !id(value.appointmentId) || !date(value.clinicDate) || !id(value.patientId) || !text(value.patientName) || value.currency !== 'INR' ||
      !count(value.revision) || !money(value.consultationTotalPaise) || !money(value.pharmacyTotalPaise) || !money(value.totalPaise) ||
      !money(value.paidPaise) || !money(value.outstandingPaise) || value.totalPaise !== value.consultationTotalPaise + value.pharmacyTotalPaise ||
      value.outstandingPaise !== value.totalPaise - value.paidPaise || !dispositions.has(value.pharmacyDisposition as PharmacyDisposition) ||
      !statuses.has(value.checkoutStatus as CheckoutStatus) || typeof value.receiptIssued !== 'boolean' ||
      !timestamp(value.createdAt) || !timestamp(value.updatedAt)) invalid('billing episode');
  return value as unknown as Episode;
}
function matchingEpisode(value: unknown, selected: EpisodeSelection): Episode {
  const episode = parseEpisode(value);
  if (episode.appointmentId !== selected.appointmentId || episode.clinicDate !== selected.clinicDate) invalid('billing episode identity');
  return episode;
}
function parseCharge(value: unknown): Charge {
  if (!isRecord(value) || !recordId(value.id) || (value.kind !== 'consultation' && value.kind !== 'pharmacy') || !text(value.description) ||
      !positive(value.quantity) || !text(value.quantityUnit) || !money(value.unitPricePaise) || !money(value.amountPaise) ||
      (value.source !== 'clinic_config' && value.source !== 'pharmacy_manual') || !timestamp(value.createdAt) || !id(value.actorSub) ||
      (value.prescriptionIndex !== undefined && !count(value.prescriptionIndex)) ||
      (value.prescriptionRevision !== undefined && !count(value.prescriptionRevision))) invalid('billing charge');
  return value as unknown as Charge;
}
function parsePayment(value: unknown): Payment {
  if (!isRecord(value) || !recordId(value.id) || !money(value.amountPaise) || value.amountPaise === 0 ||
      !methods.has(value.method as PaymentMethod) || (value.reference !== null && typeof value.reference !== 'string') ||
      !timestamp(value.recordedAt) || !id(value.actorSub)) invalid('billing payment');
  return value as unknown as Payment;
}
function parseReceipt(value: unknown, slug: string, episode: Episode): Receipt {
  if (!isRecord(value) || !recordId(value.id) || value.label !== 'SYNTHETIC DEMO RECEIPT' ||
      !isRecord(value.clinic) || value.clinic.slug !== slug || !text(value.clinic.displayName) ||
      !isRecord(value.patient) || value.patient.id !== episode.patientId || !text(value.patient.fullName) ||
      value.appointmentId !== episode.appointmentId || value.clinicDate !== episode.clinicDate ||
      !timestamp(value.issuedAt) || !id(value.issuedBySub) || value.currency !== 'INR' ||
      !Array.isArray(value.charges) || !Array.isArray(value.payments) || !money(value.totalPaise) ||
      !money(value.paidPaise) || value.outstandingPaise !== 0 || value.totalPaise !== value.paidPaise) invalid('receipt');
  return { ...value, charges: value.charges.map(parseCharge), payments: value.payments.map(parsePayment) } as Receipt;
}

export async function getBillingConfig(slug: string, signal?: AbortSignal): Promise<BillingConfig> {
  const value = await request(path(slug, 'billing/config'), { signal });
  if (!isRecord(value) || value.currency !== 'INR' || !money(value.consultationFeePaise) || !count(value.version)) invalid('billing configuration');
  return value as unknown as BillingConfig;
}
export async function checkInAppointment(slug: string, selected: EpisodeSelection, expectedFeePaise: number, operationId: string, csrfToken: string): Promise<Episode> {
  selection(selected);
  if (!money(expectedFeePaise) || !uuid(operationId)) throw new BillingApiError(null, 'Invalid check-in request');
  const value = await post(slug, 'appointments/check-in', { ...selected, expectedFeePaise, operationId }, csrfToken);
  if (!isRecord(value) || !isRecord(value.appointment) || value.appointment.id !== selected.appointmentId || value.appointment.status !== 'checked_in') invalid('check-in');
  return matchingEpisode(value.episode, selected);
}
export async function addLegacyConsultationCharge(slug: string, selected: EpisodeSelection, expectedFeePaise: number, operationId: string, csrfToken: string): Promise<Episode> {
  selection(selected);
  if (!money(expectedFeePaise) || !uuid(operationId)) throw new BillingApiError(null, 'Invalid consultation charge request');
  const value = await post(slug, 'billing/consultation-charge', { ...selected, expectedFeePaise, operationId, reason: 'legacy_check_in_missing' }, csrfToken);
  if (!isRecord(value)) invalid('consultation charge');
  return matchingEpisode(value.episode, selected);
}
export async function listBillingEpisodes(slug: string, clinicDate: string, signal?: AbortSignal): Promise<Episode[]> {
  if (!date(clinicDate)) throw new BillingApiError(null, 'Invalid billing date');
  const value = await request(path(slug, `billing/episodes?date=${clinicDate}`), { signal });
  if (!isRecord(value) || !Array.isArray(value.items) || value.items.length > 200) invalid('billing queue');
  const episodes = value.items.map(parseEpisode);
  if (episodes.some((item) => item.clinicDate !== clinicDate) || new Set(episodes.map((item) => item.appointmentId)).size !== episodes.length) invalid('billing queue');
  return episodes;
}
export async function readBillingEpisode(slug: string, selected: EpisodeSelection, csrfToken: string, signal?: AbortSignal): Promise<EpisodeDetail> {
  selection(selected);
  const value = await post(slug, 'billing/read', selected, csrfToken, signal);
  if (!isRecord(value) || !Array.isArray(value.charges) || !Array.isArray(value.payments)) invalid('billing detail');
  const episode = matchingEpisode(value.episode, selected);
  const receipt = value.receipt === null ? null : parseReceipt(value.receipt, slug, episode);
  if (episode.receiptIssued !== !!receipt) invalid('receipt status');
  return { episode, charges: value.charges.map(parseCharge), payments: value.payments.map(parsePayment), receipt };
}
export async function recordPayment(slug: string, selected: EpisodeSelection, expectedRevision: number, amountPaise: number, method: PaymentMethod, reference: string, operationId: string, csrfToken: string): Promise<{ episode: Episode; payment: Payment }> {
  selection(selected);
  if (!count(expectedRevision) || !money(amountPaise) || amountPaise === 0 || !methods.has(method) || !uuid(operationId)) throw new BillingApiError(null, 'Invalid payment request');
  const value = await post(slug, 'billing/payments', { ...selected, operationId, expectedRevision, amountPaise, method, ...(reference.trim() ? { reference: reference.trim() } : {}) }, csrfToken);
  if (!isRecord(value)) invalid('payment');
  return { episode: matchingEpisode(value.episode, selected), payment: parsePayment(value.payment) };
}
export async function issueReceipt(slug: string, selected: EpisodeSelection, expectedRevision: number, operationId: string, csrfToken: string): Promise<{ episode: Episode; receipt: Receipt }> {
  selection(selected);
  if (!count(expectedRevision) || !uuid(operationId)) throw new BillingApiError(null, 'Invalid receipt request');
  const value = await post(slug, 'billing/receipt', { ...selected, operationId, expectedRevision }, csrfToken);
  if (!isRecord(value)) invalid('receipt');
  const episode = matchingEpisode(value.episode, selected);
  return { episode, receipt: parseReceipt(value.receipt, slug, episode) };
}
export async function readFulfillment(slug: string, selected: EpisodeSelection, csrfToken: string, signal?: AbortSignal): Promise<FulfillmentDetail> {
  selection(selected);
  const value = await post(slug, 'billing/fulfillment/read', selected, csrfToken, signal);
  if (!isRecord(value) || value.appointmentId !== selected.appointmentId || value.clinicDate !== selected.clinicDate ||
      !isRecord(value.patient) || !id(value.patient.id) || !text(value.patient.fullName) ||
      !count(value.prescriptionRevision) || !Array.isArray(value.items) || value.items.length > 20) invalid('pharmacy fulfillment');
  const items = value.items.map((raw): FulfillmentItem => {
    if (!isRecord(raw) || !count(raw.prescriptionIndex) || !text(raw.name) || typeof raw.strength !== 'string' ||
        !count(raw.suppliedQuantity) ||
        (raw.quantityUnit !== null && !quantityUnits.has(raw.quantityUnit as QuantityUnit)) || !supplyStatuses.has(raw.status as SupplyStatus) ||
        !Array.isArray(raw.supplies) || raw.remainingQuantity !== null) invalid('pharmacy fulfillment item');
    const supplies = raw.supplies.map((supply): Supply => {
      if (!isRecord(supply) || !count(supply.quantity) || supply.quantity < 1 || !quantityUnits.has(supply.quantityUnit as QuantityUnit) || !money(supply.unitPricePaise) ||
          !money(supply.amountPaise) || !timestamp(supply.recordedAt)) invalid('pharmacy supply');
      return supply as unknown as Supply;
    });
    return { ...raw, supplies } as FulfillmentItem;
  });
  if (new Set(items.map((item) => item.prescriptionIndex)).size !== items.length) invalid('pharmacy item identity');
  const episode = matchingEpisode(value.episode, selected);
  if (episode.patientId !== value.patient.id) invalid('pharmacy patient identity');
  return { appointmentId: selected.appointmentId, clinicDate: selected.clinicDate, patient: value.patient as FulfillmentDetail['patient'], prescriptionRevision: value.prescriptionRevision, items, episode };
}
export async function recordFulfillment(slug: string, selected: EpisodeSelection, expectedRevision: number, prescriptionRevision: number, items: SupplyInput[], closeForCheckout: boolean, operationId: string, csrfToken: string): Promise<Episode> {
  selection(selected);
  if (!count(expectedRevision) || !count(prescriptionRevision) || !uuid(operationId) || typeof closeForCheckout !== 'boolean' ||
      !Array.isArray(items) || items.length > 10 || new Set(items.map((item) => item.prescriptionIndex)).size !== items.length ||
      items.some((item) => !count(item.prescriptionIndex) || !count(item.quantity) || item.quantity < 1 || item.quantity > 10_000 ||
        !quantityUnits.has(item.quantityUnit) || !money(item.unitPricePaise) || item.unitPricePaise > 10_000_000 ||
        item.quantity * item.unitPricePaise > 100_000_000 ||
        (item.status !== 'partly_supplied' && item.status !== 'supplied'))) throw new BillingApiError(null, 'Invalid fulfillment request');
  const value = await post(slug, 'billing/fulfillment', { ...selected, operationId, expectedRevision, prescriptionRevision, items, closeForCheckout }, csrfToken);
  if (!isRecord(value)) invalid('fulfillment');
  return matchingEpisode(value.episode, selected);
}

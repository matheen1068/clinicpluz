import { createHash, randomUUID } from 'node:crypto';
import type { Appointment, Clinic, HttpInput, HttpResult, Membership, WorkflowStore } from './core.ts';
import type { Encounter } from './consultation.ts';
import { QUANTITY_UNITS, chargeAmount, episodeView, receiptSnapshot, totalPaise,
  validOperationId, validPaise, type BillCharge, type BillEpisode, type BillOperation,
  type BillPayment, type BillingStore, type BillingWrite, type EpisodeRecords,
  type FulfillmentEvent, type PaymentMethod, type QuantityUnit, type SupplyStatus } from './billing.ts';

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const UNITS = new Set<string>(QUANTITY_UNITS);
const METHODS = new Set<PaymentMethod>(['cash', 'upi', 'card']);
const STATUSES = new Set<SupplyStatus>(['partly_supplied', 'supplied']);

function reply(statusCode: number, payload: unknown): HttpResult {
  return { statusCode, headers: { 'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' },
  body: JSON.stringify(payload) };
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  return required.every((name) => name in value) && Object.keys(value).every((name) => [...required, ...optional].includes(name));
}
function readBody(input: HttpInput): Record<string, unknown> | null {
  if (input.isBase64Encoded || !input.headers['content-type']?.toLowerCase().startsWith('application/json') ||
      !input.body || input.body.length > 8192) return null;
  try { const parsed: unknown = JSON.parse(input.body); return object(parsed) ? parsed : null; }
  catch { return null; }
}
function date(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
function identity(value: Record<string, unknown>): value is Record<string, unknown> &
  { appointmentId: string; clinicDate: string } {
  return typeof value.appointmentId === 'string' && ID.test(value.appointmentId) && date(value.clinicDate);
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function fingerprint(kind: string, request: Record<string, unknown>): string {
  return createHash('sha256').update(`${kind}:${canonical(request)}`).digest('hex');
}
function firstEpisode(appointment: Appointment, at: string): BillEpisode {
  return { appointmentId: appointment.id, clinicDate: appointment.clinicDate,
    patientId: appointment.patientId, patientName: appointment.patientName,
    currency: 'INR', revision: 0, consultationTotalPaise: 0, pharmacyTotalPaise: 0,
    paidPaise: 0, pharmacyClosed: false, pharmacyLineCount: 0, paymentCount: 0,
    receiptIssued: false, createdAt: at, updatedAt: at };
}
function checked(records: EpisodeRecords, appointment: Appointment): BillEpisode | null {
  const episode = records.episode;
  if (!episode) {
    if (records.charges.length || records.payments.length || records.fulfillment.length || records.receipt) {
      throw new Error('Orphaned billing records');
    }
    return null;
  }
  const consultation = records.charges.filter((charge) => charge.kind === 'consultation');
  const pharmacy = records.charges.filter((charge) => charge.kind === 'pharmacy');
  const fulfillmentLines = records.fulfillment.flatMap((event) => event.items.map((item) => ({ event, item })));
  const receipt = records.receipt;
  if (episode.appointmentId !== appointment.id || episode.clinicDate !== appointment.clinicDate ||
      episode.patientId !== appointment.patientId || episode.patientName !== appointment.patientName ||
      episode.currency !== 'INR' || !Number.isSafeInteger(episode.revision) || episode.revision < 1 ||
      !validPaise(episode.consultationTotalPaise) || !validPaise(episode.pharmacyTotalPaise) ||
      !validPaise(episode.paidPaise) || !Number.isSafeInteger(episode.pharmacyLineCount) ||
      !Number.isSafeInteger(episode.paymentCount) ||
      consultation.length !== (episode.consultationTotalPaise > 0 ? 1 : 0) ||
      consultation.reduce((sum, charge) => sum + charge.amountPaise, 0) !== episode.consultationTotalPaise ||
      pharmacy.reduce((sum, charge) => sum + charge.amountPaise, 0) !== episode.pharmacyTotalPaise ||
      pharmacy.length !== fulfillmentLines.length ||
      fulfillmentLines.some(({ event, item }) => !pharmacy.some((charge) =>
        charge.id === `PHARMACY#${event.id}#${item.prescriptionIndex}` &&
        charge.prescriptionIndex === item.prescriptionIndex &&
        charge.prescriptionRevision === event.prescriptionRevision &&
        charge.quantity === item.quantity && charge.quantityUnit === item.quantityUnit &&
        charge.unitPricePaise === item.unitPricePaise && charge.amountPaise === item.amountPaise)) ||
      records.payments.reduce((sum, payment) => sum + payment.amountPaise, 0) !== episode.paidPaise ||
      records.payments.length !== episode.paymentCount ||
      pharmacy.length !== episode.pharmacyLineCount ||
      Boolean(receipt) !== episode.receiptIssued ||
      (receipt && (receipt.appointmentId !== appointment.id || receipt.clinicDate !== appointment.clinicDate ||
        receipt.patient.id !== appointment.patientId || receipt.patient.fullName !== appointment.patientName ||
        receipt.totalPaise !== totalPaise(episode) || receipt.paidPaise !== episode.paidPaise ||
        receipt.outstandingPaise !== 0 ||
        JSON.stringify(receipt.charges) !== JSON.stringify(records.charges) ||
        JSON.stringify(receipt.payments) !== JSON.stringify(records.payments)))) {
    throw new Error('Invalid billing records');
  }
  return episode;
}
function view(episode: BillEpisode, appointment: Appointment, encounter: Encounter | null) {
  // Revision 0 is a read-only preview; the first pharmacy write uses expectedRevision: 0.
  return episodeView(episode, appointment, encounter);
}
function operation(request: Record<string, unknown>, kind: string, at: string): BillOperation | null {
  if (!validOperationId(request.operationId)) return null;
  return { id: request.operationId, kind, fingerprint: fingerprint(kind, request), at };
}
function sameOperation(existing: BillOperation | null, op: BillOperation): boolean {
  return Boolean(existing && existing.kind === op.kind && existing.fingerprint === op.fingerprint);
}
async function findAppointment(store: WorkflowStore, slug: string, clinicDate: string, id: string): Promise<Appointment | null> {
  return (await store.listAppointments(slug, clinicDate)).find((appointment) => appointment.id === id) ?? null;
}
function receiptReady(episode: BillEpisode, encounter: Encounter | null): boolean {
  return episode.consultationTotalPaise > 0 && encounter?.status === 'finalized' &&
    (encounter.medications.length === 0 || episode.pharmacyClosed) &&
    episode.paidPaise === totalPaise(episode);
}
function fulfillmentView(encounter: Encounter, records: EpisodeRecords) {
  return encounter.medications.map((medication, prescriptionIndex) => {
    const supply = records.fulfillment.flatMap((event) => event.items
      .filter((item) => item.prescriptionIndex === prescriptionIndex)
      .map((item) => ({ ...item, recordedAt: event.recordedAt })));
    const last = supply.at(-1);
    return { prescriptionIndex, name: medication.name, strength: medication.strength,
      suppliedQuantity: supply.reduce((sum, item) => sum + item.quantity, 0),
      quantityUnit: last?.quantityUnit ?? null,
      status: last?.status ?? 'not_supplied',
      supplies: supply.map(({ quantity, quantityUnit, unitPricePaise, amountPaise, recordedAt }) =>
        ({ quantity, quantityUnit, unitPricePaise, amountPaise, recordedAt })),
      remainingQuantity: null };
  });
}

export async function handleBilling(input: HttpInput, endpoint: string, slug: string, clinic: Clinic,
  member: Membership, workflow: WorkflowStore, billing: BillingStore | undefined, now: Date): Promise<HttpResult> {
  if (!billing) return reply(503, { error: 'Billing unavailable' });
  const reception = member.role === 'clinic_admin' || member.role === 'receptionist';
  const pharmacy = member.role === 'pharmacist';
  const doctor = member.role === 'doctor';
  const pharmacyRoute = endpoint.startsWith('billing/fulfillment');
  const doctorFeeRoute = endpoint === 'billing/consultation-fee/read' || endpoint === 'billing/consultation-charge';
  if (pharmacyRoute ? !pharmacy : !(reception || (doctorFeeRoute && doctor))) {
    return reply(403, { error: 'Role not allowed' });
  }
  const readGet = endpoint === 'billing/config' || endpoint === 'billing/episodes';
  if ((readGet && input.method !== 'GET') || (!readGet && input.method !== 'POST')) {
    return reply(404, { error: 'Not found' });
  }
  if (endpoint === 'billing/config' && input.method === 'GET' && !(input.queryString ?? '')) {
    const config = await billing.getConfig(slug);
    return config ? reply(200, config) : reply(503, { error: 'Clinic billing configuration unavailable' });
  }
  if (endpoint === 'billing/episodes' && input.method === 'GET') {
    const query = new URLSearchParams(input.queryString ?? '');
    if ([...query.keys()].length !== 1 || !date(query.get('date'))) return reply(400, { error: 'Invalid date' });
    const clinicDate = query.get('date')!;
    const [appointments, indexed] = await Promise.all([
      workflow.listAppointments(slug, clinicDate), billing.listEpisodes(slug, clinicDate),
    ]);
    const byId = new Map(appointments.map((item) => [item.id, item]));
    const items = [];
    for (const row of indexed) {
      const appointment = byId.get(row.appointmentId);
      if (!appointment) throw new Error('Orphaned billing index');
      const [records, encounter] = await Promise.all([
        billing.load(slug, appointment.id), workflow.getEncounter(slug, clinicDate, appointment.id),
      ]);
      const canonical = checked(records, appointment);
      if (!canonical || canonical.revision !== row.revision) throw new Error('Stale billing index');
      items.push(view(canonical, appointment, encounter));
    }
    return reply(200, { items });
  }
  const request = readBody(input);
  if (!request || !identity(request) || (input.queryString ?? '')) return reply(400, { error: 'Invalid billing request' });
  const appointment = await findAppointment(workflow, slug, request.clinicDate, request.appointmentId);
  if (!appointment) return reply(404, { error: 'Appointment not found' });
  if (doctor) {
    const assigned = await workflow.getDoctor(slug, appointment.doctorId);
    if (!assigned?.active || assigned.staffSub !== member.sub) {
      return reply(403, { error: 'Doctor assignment denied' });
    }
  }
  const [records, encounter] = await Promise.all([
    billing.load(slug, appointment.id), workflow.getEncounter(slug, appointment.clinicDate, appointment.id),
  ]);
  if (doctor && encounter?.status === 'finalized' && encounter.finalizedBySub !== member.sub) {
    return reply(403, { error: 'Doctor assignment denied' });
  }
  const existing = checked(records, appointment);
  if (endpoint === 'billing/consultation-fee/read' && input.method === 'POST') {
    if (!keys(request, ['appointmentId', 'clinicDate'])) return reply(400, { error: 'Invalid fee read' });
    return reply(200, { amountPaise: existing?.consultationTotalPaise || null,
      revision: existing?.revision ?? 0 });
  }
  if (endpoint === 'billing/read' && input.method === 'POST') {
    if (!keys(request, ['appointmentId', 'clinicDate'])) return reply(400, { error: 'Invalid billing read' });
    return existing ? reply(200, { episode: view(existing, appointment, encounter),
      charges: records.charges, payments: records.payments, receipt: records.receipt }) :
      reply(404, { error: 'Billing episode not found' });
  }
  if (endpoint === 'billing/fulfillment/read' && input.method === 'POST') {
    if (!keys(request, ['appointmentId', 'clinicDate'])) return reply(400, { error: 'Invalid fulfillment read' });
    if (encounter?.status !== 'finalized' || encounter.medications.length === 0 ||
        encounter.patientId !== appointment.patientId || encounter.doctorId !== appointment.doctorId) {
      return reply(404, { error: 'Finalized prescription unavailable' });
    }
    return reply(200, { appointmentId: appointment.id, clinicDate: appointment.clinicDate,
      patient: { id: appointment.patientId, fullName: appointment.patientName },
      prescriptionRevision: encounter.revision, items: fulfillmentView(encounter, records),
      episode: view(existing ?? firstEpisode(appointment, now.toISOString()), appointment, encounter) });
  }
  const kind = endpoint === 'appointments/check-in' ? 'check_in' :
    endpoint === 'billing/consultation-charge' ? 'consultation_charge' :
      endpoint === 'billing/fulfillment' ? 'fulfillment' :
        endpoint === 'billing/payments' ? 'payment' : endpoint === 'billing/receipt' ? 'receipt' : null;
  if (!kind || input.method !== 'POST') return reply(404, { error: 'Not found' });
  const op = operation(request, kind, now.toISOString());
  if (!op) return reply(400, { error: 'Invalid operation ID' });
  const priorOp = await billing.getOperation(slug, appointment.id, op.id);
  if (priorOp) {
    if (!sameOperation(priorOp, op) || !existing) return reply(409, { error: 'Operation ID conflict' });
    if (kind === 'payment') {
      const payment = records.payments.find((row) => row.id === op.id);
      if (!payment) throw new Error('Missing idempotent payment');
      return reply(200, { episode: view(existing, appointment, encounter), payment });
    }
    if (kind === 'receipt') {
      if (!records.receipt) throw new Error('Missing idempotent receipt');
      return reply(200, { episode: view(existing, appointment, encounter), receipt: records.receipt });
    }
    if (kind === 'check_in') return reply(200, { appointment: { ...appointment, status: 'checked_in' },
      episode: view(existing, { ...appointment, status: 'checked_in' }, encounter) });
    return reply(200, { episode: view(existing, appointment, encounter) });
  }
  if (existing?.receiptIssued) return reply(409, { error: 'Paid receipt already issued' });
  const base = existing ?? firstEpisode(appointment, now.toISOString());
  const next: BillEpisode = { ...base, revision: base.revision + 1, updatedAt: now.toISOString() };
  const write: BillingWrite = { appointment, actorSub: member.sub,
    previousRevision: base.revision, nextEpisode: next, operation: op };
  let successBody: Record<string, unknown>;

  if (kind === 'check_in' || kind === 'consultation_charge') {
    const manual = kind === 'consultation_charge';
    if (!keys(request, manual ? ['appointmentId', 'clinicDate', 'operationId', 'expectedRevision', 'amountPaise'] :
      ['appointmentId', 'clinicDate', 'operationId']) ||
        (manual && (!Number.isSafeInteger(request.expectedRevision) ||
          !validPaise(request.amountPaise) || request.amountPaise === 0))) {
      return reply(400, { error: 'Invalid consultation fee request' });
    }
    if (manual && request.expectedRevision !== base.revision) {
      return reply(409, { error: 'Billing revision changed' });
    }
    if (manual && (base.consultationTotalPaise > 0 ||
        records.charges.some((charge) => charge.kind === 'consultation'))) {
      return reply(409, { error: 'Consultation fee already recorded' });
    }
    if (manual && records.charges.length >= 50) return reply(409, { error: 'Billing record limit reached' });
    if (manual && appointment.status !== 'checked_in' &&
        !(appointment.status === 'booked' && encounter?.status === 'finalized')) {
      return reply(409, { error: 'Visit has not arrived or concluded' });
    }
    if (manual) {
      if (!validPaise(totalPaise(base) + (request.amountPaise as number))) {
        return reply(400, { error: 'Billing amount limit exceeded' });
      }
      next.consultationTotalPaise = request.amountPaise as number;
      const charge: BillCharge = { id: 'CONSULTATION', kind: 'consultation',
        description: 'Clinic consultation', quantity: 1, quantityUnit: 'visit',
        unitPricePaise: request.amountPaise as number, amountPaise: request.amountPaise as number,
        source: 'staff_manual', createdAt: now.toISOString(), actorSub: member.sub };
      write.charges = [charge];
      if (appointment.status === 'booked') write.encounterRevision = encounter!.revision;
      if (appointment.status === 'checked_in') write.requireCheckedIn = true;
      if (doctor) write.doctorStaffSub = member.sub;
    } else if (appointment.status === 'booked') {
      write.checkInBooked = true;
    } else {
      return reply(409, { error: 'Appointment cannot be checked in' });
    }
    successBody = manual ? { episode: view(next, appointment, encounter) } :
      { appointment: { ...appointment, status: 'checked_in' },
        episode: view(next, { ...appointment, status: 'checked_in' }, encounter) };
  } else if (kind === 'fulfillment') {
    if (!keys(request, ['appointmentId', 'clinicDate', 'operationId', 'expectedRevision',
      'prescriptionRevision', 'items', 'closeForCheckout']) ||
      !Number.isSafeInteger(request.expectedRevision) ||
      !Number.isSafeInteger(request.prescriptionRevision) ||
      !Array.isArray(request.items) || request.items.length > 10 ||
      typeof request.closeForCheckout !== 'boolean' ||
      (request.items.length === 0 && !request.closeForCheckout)) {
      return reply(400, { error: 'Invalid fulfillment request' });
    }
    if (request.expectedRevision !== base.revision) return reply(409, { error: 'Billing revision changed' });
    if (encounter?.status !== 'finalized' || encounter.revision !== request.prescriptionRevision ||
        encounter.patientId !== appointment.patientId || encounter.doctorId !== appointment.doctorId ||
        encounter.medications.length === 0) return reply(404, { error: 'Finalized prescription unavailable' });
    if (base.pharmacyClosed) return reply(409, { error: 'Pharmacy disposition is closed' });
    if (records.fulfillment.length >= 30 && request.items.length > 0) {
      return reply(409, { error: 'Pharmacy event limit reached; close or review the visit' });
    }
    const seen = new Set<number>();
    const items: FulfillmentEvent['items'] = [];
    const charges: BillCharge[] = [];
    for (const value of request.items) {
      if (!object(value) || !keys(value, ['prescriptionIndex', 'quantity', 'quantityUnit', 'unitPricePaise', 'status']) ||
          !Number.isSafeInteger(value.prescriptionIndex) || typeof value.prescriptionIndex !== 'number' ||
          value.prescriptionIndex < 0 || value.prescriptionIndex >= encounter.medications.length ||
          seen.has(value.prescriptionIndex) || !UNITS.has(value.quantityUnit as string) ||
          !STATUSES.has(value.status as SupplyStatus)) return reply(400, { error: 'Invalid supplied item' });
      const amount = chargeAmount(value.quantity, value.unitPricePaise);
      if (amount === null) return reply(400, { error: 'Invalid supplied quantity or price' });
      const prior = records.fulfillment.flatMap((event) => event.items)
        .filter((item) => item.prescriptionIndex === value.prescriptionIndex);
      if (prior.some((item) => item.status === 'supplied') ||
          prior.some((item) => item.quantityUnit !== value.quantityUnit) ||
          prior.reduce((sum, item) => sum + item.quantity, 0) + (value.quantity as number) > 10_000) {
        return reply(409, { error: 'Prescription item already supplied or unit changed' });
      }
      const med = encounter.medications[value.prescriptionIndex];
      if (prior.some((item) => item.name !== med.name || item.strength !== med.strength)) {
        throw new Error('Prescription item changed');
      }
      seen.add(value.prescriptionIndex);
      const index = value.prescriptionIndex;
      items.push({ prescriptionIndex: index, quantity: value.quantity as number,
        quantityUnit: value.quantityUnit as QuantityUnit, unitPricePaise: value.unitPricePaise as number,
        amountPaise: amount, status: value.status as SupplyStatus, name: med.name, strength: med.strength });
      charges.push({ id: `PHARMACY#${op.id}#${index}`, kind: 'pharmacy',
        description: `${med.name}${med.strength ? ` ${med.strength}` : ''}`,
        quantity: value.quantity as number, quantityUnit: value.quantityUnit as QuantityUnit,
        unitPricePaise: value.unitPricePaise as number, amountPaise: amount,
        source: 'pharmacy_manual', prescriptionIndex: index, prescriptionRevision: encounter.revision,
        createdAt: now.toISOString(), actorSub: member.sub });
    }
    const added = charges.reduce((sum, charge) => sum + charge.amountPaise, 0);
    if (records.charges.length + charges.length > (base.consultationTotalPaise > 0 ? 50 : 49)) {
      return reply(409, { error: 'Billing line limit reached; close or review the visit' });
    }
    if (!validPaise(base.pharmacyTotalPaise + added) || !validPaise(totalPaise(base) + added)) {
      return reply(400, { error: 'Billing amount limit exceeded' });
    }
    next.pharmacyTotalPaise += added;
    next.pharmacyLineCount += charges.length;
    next.pharmacyClosed = request.closeForCheckout;
    write.encounterRevision = encounter.revision;
    write.charges = charges;
    write.fulfillment = { id: op.id, prescriptionRevision: encounter.revision, items,
      closeForCheckout: request.closeForCheckout, recordedAt: now.toISOString(), actorSub: member.sub };
    successBody = { episode: view(next, appointment, encounter) };
  } else if (kind === 'payment') {
    if (!keys(request, ['appointmentId', 'clinicDate', 'operationId', 'expectedRevision', 'amountPaise', 'method'], ['reference']) ||
        !Number.isSafeInteger(request.expectedRevision) ||
        !validPaise(request.amountPaise) || request.amountPaise <= 0 ||
        !METHODS.has(request.method as PaymentMethod) ||
        (request.reference !== undefined && (typeof request.reference !== 'string' ||
          request.reference.length > 80 || !/^[A-Za-z0-9 ._:/-]*$/.test(request.reference)))) {
      return reply(400, { error: 'Invalid payment' });
    }
    if (request.expectedRevision !== base.revision) return reply(409, { error: 'Billing revision changed' });
    if (!existing) return reply(404, { error: 'Billing episode not found' });
    if (records.payments.length >= 30) return reply(409, { error: 'Payment entry limit reached' });
    if (request.amountPaise > totalPaise(base) - base.paidPaise) return reply(409, { error: 'Payment exceeds outstanding balance' });
    const payment: BillPayment = { id: op.id, amountPaise: request.amountPaise,
      method: request.method as PaymentMethod, reference: (request.reference as string | undefined) ?? null,
      recordedAt: now.toISOString(), actorSub: member.sub };
    next.paidPaise += payment.amountPaise;
    next.paymentCount += 1;
    write.payment = payment;
    successBody = { episode: view(next, appointment, encounter), payment };
  } else {
    if (!keys(request, ['appointmentId', 'clinicDate', 'operationId', 'expectedRevision']) ||
        !Number.isSafeInteger(request.expectedRevision)) {
      return reply(400, { error: 'Invalid receipt request' });
    }
    if (request.expectedRevision !== base.revision) return reply(409, { error: 'Billing revision changed' });
    if (!existing) return reply(404, { error: 'Billing episode not found' });
    if (!receiptReady(base, encounter)) return reply(409, { error: 'Checkout is not ready for a paid receipt' });
    next.receiptIssued = true;
    write.encounterRevision = encounter!.revision;
    const receipt = receiptSnapshot(randomUUID(), next, appointment, clinic,
      records.charges, records.payments, now.toISOString(), member.sub);
    write.receipt = receipt;
    successBody = { episode: view(next, appointment, encounter), receipt };
  }
  const committed = await billing.commit(slug, write);
  if (!committed) {
    const raced = await billing.getOperation(slug, appointment.id, op.id);
    if (sameOperation(raced, op)) {
      const latest = await billing.load(slug, appointment.id);
      const episode = checked(latest, appointment);
      if (!episode) throw new Error('Missing idempotent billing episode');
      if (kind === 'payment') return reply(200, { episode: view(episode, appointment, encounter),
        payment: latest.payments.find((row) => row.id === op.id) });
      if (kind === 'receipt') return reply(200, { episode: view(episode, appointment, encounter), receipt: latest.receipt });
      if (kind === 'check_in') return reply(200, { appointment: { ...appointment, status: 'checked_in' },
        episode: view(episode, { ...appointment, status: 'checked_in' }, encounter) });
      return reply(200, { episode: view(episode, appointment, encounter) });
    }
    return reply(409, { error: 'Billing state changed; refresh and retry' });
  }
  return reply(200, successBody);
}

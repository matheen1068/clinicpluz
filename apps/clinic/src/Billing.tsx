import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { getAppointments, pilotDateToday, type Appointment, WorkflowApiError } from './workflowApi';
import {
  addConsultationCharge, BillingApiError, issueReceipt, listBillingEpisodes,
  readBillingEpisode, recordPayment, type Episode, type EpisodeDetail,
  type EpisodeSelection, type PaymentMethod,
} from './billingApi';
import { formatPaise, rupeesToPaise } from './billingMoney';
import { BILLING_STAGE_LABELS, billingStage, mayRequestReceipt, type BillingStage } from './billingStatus';
import BillingReceiptPrint from './BillingReceiptPrint';

interface Props {
  clinicSlug: string;
  csrfToken: string;
  role: 'clinic_admin' | 'receptionist';
  onSessionLost: () => void;
  onPendingChange: (pending: boolean) => void;
}
const STAGES: BillingStage[] = ['awaiting_fee', 'awaiting_consultation', 'awaiting_pharmacy', 'ready_for_checkout', 'partly_paid', 'paid'];
function timeLabel(value: string): string { return new Date(value).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' }); }
function safeOperationId(): string | null { return typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID() : null; }
function actionMessage(error: unknown): string {
  if (error instanceof BillingApiError) {
    if (error.status === 409) return 'This bill changed, the fee was already posted, or this action conflicts with the clinic record. Refresh the queue and bill before deciding what to do next.';
    if (error.status === 400) return 'The clinic rejected these details. Check the amount or selection and reload the bill before retrying.';
    if (error.status === 404) return 'The selected visit or bill is no longer available. Refresh the queue.';
    if (error.status === 503) return 'The billing service is unavailable. The outcome is not confirmed; refresh the bill before another action.';
  }
  return 'The outcome could not be confirmed. Do not repeat the action until you refresh the clinic bill and check its recorded entries.';
}

export default function Billing({ clinicSlug, csrfToken, onSessionLost, onPendingChange }: Props) {
  const [date, setDate] = useState(pilotDateToday);
  const [items, setItems] = useState<Episode[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [visits, setVisits] = useState<Appointment[]>([]);
  const [visitsLoading, setVisitsLoading] = useState(true);
  const [visitsError, setVisitsError] = useState('');
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<EpisodeSelection | null>(null);
  const [detail, setDetail] = useState<EpisodeDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [accessDenied, setAccessDenied] = useState(false);
  const [pending, setPending] = useState(false);
  const [writeBlocked, setWriteBlocked] = useState(false);
  const [actionError, setActionError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');
  const [paymentRupees, setPaymentRupees] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [paymentReference, setPaymentReference] = useState('');
  const [legacyVisit, setLegacyVisit] = useState<Appointment | null>(null);
  const [feeConfirmed, setFeeConfirmed] = useState(false);
  const [feeRupees, setFeeRupees] = useState('');
  const detailController = useRef<AbortController | null>(null);
  useEffect(() => { onPendingChange(pending); }, [pending, onPendingChange]);
  useEffect(() => () => { detailController.current?.abort(); onPendingChange(false); }, [onPendingChange]);

  function accessError(error: unknown): boolean {
    if (error instanceof BillingApiError || error instanceof WorkflowApiError) {
      if (error.status === 401) { detailController.current?.abort(); onSessionLost(); return true; }
      if (error.status === 403) {
        detailController.current?.abort(); setItems([]); setVisits([]); setSelected(null); setDetail(null); setAccessDenied(true);
        return true;
      }
    }
    return false;
  }

  useEffect(() => {
    const controller = new AbortController();
    setListLoading(true); setVisitsLoading(true); setListError(''); setVisitsError(''); setItems([]); setVisits([]);
    void listBillingEpisodes(clinicSlug, date, controller.signal).then((value) => { if (!controller.signal.aborted) { setItems(value); if (!selected) setWriteBlocked(false); } })
      .catch((error: unknown) => { if (!controller.signal.aborted && !accessError(error)) setListError('Billing episodes could not be loaded. Refresh when the clinic service is available.'); })
      .finally(() => { if (!controller.signal.aborted) setListLoading(false); });
    void getAppointments(clinicSlug, date, controller.signal).then((value) => { if (!controller.signal.aborted) setVisits(value); })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof WorkflowApiError && error.status === 401) onSessionLost();
        else setVisitsError('Older visits could not be checked for a missing consultation fee.');
      }).finally(() => { if (!controller.signal.aborted) setVisitsLoading(false); });
    return () => controller.abort();
  }, [clinicSlug, date, reload]);

  async function loadDetail(next: EpisodeSelection) {
    detailController.current?.abort();
    const controller = new AbortController();
    detailController.current = controller;
    setSelected(next); setDetail(null); setDetailError(''); setDetailLoading(true); setActionError(''); setFeeRupees(''); setFeeConfirmed(false);
    try {
      const value = await readBillingEpisode(clinicSlug, next, csrfToken, controller.signal);
      if (!controller.signal.aborted) { setDetail(value); setWriteBlocked(false); }
    } catch (error) {
      if (!controller.signal.aborted && !accessError(error)) {
        setWriteBlocked(true);
        setDetailError(error instanceof BillingApiError && error.status === 404
          ? 'This bill is no longer available. Refresh the billing queue.'
          : 'The current bill could not be verified. No payment or receipt action is available.');
      }
    } finally { if (!controller.signal.aborted) setDetailLoading(false); }
  }

  async function runWrite(work: () => Promise<Episode>, success: string) {
    if (pending || writeBlocked) return;
    setPending(true); setActionError(''); setActionSuccess('');
    let episode: Episode | null = null;
    try { episode = await work(); }
    catch (error) {
      if (!accessError(error)) { setWriteBlocked(true); setActionError(actionMessage(error)); }
    } finally { setPending(false); }
    if (episode) {
      setActionSuccess(success);
      setLegacyVisit(null); setFeeConfirmed(false); setPaymentRupees(''); setPaymentReference('');
      setReload((value) => value + 1);
      await loadDetail(episode);
    }
  }

  const groups = useMemo(() => Object.fromEntries(STAGES.map((stage) => [stage, items.filter((item) => billingStage(item) === stage)])) as Record<BillingStage, Episode[]>, [items]);
  const missingFeeVisits = useMemo(() => visits.filter((visit) => !items.some((item) => item.appointmentId === visit.id) &&
    (visit.status === 'checked_in' || (visit.status === 'booked' && date < pilotDateToday()))), [visits, items, date]);
  const current = detail?.episode;
  const selectedFeeMissing = current?.consultationTotalPaise === 0;
  const canWrite = !pending && !writeBlocked && !detailLoading && !!current && !current.receiptIssued;
  const receiptReady = current && mayRequestReceipt(current);

  async function addMissingFee(visit: EpisodeSelection) {
    if (!feeConfirmed || listLoading) return;
    const amountPaise = rupeesToPaise(feeRupees);
    if (!amountPaise || amountPaise > 100_000_000) { setActionError('Enter a consultation fee from ₹0.01 to ₹10,00,000.00.'); return; }
    const operationId = safeOperationId();
    if (!operationId) { setActionError('This browser cannot create a safe operation ID. No fee was posted.'); return; }
    await runWrite(() => addConsultationCharge(clinicSlug, visit, current?.appointmentId === visit.appointmentId ? current.revision : 0, amountPaise, operationId, csrfToken), 'Consultation fee saved for this visit.');
  }

  async function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current || !canWrite) return;
    const amountPaise = rupeesToPaise(paymentRupees);
    if (!amountPaise || amountPaise > current.outstandingPaise) { setActionError('Enter an amount greater than zero and no more than the displayed outstanding balance.'); return; }
    const operationId = safeOperationId();
    if (!operationId) { setActionError('This browser cannot create a safe operation ID. No payment was recorded.'); return; }
    await runWrite(async () => (await recordPayment(clinicSlug, current, current.revision, amountPaise, paymentMethod, paymentReference, operationId, csrfToken)).episode,
      'Payment entry was accepted by the clinic. It is a manual record, not bank verification.');
  }

  async function createReceipt() {
    if (!current || !canWrite || !receiptReady) return;
    const operationId = safeOperationId();
    if (!operationId) { setActionError('This browser cannot create a safe operation ID. No receipt was issued.'); return; }
    await runWrite(async () => (await issueReceipt(clinicSlug, current, current.revision, operationId, csrfToken)).episode,
      'The clinic issued a final synthetic paid receipt. Review it below before printing.');
  }

  if (accessDenied) return <section className="workflow-access" role="alert"><h3>Billing unavailable</h3><p>This staff account or clinic does not have access to billing. Contact your clinic administrator.</p></section>;
  return <div className="billing">
    <div className="workflow-intro"><div><span className="eyebrow">CLINIC BILLING</span><h3>Checkout and payments</h3><p>One clinic visit, with a separate consultation fee and actual pharmacy supplies.</p></div><span className="workflow-pilot">Synthetic pilot only</span></div>
    <p className="workflow-notice">This records staff-confirmed cash, UPI, or card payments. It does not verify a bank transaction or issue a statutory tax invoice.</p>
    <section className="workflow-card" aria-labelledby="billing-queue-heading"><div className="workflow-card-head billing-head"><div><span className="workflow-step">01</span><h4 id="billing-queue-heading">Clinic day billing queue</h4></div><div className="workflow-queue-controls"><label>Date<input type="date" value={date} onChange={(event) => { if (!pending) { setDate(event.target.value); setSelected(null); setDetail(null); setLegacyVisit(null); setWriteBlocked(false); } }} disabled={pending} /></label><button type="button" className="workflow-link" onClick={() => { if (!pending) { setReload((value) => value + 1); if (selected) void loadDetail(selected); } }} disabled={pending || listLoading}>Refresh queue</button></div></div>
      <p className="workflow-hint">Each visit has its own manually entered consultation fee. The assigned doctor can enter it as well.</p>
      {listLoading ? <p role="status" className="workflow-muted">Loading billing episodes…</p> : listError ? <p className="workflow-error" role="alert">{listError}</p> : items.length === 0 ? <p className="workflow-empty">No billed visits on {date}. Check in a booked patient or enter a fee for an existing visit.</p> : <div className="billing-groups">{STAGES.map((stage) => groups[stage].length > 0 && <section key={stage} aria-label={BILLING_STAGE_LABELS[stage]}><h5>{BILLING_STAGE_LABELS[stage]} <span>{groups[stage].length}</span></h5><div className="billing-episode-list">{groups[stage].map((episode) => <button type="button" key={episode.appointmentId} className={`billing-episode${selected?.appointmentId === episode.appointmentId ? ' is-selected' : ''}`} aria-pressed={selected?.appointmentId === episode.appointmentId} onClick={() => void loadDetail(episode)} disabled={pending}><strong>{episode.patientName}</strong><span>Consultation {formatPaise(episode.consultationTotalPaise)} · Pharmacy {formatPaise(episode.pharmacyTotalPaise)}</span><small>Outstanding {formatPaise(episode.outstandingPaise)}{episode.paidPaise > 0 && !episode.receiptIssued ? ' · Earlier payment on open episode' : ''}</small></button>)}</div></section>)}</div>}
    </section>
    <section className="workflow-card billing-detail" aria-labelledby="billing-detail-heading"><div className="workflow-card-head"><div><span className="workflow-step">02</span><h4 id="billing-detail-heading">Visit checkout</h4></div></div>
      {!selected ? <p className="workflow-empty">Select a billed visit to review charges and payments.</p> : detailLoading ? <p role="status" className="workflow-muted">Verifying current bill…</p> : detailError || !detail ? <div role="alert" className="workflow-error"><p>{detailError || 'The bill could not be verified.'}</p><button type="button" className="workflow-link" onClick={() => void loadDetail(selected)}>Reload bill</button></div> : <>
        <div className="billing-detail-top"><div><span className="eyebrow">{BILLING_STAGE_LABELS[billingStage(detail.episode)]}</span><h5>{detail.episode.patientName}</h5><p>Visit date {detail.episode.clinicDate} · Revision {detail.episode.revision}</p></div><div className="billing-outstanding"><span>Outstanding</span><strong>{formatPaise(detail.episode.outstandingPaise)}</strong></div></div>
        <div className="billing-totals"><span>Consultation <strong>{formatPaise(detail.episode.consultationTotalPaise)}</strong></span><span>Pharmacy supplied <strong>{formatPaise(detail.episode.pharmacyTotalPaise)}</strong></span><span>Total <strong>{formatPaise(detail.episode.totalPaise)}</strong></span><span>Received <strong>{formatPaise(detail.episode.paidPaise)}</strong></span></div>
        {detail.episode.checkoutStatus === 'awaiting_consultation' && <p className="workflow-hint">This episode is still awaiting the doctor’s finalized consultation. A payment now is a prepayment, not a final paid receipt.</p>}
        {(detail.episode.pharmacyDisposition === 'awaiting' || detail.episode.pharmacyDisposition === 'open') && <p className="workflow-hint">Pharmacy may still post supplied items. Any amount received now remains an open-episode prepayment; no final receipt is available yet.</p>}
        <h6>Posted charges</h6>{detail.charges.some((charge) => charge.kind === 'consultation' && charge.source === 'clinic_config') && <p className="workflow-hint">This visit has a consultation fee saved by the earlier standard-fee workflow. It remains part of this visit’s bill; the current workflow asks staff to enter fees manually for new visits.</p>}{detail.charges.length === 0 ? <p className="workflow-empty">No charges posted yet.</p> : <ul className="billing-lines">{detail.charges.map((charge) => <li key={charge.id}><span>{charge.kind === 'consultation' ? 'Consultation' : 'Pharmacy'} · {charge.description}{charge.kind === 'consultation' && charge.source === 'clinic_config' && <small>Earlier standard fee</small>}<small>{charge.quantity} {charge.quantityUnit} × {formatPaise(charge.unitPricePaise)}</small></span><strong>{formatPaise(charge.amountPaise)}</strong></li>)}</ul>}
        <h6>Manual payment entries</h6>{detail.payments.length === 0 ? <p className="workflow-empty">No payment recorded for this visit.</p> : <ul className="billing-lines">{detail.payments.map((payment) => <li key={payment.id}><span>{payment.method.toUpperCase()} · {new Date(payment.recordedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}{payment.reference && <small>Reference: {payment.reference}</small>}</span><strong>{formatPaise(payment.amountPaise)}</strong></li>)}</ul>}
        {selectedFeeMissing && !detail.episode.receiptIssued && <div className="billing-action-box"><h6>Missing consultation fee</h6><p>Enter the fee for this visit. The server rejects a duplicate if reception or the doctor already saved one.</p><label>Consultation fee (₹)<input inputMode="decimal" value={feeRupees} onChange={(event) => { setFeeRupees(event.target.value); setFeeConfirmed(false); }} placeholder="0.00" disabled={!canWrite} /></label><label className="billing-confirm"><input type="checkbox" checked={feeConfirmed} onChange={(event) => setFeeConfirmed(event.target.checked)} disabled={!canWrite} /> I confirm this fee for this visit.</label><button type="button" className="workflow-action" disabled={!canWrite || !feeConfirmed} onClick={() => void addMissingFee(detail.episode)}>Save consultation fee</button></div>}
        {!detail.episode.receiptIssued && detail.episode.outstandingPaise > 0 && <form className="billing-action-box billing-payment" onSubmit={(event) => void submitPayment(event)}><h6>Record received payment</h6><p>Enter only money the clinic has confirmed receiving. Partial payments keep a visible outstanding balance.</p><div className="billing-payment-fields"><label>Amount received (₹)<input inputMode="decimal" value={paymentRupees} onChange={(event) => setPaymentRupees(event.target.value)} placeholder="0.00" disabled={!canWrite} required /></label><label>Method<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)} disabled={!canWrite}><option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option></select></label><label>Reference <span className="workflow-optional">optional</span><input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} maxLength={80} pattern="[A-Za-z0-9 ._:/-]*" title="Use letters, numbers, spaces, or . _ : / -" disabled={!canWrite} /></label></div><button className="workflow-action" type="submit" disabled={!canWrite}>Record payment</button></form>}
        {!detail.episode.receiptIssued && <div className="billing-action-box"><h6>Final paid receipt</h6><p>{receiptReady ? 'The server shows the visit ready for checkout and the balance is zero. Issuing creates an immutable synthetic receipt.' : 'A final receipt needs a posted consultation fee, completed consultation and pharmacy disposition, and zero outstanding balance.'}</p><button type="button" className="workflow-action" disabled={!canWrite || !receiptReady} onClick={() => void createReceipt()}>Issue paid demo receipt</button></div>}
        {detail.receipt && <div className="billing-action-box"><p role="status" className="workflow-success">Final synthetic paid receipt {detail.receipt.id} was issued by the clinic service.</p><button type="button" className="workflow-action" onClick={() => window.print()}>Print issued receipt</button></div>}
      </>}
      {writeBlocked && <p className="workflow-error" role="alert">Further billing writes are paused until the latest clinic record is reloaded. <button type="button" className="workflow-link" onClick={() => selected && void loadDetail(selected)} disabled={!selected || pending}>Reload bill</button></p>}
      {actionError && <p className="workflow-error" role="alert">{actionError}</p>}{actionSuccess && <p className="workflow-success" role="status">{actionSuccess}</p>}
    </section>
    <section className="workflow-card" aria-labelledby="missing-fee-heading"><div className="workflow-card-head"><div><span className="workflow-step">03</span><h4 id="missing-fee-heading">Older visit without a fee</h4></div><p>Use only for an already checked-in visit, or an older booked visit whose doctor encounter was finalized. The server verifies eligibility and rejects duplicate charges.</p></div>
      {visitsError ? <p className="workflow-error" role="alert">{visitsError}</p> : listLoading || visitsLoading ? <p className="workflow-muted">Checking older visits…</p> : missingFeeVisits.length === 0 ? <p className="workflow-empty">No older visits on this date need a manual fee action.</p> : <div className="billing-legacy-list">{missingFeeVisits.map((visit) => <button type="button" key={visit.id} className="workflow-link" onClick={() => { setLegacyVisit(visit); setFeeRupees(''); setFeeConfirmed(false); setActionError(''); }} disabled={pending}>{visit.patientName} · {timeLabel(visit.startAt)} · {visit.status.replaceAll('_', ' ')}</button>)}</div>}
      {legacyVisit && <div className="billing-action-box"><h6>{legacyVisit.patientName}</h6><p>Enter a fee for this existing visit. This creates one charge; it does not mark the bill paid.</p><label>Consultation fee (₹)<input inputMode="decimal" value={feeRupees} onChange={(event) => { setFeeRupees(event.target.value); setFeeConfirmed(false); }} placeholder="0.00" disabled={pending || writeBlocked} /></label><label className="billing-confirm"><input type="checkbox" checked={feeConfirmed} onChange={(event) => setFeeConfirmed(event.target.checked)} disabled={pending || writeBlocked} /> I confirm this fee for the selected visit.</label><button type="button" className="workflow-action" disabled={!feeConfirmed || pending || writeBlocked} onClick={() => void addMissingFee({ appointmentId: legacyVisit.id, clinicDate: date })}>Save consultation fee</button></div>}
    </section>
    {detail?.receipt && <BillingReceiptPrint receipt={detail.receipt} />}
  </div>;
}

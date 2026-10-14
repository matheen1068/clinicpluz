import { useEffect, useRef, useState } from 'react';
import type { PrintablePrescription } from './consultationApi';
import {
  BillingApiError, QUANTITY_UNITS, readFulfillment, recordFulfillment,
  type FulfillmentDetail, type QuantityUnit, type SupplyInput,
} from './billingApi';
import { formatPaise, rupeesToPaise } from './billingMoney';
import type { PrescriptionQueueItem } from './prescriptionApi';

interface Props {
  clinicSlug: string; csrfToken: string; selected: PrescriptionQueueItem;
  prescription: PrintablePrescription; onSessionLost: () => void; onPendingChange: (pending: boolean) => void;
  onPrintSlip: (fulfillment: FulfillmentDetail) => void;
}
interface RowInput { selected: boolean; quantity: string; quantityUnit: QuantityUnit | ''; priceRupees: string; status: 'partly_supplied' | 'supplied' | '' }
function blankRow(): RowInput { return { selected: false, quantity: '', quantityUnit: '', priceRupees: '', status: '' }; }
function timestamp(value: string): string { return new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }); }

function matchesPrescription(value: FulfillmentDetail, prescription: PrintablePrescription): boolean {
  return value.patient.id === prescription.patient.id && value.items.length === prescription.medications.length &&
    value.items.every((item) => {
      const medicine = prescription.medications[item.prescriptionIndex];
      return medicine && item.name === medicine.name && item.strength === medicine.strength;
    });
}

export default function PharmacyFulfillment({ clinicSlug, csrfToken, selected, prescription, onSessionLost, onPendingChange, onPrintSlip }: Props) {
  const [detail, setDetail] = useState<FulfillmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState('');
  const [accessDenied, setAccessDenied] = useState(false);
  const [reload, setReload] = useState(0);
  const [rows, setRows] = useState<Record<number, RowInput>>({});
  const [closeForCheckout, setCloseForCheckout] = useState(false);
  const [pending, setPending] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [writeBlocked, setWriteBlocked] = useState(false);
  const [writeError, setWriteError] = useState('');
  const [success, setSuccess] = useState('');
  const readController = useRef<AbortController | null>(null);
  useEffect(() => { onPendingChange(pending || printing); }, [pending, printing, onPendingChange]);
  useEffect(() => () => { readController.current?.abort(); onPendingChange(false); }, [onPendingChange]);

  useEffect(() => {
    const controller = new AbortController();
    readController.current = controller;
    setLoading(true); setDetail(null); setReadError(''); setWriteError(''); setAccessDenied(false);
    void readFulfillment(clinicSlug, selected, csrfToken, controller.signal).then((value) => {
      if (controller.signal.aborted) return;
      if (!matchesPrescription(value, prescription)) throw new BillingApiError(null, 'Fulfillment does not match the finalized prescription');
      setDetail(value); setRows({}); setCloseForCheckout(false); setWriteBlocked(false);
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      if (error instanceof BillingApiError && error.status === 401) onSessionLost();
      else if (error instanceof BillingApiError && error.status === 403) setAccessDenied(true);
      else setReadError('The pharmacy record could not be verified. No supply or charge action is available.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [clinicSlug, csrfToken, selected.appointmentId, selected.clinicDate, prescription.finalizedAt, reload]);

  function update(index: number, patch: Partial<RowInput>) {
    setRows((current) => ({ ...current, [index]: { ...(current[index] ?? blankRow()), ...patch } }));
    setWriteError('');
  }
  async function save() {
    if (!detail || pending || printing || writeBlocked || detail.episode.pharmacyDisposition === 'closed') return;
    const items: SupplyInput[] = [];
    for (const item of detail.items) {
      const row = rows[item.prescriptionIndex];
      if (!row?.selected) continue;
      const quantity = Number(row.quantity);
      const unitPricePaise = rupeesToPaise(row.priceRupees);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10_000 || !row.quantityUnit ||
          unitPricePaise === null || unitPricePaise > 10_000_000 || quantity * unitPricePaise > 100_000_000 || !row.status) {
        setWriteError(`Check supplied quantity, unit, price, and partial/full status for ${item.name}. Nothing was submitted.`);
        return;
      }
      items.push({ prescriptionIndex: item.prescriptionIndex, quantity, quantityUnit: row.quantityUnit, unitPricePaise, status: row.status });
    }
    if (items.length > 10) { setWriteError('Record at most 10 supplied prescription items per save. You can save the remaining items in another step.'); return; }
    if (items.length === 0 && !closeForCheckout) { setWriteError('Select at least one actually supplied item, or explicitly close the handoff with no supply.'); return; }
    const operationId = globalThis.crypto?.randomUUID?.();
    if (!operationId) { setWriteError('This browser cannot create a safe operation ID. No fulfillment was posted.'); return; }
    setPending(true); setWriteError(''); setSuccess('');
    try {
      await recordFulfillment(clinicSlug, selected, detail.episode.revision, detail.prescriptionRevision, items, closeForCheckout, operationId, csrfToken);
      setSuccess(closeForCheckout ? 'Actual supplies were recorded and the pharmacy handoff was closed for checkout.' : 'Actual supplies were recorded. The handoff remains open for later partial fills.');
      setReload((value) => value + 1);
    } catch (error) {
      if (error instanceof BillingApiError && error.status === 401) onSessionLost();
      else if (error instanceof BillingApiError && error.status === 403) setAccessDenied(true);
      else {
        setWriteBlocked(true);
        setWriteError(error instanceof BillingApiError && error.status === 409
          ? 'The prescription or bill changed, or this supply was already recorded. Refresh fulfillment and review the recorded lines before trying again.'
          : error instanceof BillingApiError && error.status === 400
            ? 'The clinic rejected these supply details. Refresh the fulfillment record and check quantities, prices, and status.'
            : 'The supply outcome could not be confirmed. Do not repeat it until you refresh and review the recorded lines.');
      }
    } finally { setPending(false); }
  }

  async function printHandover() {
    if (!detail || loading || pending || printing || writeBlocked) return;
    setPrinting(true); setWriteError('');
    try {
      const value = await readFulfillment(clinicSlug, selected, csrfToken);
      const suppliedTotal = value.items.reduce((sum, item) =>
        sum + item.supplies.reduce((itemSum, supply) => itemSum + supply.amountPaise, 0), 0);
      if (!matchesPrescription(value, prescription) || suppliedTotal !== value.episode.pharmacyTotalPaise ||
          (suppliedTotal === 0 && value.episode.pharmacyDisposition !== 'closed')) {
        throw new BillingApiError(null, 'Handover does not match the current clinic record');
      }
      setDetail(value);
      onPrintSlip(value);
    } catch (error) {
      if (error instanceof BillingApiError && error.status === 401) onSessionLost();
      else if (error instanceof BillingApiError && error.status === 403) setAccessDenied(true);
      else setWriteError('The current supplied-item record could not be verified. Refresh fulfillment before printing.');
    } finally { setPrinting(false); }
  }

  return <section className="pharmacy-fulfillment" aria-labelledby="fulfillment-heading"><div className="pharmacy-fulfillment-head"><div><span className="eyebrow">PHARMACY · SYNTHETIC PILOT</span><h6 id="fulfillment-heading">Record medicines actually supplied</h6></div><button type="button" className="workflow-link" onClick={() => setReload((value) => value + 1)} disabled={pending || loading || printing}>Refresh fulfillment</button></div>
    <p>Doctor-entered medicine details above are read-only. This section records what was physically handed over and its clinic price. It does not change the prescription or confirm payment.</p>
    {loading ? <p className="workflow-muted" role="status">Verifying pharmacy handoff…</p> : accessDenied ? <p className="workflow-error" role="alert">This staff account or clinic does not have pharmacy fulfillment access.</p> : readError || !detail ? <p className="workflow-error" role="alert">{readError || 'Pharmacy handoff unavailable.'}</p> : <>
      <p className="workflow-hint">Pharmacy disposition: <strong>{detail.episode.pharmacyDisposition.replaceAll('_', ' ')}</strong>. Supplied charges posted: <strong>{formatPaise(detail.episode.pharmacyTotalPaise)}</strong>. Reception records payment separately.</p>
      <div className="pharmacy-items">{detail.items.map((item) => {
        const row = rows[item.prescriptionIndex] ?? blankRow();
        const locked = item.status === 'supplied' || detail.episode.pharmacyDisposition === 'closed' || pending || printing || writeBlocked;
        return <div className="pharmacy-item" key={item.prescriptionIndex}><div className="pharmacy-item-heading"><strong>{item.name} {item.strength}</strong><span>{item.status.replaceAll('_', ' ')}</span></div>
          <p>Doctor’s order item #{item.prescriptionIndex + 1}. Supplied so far: {item.suppliedQuantity}{item.quantityUnit ? ` ${item.quantityUnit}` : ''}. There is no calculated remaining quantity.</p>
          {item.supplies.length > 0 && <ul>{item.supplies.map((supply, index) => <li key={`${supply.recordedAt}:${index}`}>{supply.quantity} {supply.quantityUnit} × {formatPaise(supply.unitPricePaise)} = {formatPaise(supply.amountPaise)} · {timestamp(supply.recordedAt)}</li>)}</ul>}
          {!locked && <><label className="billing-confirm"><input type="checkbox" checked={row.selected} onChange={(event) => update(item.prescriptionIndex, { selected: event.target.checked, ...(!row.quantityUnit && item.quantityUnit ? { quantityUnit: item.quantityUnit } : {}) })} /> Supply this exact item now</label>{row.selected && <div className="pharmacy-fields"><label>Actual quantity<input type="number" min="1" max="10000" step="1" value={row.quantity} onChange={(event) => update(item.prescriptionIndex, { quantity: event.target.value })} /></label><label>Unit<select value={row.quantityUnit} onChange={(event) => update(item.prescriptionIndex, { quantityUnit: event.target.value as QuantityUnit | '' })}><option value="">Choose unit</option>{QUANTITY_UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></label><label>Unit price (₹)<input inputMode="decimal" value={row.priceRupees} onChange={(event) => update(item.prescriptionIndex, { priceRupees: event.target.value })} placeholder="0.00" /></label><label>Supply status<select value={row.status} onChange={(event) => update(item.prescriptionIndex, { status: event.target.value as RowInput['status'] })}><option value="">Choose status</option><option value="partly_supplied">Partly supplied</option><option value="supplied">Supplied as declared</option></select></label></div>}</>}
        </div>;
      })}</div>
      {detail.episode.pharmacyDisposition !== 'closed' && <div className="pharmacy-fulfillment-actions"><label className="billing-confirm"><input type="checkbox" checked={closeForCheckout} onChange={(event) => setCloseForCheckout(event.target.checked)} disabled={pending || printing || writeBlocked} /> Close pharmacy handoff for this checkout. Untouched prescription items were not supplied and add no charge.</label><button type="button" className="workflow-action" onClick={() => void save()} disabled={pending || printing || writeBlocked}>{pending ? 'Posting supplies…' : closeForCheckout ? 'Record supply and close handoff' : 'Record actual supplies'}</button></div>}
      {(detail.items.some((item) => item.supplies.length > 0) || detail.episode.pharmacyDisposition === 'closed') && <div className="pharmacy-print-action"><p>Print a record of server-confirmed medicines supplied. This is not a paid receipt.</p><button type="button" className="workflow-link" onClick={() => void printHandover()} disabled={pending || loading || printing || writeBlocked}>{printing ? 'Verifying handover…' : 'Print pharmacy handover'}</button></div>}
      {writeBlocked && <p className="workflow-error" role="alert">Further supply writes are paused until the clinic record is refreshed.</p>}
    </>}
    {writeError && <p className="workflow-error" role="alert">{writeError}</p>}{success && <p className="workflow-success" role="status">{success}</p>}
  </section>;
}

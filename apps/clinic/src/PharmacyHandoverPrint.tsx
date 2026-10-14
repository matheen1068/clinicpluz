import type { PrintablePrescription } from './consultationApi';
import type { FulfillmentDetail } from './billingApi';
import { formatPaise } from './billingMoney';

interface Props {
  prescription: PrintablePrescription;
  fulfillment: FulfillmentDetail;
}

function clinicTime(value: string): string {
  return new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
}

export default function PharmacyHandoverPrint({ prescription, fulfillment }: Props) {
  const supplied = fulfillment.items.flatMap((item) => item.supplies.map((entry, index) => ({
    key: `${item.prescriptionIndex}:${index}`,
    name: item.name,
    strength: item.strength,
    ...entry,
  })));

  return <section className="pharmacy-handover-print" aria-label="Synthetic pharmacy handover record">
    <p className="pharmacy-print-warning">SYNTHETIC PHARMACY HANDOVER · NOT A PAID RECEIPT · NOT A TAX INVOICE</p>
    <header><h1>{prescription.clinic.displayName}</h1><p>Medicines actually supplied for this visit</p></header>
    <div className="pharmacy-print-meta">
      <p><strong>Patient</strong> {fulfillment.patient.fullName}</p>
      <p><strong>Clinic date</strong> {fulfillment.clinicDate}</p>
      <p><strong>Finalizing doctor</strong> {prescription.doctor.displayName}</p>
      <p><strong>Pharmacy status</strong> {fulfillment.episode.pharmacyDisposition.replaceAll('_', ' ')}</p>
    </div>
    {supplied.length === 0 ? <p>No medicine supply has been recorded for this visit.</p> : <table>
      <thead><tr><th scope="col">Doctor-prescribed item</th><th scope="col">Actual supply</th><th scope="col">Recorded</th><th scope="col">Charge</th></tr></thead>
      <tbody>{supplied.map((item) => <tr key={item.key}><td>{item.name} {item.strength}</td><td>{item.quantity} {item.quantityUnit}</td><td>{clinicTime(item.recordedAt)}</td><td>{formatPaise(item.amountPaise)}</td></tr>)}</tbody>
    </table>}
    <p className="pharmacy-print-total">Supplied-item charges <strong>{formatPaise(fulfillment.episode.pharmacyTotalPaise)}</strong></p>
    <footer>This handover shows only server-recorded pharmacy supply. It does not confirm payment. Reception records payment and may issue a separate final receipt after checkout.</footer>
  </section>;
}

import type { Receipt } from './billingApi';
import { formatPaise } from './billingMoney';

export default function BillingReceiptPrint({ receipt }: { receipt: Receipt }) {
  return <section className="billing-receipt-print" aria-label="Issued synthetic paid receipt">
    <p className="billing-print-warning">SYNTHETIC DEMO RECEIPT · Not a tax invoice · No real patient or payment data</p>
    <header><h1>{receipt.clinic.displayName}</h1><p>Paid receipt {receipt.id}</p></header>
    <div className="billing-print-meta"><p><strong>Patient</strong> {receipt.patient.fullName}</p><p><strong>Clinic date</strong> {receipt.clinicDate}</p><p><strong>Issued</strong> {new Date(receipt.issuedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</p></div>
    <h2>Consultation and pharmacy</h2>
    <table><thead><tr><th scope="col">Item</th><th scope="col">Quantity</th><th scope="col">Rate</th><th scope="col">Amount</th></tr></thead><tbody>{receipt.charges.map((charge) => <tr key={charge.id}><td>{charge.kind === 'consultation' ? 'Consultation · ' : 'Pharmacy · '}{charge.description}</td><td>{charge.quantity} {charge.quantityUnit}</td><td>{formatPaise(charge.unitPricePaise)}</td><td>{formatPaise(charge.amountPaise)}</td></tr>)}</tbody></table>
    <div className="billing-print-totals"><p>Total <strong>{formatPaise(receipt.totalPaise)}</strong></p><p>Received <strong>{formatPaise(receipt.paidPaise)}</strong></p><p>Balance <strong>{formatPaise(receipt.outstandingPaise)}</strong></p></div>
    <h2>Payments recorded by clinic staff</h2>
    <ul>{receipt.payments.map((payment) => <li key={payment.id}>{new Date(payment.recordedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} · {payment.method.toUpperCase()} · {formatPaise(payment.amountPaise)}</li>)}</ul>
    <footer>Manual payment record. This demo does not verify bank transfer or card settlement and is not a statutory GST invoice.</footer>
  </section>;
}

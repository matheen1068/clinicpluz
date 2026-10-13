import type { PrintablePrescription } from './consultationApi';
import { medicationTimingText } from './medicationDirections';

function clinicTime(value: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(value));
}

export default function PrescriptionPrint({ prescription }: { prescription: PrintablePrescription }) {
  return <section className="prescription-print" aria-label="Finalized prescription print view">
    <div className="print-pilot">ClinicPluz synthetic pilot · Not for real clinical use</div>
    <header><h1>{prescription.clinic.displayName}</h1><p>Finalized prescription · {prescription.appointmentDate}</p></header>
    <div className="print-people"><p><strong>Patient:</strong> {prescription.patient.fullName} · {prescription.patient.ageYears} years at registration · {prescription.patient.sex}</p><p><strong>Doctor:</strong> {prescription.doctor.displayName}</p><p><strong>Finalized:</strong> {clinicTime(prescription.finalizedAt)}</p></div>
    <h2>Doctor-entered medicines</h2>
    <ol>{prescription.medications.map((medicine, index) => <li key={index}><strong>{medicine.name} {medicine.strength}</strong><p>Dose: {medicine.dose} · Route: {medicine.route}</p><p>{medicationTimingText(medicine)} · Duration: {medicine.duration}</p><p>Instructions: {medicine.instructions}</p></li>)}</ol>
    <footer>Generated from the finalized ClinicPluz encounter. No automated clinical checks or advice are provided.</footer>
  </section>;
}

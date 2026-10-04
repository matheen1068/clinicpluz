import React from 'react';
import { Printer, X, Share2, CheckCircle2, AlertCircle } from 'lucide-react';
import { useClinic } from '../../context/ClinicContext';
import { Prescription, LabReport, Invoice, Appointment } from '../../types/clinic';
import {
  buildPrescriptionWhatsAppMessage,
  buildLabReportWhatsAppMessage,
  buildInvoiceWhatsAppMessage,
} from '../../utils/whatsapp';

export const PrintableDocumentModal: React.FC = () => {
  const { printModal, closePrintModal, clinicSettings, openWhatsAppModal } = useClinic();

  if (!printModal.isOpen || !printModal.data) return null;

  const handlePrint = () => {
    window.print();
  };

  const handleShareWhatsApp = () => {
    if (printModal.type === 'prescription') {
      const rx = printModal.data as Prescription;
      openWhatsAppModal({
        title: `Digital Prescription #${rx.id}`,
        recipientName: rx.patientName,
        phone: '', // Will default to search patient phone
        message: buildPrescriptionWhatsAppMessage(rx, clinicSettings),
      });
    } else if (printModal.type === 'report') {
      const rep = printModal.data as LabReport;
      openWhatsAppModal({
        title: `Diagnostic Lab Report #${rep.id}`,
        recipientName: rep.patientName,
        phone: '',
        message: buildLabReportWhatsAppMessage(rep, clinicSettings),
      });
    } else if (printModal.type === 'invoice') {
      const inv = printModal.data as Invoice;
      openWhatsAppModal({
        title: `Official Invoice #${inv.id}`,
        recipientName: inv.patientName,
        phone: inv.patientPhone,
        message: buildInvoiceWhatsAppMessage(inv, clinicSettings),
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-xs overflow-y-auto">
      <div 
        id="printable-document-dialog"
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-3xl w-full my-8 overflow-hidden flex flex-col max-h-[92vh] animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Top Control Bar (Hidden when printing) */}
        <div className="bg-slate-800 text-white px-6 py-3.5 flex items-center justify-between no-print">
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wider font-semibold text-slate-300">
              Clinical Document Viewer
            </span>
            <span className="bg-emerald-500/20 text-emerald-300 text-xs px-2 py-0.5 rounded font-mono font-medium">
              {printModal.type.toUpperCase()}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleShareWhatsApp}
              className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors shadow-xs"
            >
              <Share2 className="w-3.5 h-3.5" />
              WhatsApp
            </button>

            <button
              onClick={handlePrint}
              className="bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors shadow-xs"
            >
              <Printer className="w-3.5 h-3.5" />
              Print / Save PDF
            </button>

            <button
              onClick={closePrintModal}
              className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-700 transition-colors ml-2"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Printable Paper Canvas */}
        <div className="p-8 overflow-y-auto flex-1 bg-white text-slate-900 printable-document font-sans">
          {/* Clinic Official Header */}
          <div className="border-b-2 border-slate-900 pb-4 mb-6">
            <div className="flex justify-between items-start">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-slate-950 uppercase">
                  {clinicSettings.name}
                </h1>
                <p className="text-xs text-slate-600 font-medium tracking-wide mt-0.5">
                  {clinicSettings.tagline} • Lic. No: <span className="font-mono">{clinicSettings.regNumber}</span>
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  {clinicSettings.address}
                </p>
              </div>

              <div className="text-right text-xs text-slate-600 space-y-0.5">
                <p>Phone: <strong className="text-slate-900">{clinicSettings.phone}</strong></p>
                <p>Emergency: <strong className="text-rose-700">{clinicSettings.emergencyPhone}</strong></p>
                <p>Email: {clinicSettings.email}</p>
              </div>
            </div>
          </div>

          {/* PRESCRIPTION VIEW */}
          {printModal.type === 'prescription' && (
            <PrescriptionPrintView rx={printModal.data as Prescription} />
          )}

          {/* LAB REPORT VIEW */}
          {printModal.type === 'report' && (
            <LabReportPrintView report={printModal.data as LabReport} />
          )}

          {/* INVOICE VIEW */}
          {printModal.type === 'invoice' && (
            <InvoicePrintView inv={printModal.data as Invoice} currency={clinicSettings.currencySymbol} />
          )}

          {/* Clinic Footer and Signature */}
          <div className="mt-12 pt-6 border-t border-slate-200 text-xs text-slate-500 flex justify-between items-end">
            <div>
              <p className="font-medium text-slate-700">Digital Record Validation</p>
              <p className="text-[11px] text-slate-400">
                Generated by {clinicSettings.name} Hospital Information System.
              </p>
              <p className="text-[11px] text-slate-400">
                For queries or emergency support, contact {clinicSettings.phone}.
              </p>
            </div>

            <div className="text-center w-48">
              <div className="h-12 border-b border-dashed border-slate-400 mb-1 flex items-center justify-center">
                <span className="text-[11px] italic text-slate-400">Authorized Signature & Seal</span>
              </div>
              <p className="text-xs font-semibold text-slate-800">Physician / In-Charge</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/* Sub-view: Prescription */
const PrescriptionPrintView: React.FC<{ rx: Prescription }> = ({ rx }) => {
  return (
    <div className="space-y-6">
      {/* Meta Bar */}
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div>
          <span className="text-slate-500 block">Patient Name:</span>
          <strong className="text-slate-900 font-semibold">{rx.patientName}</strong>
        </div>
        <div>
          <span className="text-slate-500 block">Age / Gender:</span>
          <strong className="text-slate-900">{rx.patientAge} yrs / {rx.patientGender}</strong>
        </div>
        <div>
          <span className="text-slate-500 block">Prescription ID:</span>
          <strong className="font-mono text-slate-900">{rx.id}</strong>
        </div>
        <div>
          <span className="text-slate-500 block">Date:</span>
          <strong className="text-slate-900">{rx.date}</strong>
        </div>
      </div>

      {/* Doctor Info */}
      <div className="flex justify-between items-center text-xs pb-2 border-b border-slate-200">
        <div>
          <span className="text-slate-500">Consultant: </span>
          <strong className="text-slate-900 text-sm">{rx.doctorName}</strong>
          <span className="text-slate-600 block text-[11px]">{rx.doctorSpecialty} (Reg: {rx.doctorRegNo})</span>
        </div>
      </div>

      {/* Vitals Box if recorded */}
      {rx.vitals && Object.values(rx.vitals).some(v => v !== undefined) && (
        <div className="border border-slate-200 rounded-lg p-3 bg-slate-50/70">
          <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wide mb-1.5">
            Recorded Patient Vitals
          </h4>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-xs">
            {rx.vitals.bpSystolic && (
              <div>
                <span className="text-slate-400 block text-[10px]">Blood Pressure</span>
                <span className="font-semibold text-slate-800">{rx.vitals.bpSystolic}/{rx.vitals.bpDiastolic} mmHg</span>
              </div>
            )}
            {rx.vitals.pulse && (
              <div>
                <span className="text-slate-400 block text-[10px]">Pulse Rate</span>
                <span className="font-semibold text-slate-800">{rx.vitals.pulse} bpm</span>
              </div>
            )}
            {rx.vitals.spo2 && (
              <div>
                <span className="text-slate-400 block text-[10px]">SpO2</span>
                <span className="font-semibold text-slate-800">{rx.vitals.spo2}%</span>
              </div>
            )}
            {rx.vitals.temperature && (
              <div>
                <span className="text-slate-400 block text-[10px]">Temp</span>
                <span className="font-semibold text-slate-800">{rx.vitals.temperature}°F</span>
              </div>
            )}
            {rx.vitals.weight && (
              <div>
                <span className="text-slate-400 block text-[10px]">Weight / BMI</span>
                <span className="font-semibold text-slate-800">{rx.vitals.weight}kg ({rx.vitals.bmi || '-'})</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Symptoms & Diagnosis */}
      <div className="space-y-2">
        {rx.symptoms && rx.symptoms.length > 0 && (
          <div className="text-xs">
            <span className="font-bold text-slate-700 uppercase text-[11px]">Chief Complaints: </span>
            <span className="text-slate-800">{rx.symptoms.join(', ')}</span>
          </div>
        )}
        <div className="text-xs bg-emerald-50 border border-emerald-200 p-2.5 rounded-lg">
          <span className="font-bold text-emerald-900 uppercase text-[11px] block">Provisional Diagnosis:</span>
          <span className="text-emerald-950 font-medium text-sm">{rx.diagnosis}</span>
        </div>
      </div>

      {/* Medicines Table */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xl font-bold font-serif text-slate-900">℞</span>
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
            Prescribed Medications
          </h3>
        </div>

        <table className="w-full text-xs text-left border-collapse border border-slate-200">
          <thead>
            <tr className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
              <th className="p-2 border-r border-slate-200 w-8 text-center">#</th>
              <th className="p-2 border-r border-slate-200">Medicine & Dosage</th>
              <th className="p-2 border-r border-slate-200">Frequency</th>
              <th className="p-2 border-r border-slate-200">Timing</th>
              <th className="p-2 border-r border-slate-200 text-center">Duration</th>
              <th className="p-2">Specific Instructions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {rx.medicines.map((med, idx) => (
              <tr key={med.id || idx} className="hover:bg-slate-50">
                <td className="p-2 text-center text-slate-500 border-r border-slate-200 font-medium">
                  {idx + 1}
                </td>
                <td className="p-2 border-r border-slate-200 font-semibold text-slate-900">
                  {med.name}
                  <span className="block text-[11px] font-normal text-slate-500">{med.type} • {med.dosage}</span>
                </td>
                <td className="p-2 border-r border-slate-200 font-medium text-slate-800">
                  {med.frequency}
                </td>
                <td className="p-2 border-r border-slate-200 text-slate-700">
                  {med.timing}
                </td>
                <td className="p-2 border-r border-slate-200 text-center font-medium text-slate-800">
                  {med.durationDays} days
                </td>
                <td className="p-2 text-slate-600 text-[11px]">
                  {med.instructions || 'As instructed'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Advice & Investigations */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
        {rx.dietaryAdvice && (
          <div className="border border-slate-200 p-2.5 rounded-lg bg-amber-50/50">
            <h4 className="font-bold text-amber-900 text-[11px] uppercase mb-1">General & Dietary Advice:</h4>
            <p className="text-slate-800 leading-relaxed">{rx.dietaryAdvice}</p>
          </div>
        )}

        {rx.investigationsAdvised && rx.investigationsAdvised.length > 0 && (
          <div className="border border-slate-200 p-2.5 rounded-lg bg-blue-50/50">
            <h4 className="font-bold text-blue-900 text-[11px] uppercase mb-1">Advised Investigations:</h4>
            <ul className="list-disc list-inside text-slate-800 space-y-0.5">
              {rx.investigationsAdvised.map((inv, i) => (
                <li key={i}>{inv}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Follow-up */}
      {rx.nextFollowUpDate && (
        <div className="text-xs text-right text-slate-700 font-medium">
          Next Review / Follow-up on: <strong className="text-slate-900 text-sm">{rx.nextFollowUpDate}</strong>
        </div>
      )}
    </div>
  );
};

/* Sub-view: Lab Report */
const LabReportPrintView: React.FC<{ report: LabReport }> = ({ report }) => {
  return (
    <div className="space-y-6">
      {/* Patient & Report Meta */}
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div>
          <span className="text-slate-500 block">Patient Name:</span>
          <strong className="text-slate-900 font-semibold">{report.patientName}</strong>
        </div>
        <div>
          <span className="text-slate-500 block">Age / Gender:</span>
          <strong className="text-slate-900">{report.patientAge} yrs / {report.patientGender}</strong>
        </div>
        <div>
          <span className="text-slate-500 block">Report ID:</span>
          <strong className="font-mono text-slate-900">{report.id}</strong>
        </div>
        <div>
          <span className="text-slate-500 block">Report Date:</span>
          <strong className="text-slate-900">{report.reportDate}</strong>
        </div>
      </div>

      <div className="flex justify-between items-center text-xs pb-2 border-b border-slate-200">
        <div>
          <span className="text-slate-500">Referring Physician: </span>
          <strong className="text-slate-800">{report.doctorName}</strong>
        </div>
        <div>
          <span className="text-slate-500">Department: </span>
          <span className="font-semibold text-slate-800">{report.category}</span>
        </div>
      </div>

      {/* Title */}
      <div className="text-center py-2 bg-slate-100 rounded-md">
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900">
          {report.testTitle}
        </h3>
      </div>

      {/* Parameters Table */}
      <table className="w-full text-xs text-left border-collapse border border-slate-200">
        <thead>
          <tr className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
            <th className="p-2 border-r border-slate-200">Test Parameter</th>
            <th className="p-2 border-r border-slate-200 text-right">Result Value</th>
            <th className="p-2 border-r border-slate-200">Unit</th>
            <th className="p-2 border-r border-slate-200">Reference Range</th>
            <th className="p-2 text-center">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {report.items.map((item, idx) => {
            const isAbnormal = item.status !== 'Normal';
            return (
              <tr key={idx} className={isAbnormal ? 'bg-amber-50/40' : 'hover:bg-slate-50'}>
                <td className="p-2 border-r border-slate-200 font-medium text-slate-900">
                  {item.testName}
                </td>
                <td className={`p-2 border-r border-slate-200 text-right font-semibold font-mono ${isAbnormal ? 'text-rose-700' : 'text-slate-900'}`}>
                  {item.resultValue}
                </td>
                <td className="p-2 border-r border-slate-200 text-slate-600">
                  {item.unit}
                </td>
                <td className="p-2 border-r border-slate-200 text-slate-600">
                  {item.referenceRange}
                </td>
                <td className="p-2 text-center">
                  <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                    item.status === 'Normal' ? 'bg-emerald-100 text-emerald-800' :
                    item.status === 'High' ? 'bg-rose-100 text-rose-800' :
                    item.status === 'Low' ? 'bg-blue-100 text-blue-800' : 'bg-red-200 text-red-900'
                  }`}>
                    {item.status}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Impression */}
      <div className="border border-slate-200 rounded-lg p-3 bg-slate-50">
        <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wide mb-1">
          Clinical Impression:
        </h4>
        <p className="text-xs text-slate-800 leading-relaxed font-medium">
          {report.impression}
        </p>
        {report.technicianNotes && (
          <p className="text-[11px] text-slate-500 mt-2 italic">
            Note: {report.technicianNotes}
          </p>
        )}
      </div>

      <div className="flex justify-between text-xs text-slate-600 pt-2">
        <p>Analyzed & Checked: <strong>{report.technicianName}</strong></p>
        <p>Status: <strong className="text-emerald-700 uppercase">{report.status}</strong></p>
      </div>
    </div>
  );
};

/* Sub-view: Invoice / Bill */
const InvoicePrintView: React.FC<{ inv: Invoice; currency: string }> = ({ inv, currency }) => {
  return (
    <div className="space-y-6">
      {/* Patient & Bill Meta */}
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div>
          <span className="text-slate-500 block">Billed To:</span>
          <strong className="text-slate-900 font-semibold">{inv.patientName}</strong>
        </div>
        <div>
          <span className="text-slate-500 block">Patient Phone:</span>
          <strong className="text-slate-900">{inv.patientPhone}</strong>
        </div>
        <div>
          <span className="text-slate-500 block">Invoice Number:</span>
          <strong className="font-mono text-slate-900">{inv.id}</strong>
        </div>
        <div>
          <span className="text-slate-500 block">Date of Invoice:</span>
          <strong className="text-slate-900">{inv.date}</strong>
        </div>
      </div>

      {/* Items Table */}
      <table className="w-full text-xs text-left border-collapse border border-slate-200">
        <thead>
          <tr className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
            <th className="p-2 border-r border-slate-200 w-8 text-center">#</th>
            <th className="p-2 border-r border-slate-200">Item Description</th>
            <th className="p-2 border-r border-slate-200">Department / Category</th>
            <th className="p-2 border-r border-slate-200 text-right">Unit Price</th>
            <th className="p-2 border-r border-slate-200 text-center">Qty</th>
            <th className="p-2 text-right">Total Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {inv.items.map((item, idx) => (
            <tr key={item.id || idx} className="hover:bg-slate-50">
              <td className="p-2 text-center text-slate-500 border-r border-slate-200 font-medium">
                {idx + 1}
              </td>
              <td className="p-2 border-r border-slate-200 font-semibold text-slate-900">
                {item.description}
              </td>
              <td className="p-2 border-r border-slate-200 text-slate-600">
                {item.category}
              </td>
              <td className="p-2 border-r border-slate-200 text-right font-mono">
                {currency}{item.unitPrice.toFixed(2)}
              </td>
              <td className="p-2 border-r border-slate-200 text-center font-mono">
                {item.quantity}
              </td>
              <td className="p-2 text-right font-semibold font-mono text-slate-900">
                {currency}{item.total.toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Tally Breakdown */}
      <div className="flex justify-end">
        <div className="w-64 space-y-1.5 text-xs text-slate-700 border-t border-slate-300 pt-3">
          <div className="flex justify-between">
            <span>Subtotal:</span>
            <span className="font-mono font-medium">{currency}{inv.subtotal.toFixed(2)}</span>
          </div>

          {inv.discountAmount > 0 && (
            <div className="flex justify-between text-emerald-700">
              <span>Discount ({inv.discountPercent}%):</span>
              <span className="font-mono font-medium">-{currency}{inv.discountAmount.toFixed(2)}</span>
            </div>
          )}

          <div className="flex justify-between text-slate-600">
            <span>Taxes ({inv.taxPercent}%):</span>
            <span className="font-mono font-medium">+{currency}{inv.taxAmount.toFixed(2)}</span>
          </div>

          <div className="flex justify-between text-sm font-bold text-slate-900 border-t-2 border-slate-900 pt-2">
            <span>Grand Total:</span>
            <span className="font-mono">{currency}{inv.grandTotal.toFixed(2)}</span>
          </div>

          <div className="flex justify-between text-xs text-emerald-800 font-semibold pt-1">
            <span>Amount Received:</span>
            <span className="font-mono">{currency}{inv.amountPaid.toFixed(2)}</span>
          </div>

          {inv.balanceDue > 0 ? (
            <div className="flex justify-between text-xs text-rose-700 font-bold">
              <span>Balance Due:</span>
              <span className="font-mono">{currency}{inv.balanceDue.toFixed(2)}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1 text-emerald-700 font-bold text-xs pt-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> Full Payment Settled
            </div>
          )}
        </div>
      </div>

      {/* Payment details */}
      <div className="border border-slate-200 rounded-lg p-3 bg-slate-50 text-xs flex justify-between items-center">
        <div>
          <span className="text-slate-500 block">Payment Mode:</span>
          <span className="font-semibold text-slate-800">{inv.paymentMode}</span>
          {inv.transactionReference && (
            <span className="text-[11px] text-slate-500 block font-mono">Ref: {inv.transactionReference}</span>
          )}
        </div>
        <div className="text-right">
          <span className="text-slate-500 block">Payment Status:</span>
          <span className={`px-2.5 py-1 rounded text-xs font-bold uppercase ${
            inv.paymentStatus === 'Paid' ? 'bg-emerald-100 text-emerald-800' :
            inv.paymentStatus === 'Partial' ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800'
          }`}>
            {inv.paymentStatus}
          </span>
        </div>
      </div>
    </div>
  );
};

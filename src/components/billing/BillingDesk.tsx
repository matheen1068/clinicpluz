import React, { useState } from 'react';
import {
  Receipt,
  Plus,
  Trash2,
  Share2,
  Printer,
  CreditCard,
  Banknote,
  QrCode,
  CheckCircle2,
  AlertCircle,
  Calculator,
} from 'lucide-react';
import { useClinic } from '../../context/ClinicContext';
import { BillItem, Invoice } from '../../types/clinic';
import { buildInvoiceWhatsAppMessage } from '../../utils/whatsapp';

const STANDARD_SERVICES = [
  { description: 'General Physician OPD Consultation', category: 'Consultation', price: 40 },
  { description: 'Specialist / Senior Consultant OPD Visit', category: 'Consultation', price: 60 },
  { description: '12-Lead Electrocardiogram (ECG)', category: 'Procedure', price: 25 },
  { description: 'Nebulization Treatment Session', category: 'Procedure', price: 15 },
  { description: 'Sterile Wound Dressing & Antiseptic Care', category: 'Procedure', price: 20 },
  { description: 'Complete Blood Count (CBC) Laboratory', category: 'Lab Investigation', price: 25 },
  { description: 'Lipid Profile Investigation', category: 'Lab Investigation', price: 30 },
  { description: 'Random Blood Glucose Spot Glucometer Test', category: 'Procedure', price: 5 },
  { description: 'Intramuscular / IV Injection Administration', category: 'Nursing', price: 10 },
];

export const BillingDesk: React.FC = () => {
  const {
    patients,
    doctors,
    invoices,
    selectedPatientId,
    setSelectedPatientId,
    addInvoice,
    recordInvoicePayment,
    openWhatsAppModal,
    openPrintModal,
    clinicSettings,
  } = useClinic();

  const [activePatientId, setActivePatientId] = useState<string>(
    selectedPatientId || (patients[0]?.id || '')
  );

  const currentPatient = patients.find((p) => p.id === activePatientId) || patients[0];

  // Bill items state
  const [billItems, setBillItems] = useState<BillItem[]>([
    {
      id: 'bi-1',
      description: 'Specialist OPD Consultation',
      category: 'Consultation',
      unitPrice: 40,
      quantity: 1,
      total: 40,
    },
    {
      id: 'bi-2',
      description: 'Random Blood Glucose Spot Check',
      category: 'Procedure',
      unitPrice: 5,
      quantity: 1,
      total: 5,
    }
  ]);

  const [discountPercent, setDiscountPercent] = useState<number>(0);
  const [taxPercent, setTaxPercent] = useState<number>(clinicSettings.taxRate || 5);
  const [paymentMode, setPaymentMode] = useState<Invoice['paymentMode']>('UPI / QR');
  const [transactionRef, setTransactionRef] = useState<string>('UPI-REF-' + Math.floor(100000 + Math.random() * 900000));
  const [paymentStatus, setPaymentStatus] = useState<Invoice['paymentStatus']>('Paid');
  const [customAmountPaid, setCustomAmountPaid] = useState<string>('');
  const [billNotes, setBillNotes] = useState<string>('Thank you for visiting LifeCare. Please retain this receipt.');

  // Calculations
  const subtotal = billItems.reduce((acc, item) => acc + item.total, 0);
  const discountAmount = Number(((subtotal * discountPercent) / 100).toFixed(2));
  const taxableAmount = Math.max(0, subtotal - discountAmount);
  const taxAmount = Number(((taxableAmount * taxPercent) / 100).toFixed(2));
  const grandTotal = Number((taxableAmount + taxAmount).toFixed(2));

  const amountPaid = paymentStatus === 'Paid'
    ? grandTotal
    : paymentStatus === 'Unpaid'
    ? 0
    : Number(customAmountPaid) || 0;

  const balanceDue = Math.max(0, Number((grandTotal - amountPaid).toFixed(2)));

  const handleAddItem = (preset?: typeof STANDARD_SERVICES[0]) => {
    if (preset) {
      const newItem: BillItem = {
        id: `bi-${Date.now()}`,
        description: preset.description,
        category: preset.category as any,
        unitPrice: preset.price,
        quantity: 1,
        total: preset.price,
      };
      setBillItems([...billItems, newItem]);
    } else {
      const newItem: BillItem = {
        id: `bi-${Date.now()}`,
        description: '',
        category: 'Consultation',
        unitPrice: 0,
        quantity: 1,
        total: 0,
      };
      setBillItems([...billItems, newItem]);
    }
  };

  const handleUpdateItem = (index: number, updates: Partial<BillItem>) => {
    setBillItems((prev) =>
      prev.map((item, i) => {
        if (i === index) {
          const updated = { ...item, ...updates };
          updated.total = Number((updated.unitPrice * updated.quantity).toFixed(2));
          return updated;
        }
        return item;
      })
    );
  };

  const handleRemoveItem = (index: number) => {
    setBillItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSaveInvoice = (andShareWhatsApp = false) => {
    if (!currentPatient) return;

    const validItems = billItems.filter((it) => it.description.trim().length > 0);
    if (validItems.length === 0) return;

    const newInvoice = addInvoice({
      patientId: currentPatient.id,
      patientName: currentPatient.name,
      patientPhone: currentPatient.phone,
      items: validItems,
      subtotal,
      discountPercent,
      discountAmount,
      taxPercent,
      taxAmount,
      grandTotal,
      amountPaid,
      balanceDue,
      paymentStatus,
      paymentMode,
      transactionReference: transactionRef,
      notes: billNotes,
    });

    if (andShareWhatsApp) {
      openWhatsAppModal({
        title: `Official Invoice #${newInvoice.id}`,
        recipientName: currentPatient.name,
        phone: currentPatient.whatsappNumber || currentPatient.phone,
        message: buildInvoiceWhatsAppMessage(newInvoice, clinicSettings),
      });
    } else {
      openPrintModal({
        type: 'invoice',
        data: newInvoice,
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <Receipt className="w-6 h-6 text-amber-600" />
            <h2 className="text-xl font-bold text-slate-900">
              Billing Desk & Cash Counter
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Generate itemized tax receipts for consultations, lab diagnostics, medications, and procedures with instant WhatsApp dispatch.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleSaveInvoice(false)}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 shadow-xs transition-colors"
          >
            <Printer className="w-4 h-4" />
            Save & Print Receipt
          </button>

          <button
            type="button"
            onClick={() => handleSaveInvoice(true)}
            className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 shadow-xs transition-colors"
          >
            <Share2 className="w-4 h-4" />
            Save & Send via WhatsApp
          </button>
        </div>
      </div>

      {/* Patient & Quick Services Ribbon */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div className="md:col-span-4">
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
            Billed Patient:
          </label>
          <select
            value={activePatientId}
            onChange={(e) => {
              setActivePatientId(e.target.value);
              setSelectedPatientId(e.target.value);
            }}
            className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-bold"
          >
            {patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.id}) - {p.phone}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-slate-500 mt-1">
            Address: {currentPatient?.address}
          </p>
        </div>

        {/* Preset standard items quick buttons */}
        <div className="md:col-span-8">
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
            Fast Add Standard Clinical Services:
          </label>
          <div className="flex flex-wrap gap-1.5">
            {STANDARD_SERVICES.map((srv) => (
              <button
                key={srv.description}
                type="button"
                onClick={() => handleAddItem(srv)}
                className="text-[11px] bg-slate-50 hover:bg-amber-50 hover:text-amber-900 border border-slate-200 hover:border-amber-300 px-2.5 py-1 rounded-lg transition-colors text-slate-700 font-medium"
              >
                + {srv.description.split('(')[0].trim()} ({clinicSettings.currencySymbol}{srv.price})
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Bill Items Table */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 className="font-bold text-sm text-slate-900">
            Itemized Clinical Charges & Fees
          </h3>
          <span className="text-xs text-slate-500">
            {billItems.length} Charge Lines
          </span>
        </div>

        <div className="space-y-2.5">
          {billItems.map((item, index) => (
            <div
              key={item.id || index}
              className="p-3 bg-slate-50 border border-slate-200 rounded-xl grid grid-cols-1 sm:grid-cols-12 gap-3 items-center"
            >
              <div className="sm:col-span-5">
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">
                  Item Description #{index + 1}
                </label>
                <input
                  type="text"
                  placeholder="e.g. Doctor Consultation Fee"
                  value={item.description}
                  onChange={(e) => handleUpdateItem(index, { description: e.target.value })}
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg font-semibold text-slate-900"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">
                  Category
                </label>
                <select
                  value={item.category}
                  onChange={(e) => handleUpdateItem(index, { category: e.target.value as any })}
                  className="w-full px-2 py-1.5 text-xs bg-white border border-slate-300 rounded-lg text-slate-800"
                >
                  <option value="Consultation">Consultation</option>
                  <option value="Lab Investigation">Lab Investigation</option>
                  <option value="Pharmacy">Pharmacy</option>
                  <option value="Procedure">Procedure</option>
                  <option value="Nursing">Nursing</option>
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">
                  Unit Price ({clinicSettings.currencySymbol})
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={item.unitPrice}
                  onChange={(e) => handleUpdateItem(index, { unitPrice: Number(e.target.value) })}
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg font-mono text-slate-900 font-semibold"
                />
              </div>

              <div className="sm:col-span-1">
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">
                  Qty
                </label>
                <input
                  type="number"
                  min="1"
                  value={item.quantity}
                  onChange={(e) => handleUpdateItem(index, { quantity: Number(e.target.value) })}
                  className="w-full px-2 py-1.5 text-xs bg-white border border-slate-300 rounded-lg font-mono text-center"
                />
              </div>

              <div className="sm:col-span-1 text-right">
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">
                  Total
                </label>
                <span className="font-mono font-bold text-xs text-slate-900 block py-1.5">
                  {clinicSettings.currencySymbol}{item.total.toFixed(2)}
                </span>
              </div>

              <div className="sm:col-span-1 text-right">
                <button
                  type="button"
                  onClick={() => handleRemoveItem(index)}
                  className="text-rose-500 hover:text-rose-700 p-1 hover:bg-rose-50 rounded-lg"
                  title="Remove charge"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={() => handleAddItem()}
            className="w-full py-2.5 border-2 border-dashed border-amber-300 hover:border-amber-500 bg-amber-50/40 text-amber-900 text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Custom Billing Item Line
          </button>
        </div>
      </div>

      {/* Payment & Tally Section */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        {/* Left: Payment Mode & Notes (7 cols) */}
        <div className="md:col-span-7 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
          <h3 className="font-bold text-xs uppercase tracking-wider text-slate-600">
            Payment Mode & Transaction Reference
          </h3>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {(['Cash', 'UPI / QR', 'Credit/Debit Card', 'Net Banking'] as Invoice['paymentMode'][]).map(
              (mode) => {
                const isSelected = paymentMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setPaymentMode(mode)}
                    className={`p-2.5 rounded-xl border text-xs font-semibold flex flex-col items-center gap-1 transition-all ${
                      isSelected
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-500/20 shadow-xs'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {mode === 'Cash' && <Banknote className="w-4 h-4 text-emerald-600" />}
                    {mode === 'UPI / QR' && <QrCode className="w-4 h-4 text-purple-600" />}
                    {mode === 'Credit/Debit Card' && <CreditCard className="w-4 h-4 text-blue-600" />}
                    {mode === 'Net Banking' && <Calculator className="w-4 h-4 text-slate-600" />}
                    <span>{mode}</span>
                  </button>
                );
              }
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Transaction Reference / Auth Code:
              </label>
              <input
                type="text"
                value={transactionRef}
                onChange={(e) => setTransactionRef(e.target.value)}
                placeholder="e.g. UPI/2026/9821 or Cash Desk"
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg font-mono text-slate-800"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Payment Status:
              </label>
              <select
                value={paymentStatus}
                onChange={(e) => setPaymentStatus(e.target.value as any)}
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg font-bold text-slate-800"
              >
                <option value="Paid">Fully Paid (100% Settled)</option>
                <option value="Partial">Partial Payment Received</option>
                <option value="Unpaid">Unpaid / Credit Due</option>
              </select>
            </div>

            {paymentStatus === 'Partial' && (
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-amber-800 mb-1">
                  Amount Received Now ({clinicSettings.currencySymbol}):
                </label>
                <input
                  type="number"
                  placeholder="Enter initial advance received"
                  value={customAmountPaid}
                  onChange={(e) => setCustomAmountPaid(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-amber-50/50 border border-amber-300 rounded-lg font-mono font-bold text-amber-900"
                />
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Invoice Remarks / Footnote:
            </label>
            <input
              type="text"
              value={billNotes}
              onChange={(e) => setBillNotes(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
            />
          </div>
        </div>

        {/* Right: Tally Summary Card (5 cols) */}
        <div className="md:col-span-5 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between space-y-4">
          <div>
            <h3 className="font-bold text-xs uppercase tracking-wider text-slate-600 mb-3">
              Charges & Tax Breakdown
            </h3>

            <div className="space-y-2.5 text-xs text-slate-700">
              <div className="flex justify-between">
                <span>Subtotal (Gross Charges):</span>
                <span className="font-mono font-bold text-slate-900">
                  {clinicSettings.currencySymbol}{subtotal.toFixed(2)}
                </span>
              </div>

              {/* Discount Row */}
              <div className="flex items-center justify-between">
                <span className="text-emerald-700 flex items-center gap-1 font-medium">
                  Discount:
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={discountPercent}
                    onChange={(e) => setDiscountPercent(Number(e.target.value))}
                    className="w-12 px-1 py-0.5 border border-emerald-300 bg-emerald-50 rounded text-center font-mono font-bold text-emerald-800"
                  />
                  %
                </span>
                <span className="font-mono text-emerald-700 font-bold">
                  -{clinicSettings.currencySymbol}{discountAmount.toFixed(2)}
                </span>
              </div>

              {/* Tax Row */}
              <div className="flex items-center justify-between">
                <span className="text-slate-600 flex items-center gap-1">
                  Tax Rate:
                  <input
                    type="number"
                    min="0"
                    value={taxPercent}
                    onChange={(e) => setTaxPercent(Number(e.target.value))}
                    className="w-12 px-1 py-0.5 border border-slate-300 bg-slate-50 rounded text-center font-mono"
                  />
                  %
                </span>
                <span className="font-mono text-slate-700">
                  +{clinicSettings.currencySymbol}{taxAmount.toFixed(2)}
                </span>
              </div>

              <div className="pt-2 border-t-2 border-slate-900 flex justify-between items-baseline">
                <span className="text-sm font-bold text-slate-900">Grand Total:</span>
                <span className="text-xl font-bold font-mono text-slate-950">
                  {clinicSettings.currencySymbol}{grandTotal.toFixed(2)}
                </span>
              </div>

              <div className="pt-2 border-t border-slate-200 space-y-1">
                <div className="flex justify-between text-emerald-800 font-semibold">
                  <span>Amount Paid:</span>
                  <span className="font-mono">
                    {clinicSettings.currencySymbol}{amountPaid.toFixed(2)}
                  </span>
                </div>

                {balanceDue > 0 ? (
                  <div className="flex justify-between text-rose-700 font-bold bg-rose-50 p-2 rounded-lg">
                    <span>Balance Due:</span>
                    <span className="font-mono">
                      {clinicSettings.currencySymbol}{balanceDue.toFixed(2)}
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 text-emerald-700 font-bold text-xs bg-emerald-50 p-1.5 rounded-lg">
                    <CheckCircle2 className="w-4 h-4" /> Full Amount Settled
                  </div>
                )}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => handleSaveInvoice(true)}
            className="w-full py-3 bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 shadow-xs transition-colors"
          >
            <Share2 className="w-4 h-4" />
            Complete Bill & WhatsApp Patient
          </button>
        </div>
      </div>

      {/* Historical Invoices Ledger */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-3">
        <h3 className="font-bold text-sm text-slate-900">
          Recent Cash Register & Issued Invoices
        </h3>

        <div className="divide-y divide-slate-100">
          {invoices.map((inv) => (
            <div
              key={inv.id}
              className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-xs text-slate-900">{inv.id}</span>
                  <span className="font-semibold text-xs text-slate-900">{inv.patientName}</span>
                  <span className="text-[11px] text-slate-400">({inv.date})</span>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                      inv.paymentStatus === 'Paid'
                        ? 'bg-emerald-100 text-emerald-800'
                        : inv.paymentStatus === 'Partial'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-rose-100 text-rose-800'
                    }`}
                  >
                    {inv.paymentStatus}
                  </span>
                </div>
                <p className="text-xs text-slate-600 mt-0.5">
                  Total: <strong>{clinicSettings.currencySymbol}{inv.grandTotal.toFixed(2)}</strong> • Paid: {clinicSettings.currencySymbol}{inv.amountPaid.toFixed(2)} • Mode: {inv.paymentMode}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => openPrintModal({ type: 'invoice', data: inv })}
                  className="px-2.5 py-1 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg flex items-center gap-1"
                >
                  <Printer className="w-3 h-3" /> View / Print
                </button>

                <button
                  type="button"
                  onClick={() =>
                    openWhatsAppModal({
                      title: `Invoice #${inv.id}`,
                      recipientName: inv.patientName,
                      phone: inv.patientPhone,
                      message: buildInvoiceWhatsAppMessage(inv, clinicSettings),
                    })
                  }
                  className="px-2.5 py-1 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg flex items-center gap-1"
                >
                  <Share2 className="w-3 h-3" /> WhatsApp
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

import React, { useState } from 'react';
import {
  FlaskConical,
  Plus,
  Trash2,
  Share2,
  Printer,
  CheckCircle2,
  AlertTriangle,
  FileCheck,
  Search,
  Sparkles,
} from 'lucide-react';
import { useClinic } from '../../context/ClinicContext';
import { LabReport, LabTestItem } from '../../types/clinic';
import { buildLabReportWhatsAppMessage } from '../../utils/whatsapp';

interface TemplateDef {
  category: LabReport['category'];
  title: string;
  impression: string;
  items: LabTestItem[];
}

const REPORT_TEMPLATES: Record<string, TemplateDef> = {
  CBC: {
    category: 'Hematology',
    title: 'Complete Blood Count (CBC with Automated Differential)',
    impression: 'Mild microcytic hypochromic anemia. Leucocyte and platelet counts within normal reference limits.',
    items: [
      { testName: 'Hemoglobin (Hb)', resultValue: '11.2', unit: 'g/dL', referenceRange: '12.0 - 15.5', status: 'Low' },
      { testName: 'Total Leucocyte Count (TLC)', resultValue: '7,400', unit: '/cumm', referenceRange: '4,000 - 11,000', status: 'Normal' },
      { testName: 'Platelet Count', resultValue: '2.4', unit: 'Lakhs/cumm', referenceRange: '1.5 - 4.5', status: 'Normal' },
      { testName: 'Packed Cell Volume (PCV)', resultValue: '35.4', unit: '%', referenceRange: '36.0 - 46.0', status: 'Low' },
      { testName: 'Total RBC Count', resultValue: '4.1', unit: 'mil/cumm', referenceRange: '3.8 - 4.8', status: 'Normal' },
    ]
  },
  LIPID: {
    category: 'Lipid Profile',
    title: 'Comprehensive Serum Lipid & Atherogenic Profile',
    impression: 'Elevated total serum cholesterol and atherogenic LDL with suboptimal protective HDL levels.',
    items: [
      { testName: 'Total Cholesterol', resultValue: '238', unit: 'mg/dL', referenceRange: '< 200', status: 'High' },
      { testName: 'Triglycerides', resultValue: '195', unit: 'mg/dL', referenceRange: '< 150', status: 'High' },
      { testName: 'HDL Cholesterol', resultValue: '37', unit: 'mg/dL', referenceRange: '> 40', status: 'Low' },
      { testName: 'LDL Cholesterol', resultValue: '162', unit: 'mg/dL', referenceRange: '< 100', status: 'High' },
      { testName: 'VLDL Cholesterol', resultValue: '39', unit: 'mg/dL', referenceRange: '5 - 30', status: 'High' },
    ]
  },
  DIABETES: {
    category: 'Biochemistry',
    title: 'Glycated Hemoglobin (HbA1c) & Fasting Plasma Glucose',
    impression: 'Glycated hemoglobin indicates suboptimal glycemic control. Advised diabetic review.',
    items: [
      { testName: 'Fasting Plasma Glucose', resultValue: '142', unit: 'mg/dL', referenceRange: '70 - 99', status: 'High' },
      { testName: 'Post Prandial Blood Glucose (2h)', resultValue: '215', unit: 'mg/dL', referenceRange: '< 140', status: 'High' },
      { testName: 'Glycated Hemoglobin (HbA1c)', resultValue: '7.8', unit: '%', referenceRange: '4.0 - 5.6', status: 'High' },
      { testName: 'Estimated Average Glucose (eAG)', resultValue: '177', unit: 'mg/dL', referenceRange: '< 120', status: 'High' },
    ]
  },
  THYROID: {
    category: 'Thyroid & Endocrine',
    title: 'Thyroid Function Test (Ultrasensitive T3, T4, TSH)',
    impression: 'Elevated TSH with borderline low free thyroxine suggestive of primary hypothyroidism.',
    items: [
      { testName: 'Total Triiodothyronine (T3)', resultValue: '0.85', unit: 'ng/mL', referenceRange: '0.80 - 2.00', status: 'Normal' },
      { testName: 'Total Thyroxine (T4)', resultValue: '5.2', unit: 'mcg/dL', referenceRange: '5.1 - 14.1', status: 'Normal' },
      { testName: 'Ultrasensitive TSH', resultValue: '7.65', unit: 'uIU/mL', referenceRange: '0.35 - 4.94', status: 'High' },
    ]
  }
};

export const LabReportGenerator: React.FC = () => {
  const {
    patients,
    doctors,
    labReports,
    selectedPatientId,
    setSelectedPatientId,
    addLabReport,
    openWhatsAppModal,
    openPrintModal,
    clinicSettings,
  } = useClinic();

  const [activePatientId, setActivePatientId] = useState<string>(
    selectedPatientId || (patients[0]?.id || '')
  );
  const [activeDoctorId, setActiveDoctorId] = useState<string>(doctors[0]?.id || '');

  const currentPatient = patients.find((p) => p.id === activePatientId) || patients[0];
  const currentDoctor = doctors.find((d) => d.id === activeDoctorId) || doctors[0];

  // Report Form State
  const [category, setCategory] = useState<LabReport['category']>('Hematology');
  const [testTitle, setTestTitle] = useState(REPORT_TEMPLATES.CBC.title);
  const [impression, setImpression] = useState(REPORT_TEMPLATES.CBC.impression);
  const [technicianNotes, setTechnicianNotes] = useState('Specimen processed on fully automated hematology analyzer.');
  const [technicianName, setTechnicianName] = useState('Sanjay Verma (Senior Lab Technologist)');
  const [sampleDate, setSampleDate] = useState(new Date().toISOString().replace('T', ' ').slice(0, 16));

  const [testItems, setTestItems] = useState<LabTestItem[]>(REPORT_TEMPLATES.CBC.items);

  const applyTemplate = (key: keyof typeof REPORT_TEMPLATES) => {
    const tpl = REPORT_TEMPLATES[key];
    setCategory(tpl.category);
    setTestTitle(tpl.title);
    setImpression(tpl.impression);
    setTestItems(tpl.items);
  };

  const handleUpdateItem = (index: number, updates: Partial<LabTestItem>) => {
    setTestItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...updates } : item))
    );
  };

  const handleAddItem = () => {
    setTestItems([
      ...testItems,
      { testName: '', resultValue: '', unit: '', referenceRange: '', status: 'Normal' },
    ]);
  };

  const handleRemoveItem = (index: number) => {
    setTestItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSaveReport = (andShareWhatsApp = false) => {
    if (!currentPatient || !currentDoctor) return;

    const newReport = addLabReport({
      patientId: currentPatient.id,
      patientName: currentPatient.name,
      patientAge: currentPatient.age,
      patientGender: currentPatient.gender,
      doctorId: currentDoctor.id,
      doctorName: currentDoctor.name,
      category,
      testTitle,
      sampleCollectionDate: sampleDate,
      items: testItems.filter((it) => it.testName.trim().length > 0),
      technicianNotes,
      impression,
      status: 'Signed',
      technicianName,
    });

    if (andShareWhatsApp) {
      openWhatsAppModal({
        title: `Lab Report #${newReport.id}`,
        recipientName: currentPatient.name,
        phone: currentPatient.whatsappNumber || currentPatient.phone,
        message: buildLabReportWhatsAppMessage(newReport, clinicSettings),
      });
    } else {
      openPrintModal({
        type: 'report',
        data: newReport,
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <FlaskConical className="w-6 h-6 text-sky-700" />
            <h2 className="text-xl font-bold text-slate-900">
              Diagnostic Laboratory & Investigation Reports
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Generate standardized clinical lab test reports, compare biological reference ranges, and dispatch directly to patient via WhatsApp.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleSaveReport(false)}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 shadow-xs transition-colors"
          >
            <Printer className="w-4 h-4" />
            Save & Print Report
          </button>

          <button
            type="button"
            onClick={() => handleSaveReport(true)}
            className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 shadow-xs transition-colors"
          >
            <Share2 className="w-4 h-4" />
            Save & Send via WhatsApp
          </button>
        </div>
      </div>

      {/* Template Quick Selection */}
      <div className="bg-sky-50/70 border border-sky-200 p-4 rounded-xl flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-bold text-sky-900">
          <Sparkles className="w-4 h-4 text-sky-600" />
          Load Standard Diagnostic Template:
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => applyTemplate('CBC')}
            className="px-3 py-1 bg-white hover:bg-sky-100 text-sky-900 text-xs font-semibold rounded-lg border border-sky-300 shadow-xs transition-colors"
          >
            Complete Blood Count (CBC)
          </button>
          <button
            type="button"
            onClick={() => applyTemplate('LIPID')}
            className="px-3 py-1 bg-white hover:bg-sky-100 text-sky-900 text-xs font-semibold rounded-lg border border-sky-300 shadow-xs transition-colors"
          >
            Lipid Profile
          </button>
          <button
            type="button"
            onClick={() => applyTemplate('DIABETES')}
            className="px-3 py-1 bg-white hover:bg-sky-100 text-sky-900 text-xs font-semibold rounded-lg border border-sky-300 shadow-xs transition-colors"
          >
            HbA1c & Blood Glucose
          </button>
          <button
            type="button"
            onClick={() => applyTemplate('THYROID')}
            className="px-3 py-1 bg-white hover:bg-sky-100 text-sky-900 text-xs font-semibold rounded-lg border border-sky-300 shadow-xs transition-colors"
          >
            Thyroid Panel (TSH)
          </button>
        </div>
      </div>

      {/* Patient & Doctor Meta */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
            Patient:
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
                {p.name} ({p.id}) • {p.age}y/{p.gender}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
            Referring Physician:
          </label>
          <select
            value={activeDoctorId}
            onChange={(e) => setActiveDoctorId(e.target.value)}
            className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-bold"
          >
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.specialty})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Report Header Details */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Test Investigation Title:
            </label>
            <input
              type="text"
              value={testTitle}
              onChange={(e) => setTestTitle(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg font-bold text-slate-900"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Department / Category:
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as any)}
              className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg font-medium text-slate-800"
            >
              <option value="Hematology">Hematology</option>
              <option value="Biochemistry">Biochemistry</option>
              <option value="Lipid Profile">Lipid Profile</option>
              <option value="Thyroid & Endocrine">Thyroid & Endocrine</option>
              <option value="Urine Analysis">Urine Analysis</option>
              <option value="Radiology">Radiology</option>
            </select>
          </div>
        </div>
      </div>

      {/* Lab Parameters Table */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 className="font-bold text-sm text-slate-900">
            Investigation Parameters & Findings
          </h3>
          <span className="text-xs text-slate-500">
            {testItems.length} Parameters Listed
          </span>
        </div>

        <div className="space-y-3">
          {testItems.map((item, index) => (
            <div
              key={index}
              className="p-3 bg-slate-50 border border-slate-200 rounded-xl grid grid-cols-1 sm:grid-cols-12 gap-3 items-center"
            >
              <div className="sm:col-span-4">
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">
                  Test Parameter #{index + 1}
                </label>
                <input
                  type="text"
                  placeholder="e.g. Hemoglobin"
                  value={item.testName}
                  onChange={(e) => handleUpdateItem(index, { testName: e.target.value })}
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg font-semibold text-slate-900"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">
                  Result Value
                </label>
                <input
                  type="text"
                  placeholder="e.g. 13.5"
                  value={item.resultValue}
                  onChange={(e) => handleUpdateItem(index, { resultValue: e.target.value })}
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg font-mono font-bold text-slate-900"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">
                  Unit
                </label>
                <input
                  type="text"
                  placeholder="e.g. g/dL"
                  value={item.unit}
                  onChange={(e) => handleUpdateItem(index, { unit: e.target.value })}
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg text-slate-700"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">
                  Reference Range
                </label>
                <input
                  type="text"
                  placeholder="e.g. 12.0 - 15.0"
                  value={item.referenceRange}
                  onChange={(e) => handleUpdateItem(index, { referenceRange: e.target.value })}
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg text-slate-600 text-xs"
                />
              </div>

              <div className="sm:col-span-1">
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">
                  Status
                </label>
                <select
                  value={item.status}
                  onChange={(e) => handleUpdateItem(index, { status: e.target.value as any })}
                  className={`w-full px-1.5 py-1.5 text-[11px] font-bold rounded-lg border ${
                    item.status === 'Normal' ? 'bg-emerald-50 text-emerald-800 border-emerald-300' :
                    item.status === 'High' ? 'bg-rose-50 text-rose-800 border-rose-300' :
                    item.status === 'Low' ? 'bg-blue-50 text-blue-800 border-blue-300' : 'bg-amber-100 text-amber-900 border-amber-300'
                  }`}
                >
                  <option value="Normal">Normal</option>
                  <option value="High">High</option>
                  <option value="Low">Low</option>
                  <option value="Critical">Critical</option>
                </select>
              </div>

              <div className="sm:col-span-1 text-right">
                <button
                  type="button"
                  onClick={() => handleRemoveItem(index)}
                  className="text-rose-500 hover:text-rose-700 p-1 hover:bg-rose-50 rounded-lg"
                  title="Remove parameter"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={handleAddItem}
            className="w-full py-2.5 border-2 border-dashed border-sky-300 hover:border-sky-500 bg-sky-50/50 text-sky-800 text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Another Investigation Parameter
          </button>
        </div>
      </div>

      {/* Impression & Certification */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Clinical Diagnostic Impression:
          </label>
          <textarea
            rows={3}
            value={impression}
            onChange={(e) => setImpression(e.target.value)}
            className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-medium"
            placeholder="Key diagnostic summary..."
          />
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Sample Collection Timestamp:
            </label>
            <input
              type="text"
              value={sampleDate}
              onChange={(e) => setSampleDate(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Verifying Pathologist / Lab Technologist:
            </label>
            <input
              type="text"
              value={technicianName}
              onChange={(e) => setTechnicianName(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-semibold"
            />
          </div>
        </div>
      </div>

      {/* Archive of Lab Reports */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-3">
        <h3 className="font-bold text-sm text-slate-900">
          Generated Diagnostic Lab Reports
        </h3>

        <div className="divide-y divide-slate-100">
          {labReports.map((rep) => (
            <div
              key={rep.id}
              className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-xs text-slate-900">{rep.id}</span>
                  <span className="font-semibold text-xs text-sky-900">{rep.patientName}</span>
                  <span className="text-[11px] text-slate-400">({rep.reportDate})</span>
                  <span className="bg-sky-100 text-sky-800 text-[10px] font-bold px-2 py-0.5 rounded">
                    {rep.category}
                  </span>
                </div>
                <p className="text-xs text-slate-600 mt-0.5">
                  <strong>{rep.testTitle}</strong> • Verified by: {rep.technicianName}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => openPrintModal({ type: 'report', data: rep })}
                  className="px-2.5 py-1 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg flex items-center gap-1"
                >
                  <Printer className="w-3 h-3" /> View / Print
                </button>

                <button
                  type="button"
                  onClick={() =>
                    openWhatsAppModal({
                      title: `Lab Report #${rep.id}`,
                      recipientName: rep.patientName,
                      phone: patients.find(p => p.id === rep.patientId)?.whatsappNumber || '',
                      message: buildLabReportWhatsAppMessage(rep, clinicSettings),
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

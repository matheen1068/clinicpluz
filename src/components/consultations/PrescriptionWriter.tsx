import React, { useState, useEffect } from 'react';
import {
  FileText,
  Plus,
  Trash2,
  Share2,
  Printer,
  AlertTriangle,
  HeartPulse,
  Calendar,
  CheckCircle2,
  Stethoscope,
  Sparkles,
} from 'lucide-react';
import { useClinic } from '../../context/ClinicContext';
import { useAuth } from '../../context/AuthContext';
import { MedicineItem, Prescription, Vitals } from '../../types/clinic';
import { buildPrescriptionWhatsAppMessage } from '../../utils/whatsapp';

const POPULAR_MEDICINES = [
  { name: 'Paracetamol', type: 'Tablet', dosage: '650 mg', frequency: '1-0-1', timing: 'After Food' },
  { name: 'Amoxicillin + Potassium Clavulanate', type: 'Tablet', dosage: '625 mg', frequency: '1-0-1', timing: 'After Food' },
  { name: 'Pantoprazole', type: 'Tablet', dosage: '40 mg', frequency: '1-0-0', timing: 'Before Food' },
  { name: 'Azithromycin', type: 'Tablet', dosage: '500 mg', frequency: '1-0-0', timing: 'After Food' },
  { name: 'Metformin SR', type: 'Tablet', dosage: '500 mg', frequency: '1-0-1', timing: 'After Food' },
  { name: 'Telmisartan', type: 'Tablet', dosage: '40 mg', frequency: '1-0-0', timing: 'Before Food' },
  { name: 'Cetirizine Hydrochloride', type: 'Tablet', dosage: '10 mg', frequency: '0-0-1', timing: 'Bedtime' },
  { name: 'Montelukast + Levocetirizine', type: 'Tablet', dosage: '10mg/5mg', frequency: '0-0-1', timing: 'Bedtime' },
];

export const PrescriptionWriter: React.FC = () => {
  const {
    patients,
    doctors,
    prescriptions,
    selectedPatientId,
    setSelectedPatientId,
    addPrescription,
    openWhatsAppModal,
    openPrintModal,
    clinicSettings,
  } = useClinic();

  const { currentUser } = useAuth();

  const [activePatientId, setActivePatientId] = useState<string>(
    selectedPatientId || (patients[0]?.id || '')
  );

  const [activeDoctorId, setActiveDoctorId] = useState<string>(() => {
    if (currentUser?.role === 'Doctor' && currentUser.doctorId) {
      return currentUser.doctorId;
    }
    return doctors[0]?.id || '';
  });

  useEffect(() => {
    if (currentUser?.role === 'Doctor' && currentUser.doctorId) {
      setActiveDoctorId(currentUser.doctorId);
    }
  }, [currentUser]);

  const currentPatient = patients.find((p) => p.id === activePatientId) || patients[0];
  const currentDoctor = doctors.find((d) => d.id === activeDoctorId) || doctors[0];

  // Vitals State
  const [vitals, setVitals] = useState<Vitals>({
    bpSystolic: 120,
    bpDiastolic: 80,
    pulse: 72,
    spo2: 99,
    temperature: 98.6,
    weight: 65,
    height: 168,
    bmi: 23.0,
  });

  // Calculate BMI on weight or height change
  useEffect(() => {
    if (vitals.weight && vitals.height && vitals.height > 0) {
      const heightInMeters = vitals.height / 100;
      const computedBmi = Number(
        (vitals.weight / (heightInMeters * heightInMeters)).toFixed(1)
      );
      setVitals((prev) => ({ ...prev, bmi: computedBmi }));
    }
  }, [vitals.weight, vitals.height]);

  // Clinical inputs
  const [symptomsInput, setSymptomsInput] = useState('Fever, body ache, sore throat for 2 days');
  const [diagnosis, setDiagnosis] = useState('Upper Respiratory Tract Infection (URTI) with Acute Pharyngitis');
  const [clinicalNotes, setClinicalNotes] = useState('Throat congestion present. Chest clear on auscultation. Vitals stable.');
  const [dietaryAdvice, setDietaryAdvice] = useState('Warm water gargles 3 times daily. Avoid cold beverages and oily foods. Adequate rest.');
  const [investigationsAdvised, setInvestigationsAdvised] = useState('Complete Blood Count (CBC) if fever persists beyond 48 hours');
  const [nextFollowUpDate, setNextFollowUpDate] = useState(
    new Date(Date.now() + 5 * 86400000).toISOString().split('T')[0]
  );

  // Medicines List
  const [medicines, setMedicines] = useState<MedicineItem[]>([
    {
      id: 'med-1',
      name: 'Amoxicillin + Potassium Clavulanate (Augmentin)',
      type: 'Tablet',
      dosage: '625 mg',
      frequency: '1-0-1 (Morning & Night)',
      timing: 'After Food',
      durationDays: 5,
      instructions: 'Complete full 5 days antibiotic course without skipping.',
    },
    {
      id: 'med-2',
      name: 'Paracetamol (Dolo)',
      type: 'Tablet',
      dosage: '650 mg',
      frequency: '1-0-1 (Or SOS if temp > 100°F)',
      timing: 'After Food',
      durationDays: 3,
      instructions: 'Maintain at least 6 hours gap between two doses.',
    },
    {
      id: 'med-3',
      name: 'Pantoprazole (Pan 40)',
      type: 'Tablet',
      dosage: '40 mg',
      frequency: '1-0-0 (Morning)',
      timing: 'Before Food',
      durationDays: 5,
      instructions: 'Take 30 mins prior to morning breakfast.',
    }
  ]);

  const [allergyWarning, setAllergyWarning] = useState<string | null>(null);

  // Check for allergy conflicts
  useEffect(() => {
    if (!currentPatient?.allergies || currentPatient.allergies.length === 0) {
      setAllergyWarning(null);
      return;
    }

    const patientAllergies = currentPatient.allergies.map(a => a.toLowerCase());
    const conflictingMeds: string[] = [];

    medicines.forEach(m => {
      const medName = m.name.toLowerCase();
      patientAllergies.forEach(allergy => {
        if (
          (allergy.includes('penicillin') && (medName.includes('amoxicillin') || medName.includes('ampicillin') || medName.includes('penicillin'))) ||
          (allergy.includes('sulfa') && medName.includes('sulfa')) ||
          (allergy.includes('aspirin') && medName.includes('aspirin')) ||
          (allergy.includes('nsaid') && (medName.includes('ibuprofen') || medName.includes('diclofenac')))
        ) {
          conflictingMeds.push(`${m.name} conflicts with allergy: "${allergy}"`);
        }
      });
    });

    if (conflictingMeds.length > 0) {
      setAllergyWarning(conflictingMeds.join(' | '));
    } else {
      setAllergyWarning(null);
    }
  }, [medicines, currentPatient]);

  const handleAddMedicine = () => {
    const newMed: MedicineItem = {
      id: `med-${Date.now()}`,
      name: '',
      type: 'Tablet',
      dosage: '500 mg',
      frequency: '1-0-1',
      timing: 'After Food',
      durationDays: 5,
      instructions: '',
    };
    setMedicines([...medicines, newMed]);
  };

  const handleQuickAddMedicine = (item: typeof POPULAR_MEDICINES[0]) => {
    const newMed: MedicineItem = {
      id: `med-${Date.now()}`,
      name: item.name,
      type: item.type as any,
      dosage: item.dosage,
      frequency: item.frequency,
      timing: item.timing as any,
      durationDays: 5,
      instructions: 'Take with water as directed.',
    };
    setMedicines([...medicines, newMed]);
  };

  const handleUpdateMedicine = (index: number, updates: Partial<MedicineItem>) => {
    setMedicines((prev) =>
      prev.map((m, i) => (i === index ? { ...m, ...updates } : m))
    );
  };

  const handleRemoveMedicine = (index: number) => {
    setMedicines((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSavePrescription = (andShareWhatsApp = false) => {
    if (!currentPatient || !currentDoctor) return;

    const newRx = addPrescription({
      patientId: currentPatient.id,
      patientName: currentPatient.name,
      patientAge: currentPatient.age,
      patientGender: currentPatient.gender,
      doctorId: currentDoctor.id,
      doctorName: currentDoctor.name,
      doctorSpecialty: currentDoctor.specialty,
      doctorRegNo: currentDoctor.regNumber,
      vitals,
      symptoms: symptomsInput ? symptomsInput.split(',').map((s) => s.trim()) : [],
      diagnosis,
      clinicalNotes,
      medicines: medicines.filter((m) => m.name.trim().length > 0),
      dietaryAdvice,
      investigationsAdvised: investigationsAdvised ? investigationsAdvised.split(',').map((i) => i.trim()) : [],
      nextFollowUpDate,
    });

    if (andShareWhatsApp) {
      openWhatsAppModal({
        title: `Digital Prescription #${newRx.id}`,
        recipientName: currentPatient.name,
        phone: currentPatient.whatsappNumber || currentPatient.phone,
        message: buildPrescriptionWhatsAppMessage(newRx, clinicSettings),
      });
    } else {
      openPrintModal({
        type: 'prescription',
        data: newRx,
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <Stethoscope className="w-6 h-6 text-emerald-700" />
            <h2 className="text-xl font-bold text-slate-900">
              OPD Consultation & Prescription (Rx) Desk
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Record patient clinical assessment, vitals, diagnosis, and issue digital prescriptions with 1-click WhatsApp dispatch.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleSavePrescription(false)}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 shadow-xs transition-colors"
          >
            <Printer className="w-4 h-4" />
            Save & Print Letterhead
          </button>

          <button
            type="button"
            onClick={() => handleSavePrescription(true)}
            className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 shadow-xs transition-colors"
          >
            <Share2 className="w-4 h-4" />
            Save & Send via WhatsApp
          </button>
        </div>
      </div>

      {/* Allergy Alert Banner if flagged */}
      {allergyWarning && (
        <div className="bg-rose-50 border-2 border-rose-300 p-4 rounded-xl flex items-center gap-3 animate-pulse">
          <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
          <div>
            <h4 className="text-xs font-bold text-rose-900 uppercase tracking-wide">
              Clinical Alert: Potential Drug Allergy Conflict Detected!
            </h4>
            <p className="text-xs text-rose-800 font-medium">
              {allergyWarning}. Please re-verify before saving or dispensing.
            </p>
          </div>
        </div>
      )}

      {/* Patient & Doctor Selection Bar */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
            Attending Patient:
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
                {p.name} ({p.id}) • {p.age}y/{p.gender} • Blood: {p.bloodGroup}
              </option>
            ))}
          </select>

          {/* Patient Details Snapshot */}
          <div className="flex items-center gap-2 mt-2 text-[11px] text-slate-600 flex-wrap">
            <span className="font-semibold">Phone:</span> {currentPatient?.phone}
            {currentPatient?.allergies && currentPatient.allergies.length > 0 && (
              <span className="text-rose-700 font-bold bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                Allergies: {currentPatient.allergies.join(', ')}
              </span>
            )}
            {currentPatient?.chronicConditions && currentPatient.chronicConditions.length > 0 && (
              <span className="text-blue-700 font-medium bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                Chronic: {currentPatient.chronicConditions.join(', ')}
              </span>
            )}
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
            Consulting Doctor:
          </label>
          <select
            value={activeDoctorId}
            onChange={(e) => setActiveDoctorId(e.target.value)}
            className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-bold"
          >
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.specialty}) • {d.roomNumber}
              </option>
            ))}
          </select>

          <p className="text-[11px] text-slate-500 mt-2">
            Qualification: {currentDoctor?.qualification} • Reg: {currentDoctor?.regNumber}
          </p>
        </div>
      </div>

      {/* Vitals Recording Section */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-3">
        <h3 className="font-bold text-xs uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
          <HeartPulse className="w-4 h-4 text-rose-500" />
          Patient Vitals & Anthropometry
        </h3>

        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              BP (Systolic)
            </label>
            <div className="relative">
              <input
                type="number"
                placeholder="120"
                value={vitals.bpSystolic || ''}
                onChange={(e) => setVitals({ ...vitals, bpSystolic: Number(e.target.value) })}
                className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg font-mono font-bold"
              />
              <span className="absolute right-2 top-2 text-[10px] text-slate-400">mmHg</span>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              BP (Diastolic)
            </label>
            <div className="relative">
              <input
                type="number"
                placeholder="80"
                value={vitals.bpDiastolic || ''}
                onChange={(e) => setVitals({ ...vitals, bpDiastolic: Number(e.target.value) })}
                className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg font-mono font-bold"
              />
              <span className="absolute right-2 top-2 text-[10px] text-slate-400">mmHg</span>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              Pulse Rate
            </label>
            <div className="relative">
              <input
                type="number"
                placeholder="72"
                value={vitals.pulse || ''}
                onChange={(e) => setVitals({ ...vitals, pulse: Number(e.target.value) })}
                className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg font-mono"
              />
              <span className="absolute right-2 top-2 text-[10px] text-slate-400">bpm</span>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              SpO2
            </label>
            <div className="relative">
              <input
                type="number"
                placeholder="98"
                value={vitals.spo2 || ''}
                onChange={(e) => setVitals({ ...vitals, spo2: Number(e.target.value) })}
                className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg font-mono"
              />
              <span className="absolute right-2 top-2 text-[10px] text-slate-400">%</span>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              Temperature
            </label>
            <div className="relative">
              <input
                type="number"
                step="0.1"
                placeholder="98.6"
                value={vitals.temperature || ''}
                onChange={(e) => setVitals({ ...vitals, temperature: Number(e.target.value) })}
                className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg font-mono"
              />
              <span className="absolute right-2 top-2 text-[10px] text-slate-400">°F</span>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              Weight
            </label>
            <div className="relative">
              <input
                type="number"
                step="0.5"
                placeholder="68"
                value={vitals.weight || ''}
                onChange={(e) => setVitals({ ...vitals, weight: Number(e.target.value) })}
                className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg font-mono"
              />
              <span className="absolute right-2 top-2 text-[10px] text-slate-400">kg</span>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              Height & BMI
            </label>
            <div className="flex gap-1">
              <input
                type="number"
                placeholder="165"
                value={vitals.height || ''}
                onChange={(e) => setVitals({ ...vitals, height: Number(e.target.value) })}
                className="w-1/2 px-2 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg font-mono"
                title="Height in cm"
              />
              <div className="w-1/2 px-1 py-1.5 text-[11px] bg-emerald-50 border border-emerald-200 rounded-lg font-mono font-bold text-emerald-800 text-center flex items-center justify-center">
                {vitals.bmi || '-'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Clinical Assessment & Diagnosis */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
        <h3 className="font-bold text-xs uppercase tracking-wider text-slate-600">
          Clinical Symptoms & Diagnosis
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Chief Complaints / Symptoms:
            </label>
            <input
              type="text"
              value={symptomsInput}
              onChange={(e) => setSymptomsInput(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-medium"
              placeholder="e.g. Dry cough, low grade fever, malaise"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Provisional / Final Diagnosis <span className="text-emerald-700 font-bold">*</span>:
            </label>
            <input
              type="text"
              value={diagnosis}
              onChange={(e) => setDiagnosis(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-emerald-50/50 border border-emerald-300 rounded-lg text-emerald-950 font-bold"
              placeholder="e.g. Acute Pharyngitis"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Clinical Examination Findings & Doctor's Notes:
            </label>
            <textarea
              rows={2}
              value={clinicalNotes}
              onChange={(e) => setClinicalNotes(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
              placeholder="Systemic examination details..."
            />
          </div>
        </div>
      </div>

      {/* Medicines Prescribed (Rx) */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold font-serif text-emerald-700">℞</span>
            <h3 className="font-bold text-sm text-slate-900">
              Medication Schedule & Dosage
            </h3>
          </div>

          {/* Quick Add Pills */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] text-slate-400 font-medium flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-amber-500" /> Quick Add:
            </span>
            {POPULAR_MEDICINES.slice(0, 4).map((pm) => (
              <button
                key={pm.name}
                type="button"
                onClick={() => handleQuickAddMedicine(pm)}
                className="text-[11px] bg-slate-100 hover:bg-emerald-50 hover:text-emerald-800 text-slate-700 px-2 py-0.5 rounded-md border border-slate-200 transition-colors"
              >
                + {pm.name.split(' ')[0]}
              </button>
            ))}
          </div>
        </div>

        {/* Medicines Table/List */}
        <div className="space-y-3">
          {medicines.map((med, index) => (
            <div
              key={med.id || index}
              className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-3"
            >
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
                {/* Medicine Name */}
                <div className="sm:col-span-4">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">
                    Medicine Name #{index + 1}
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Paracetamol"
                    value={med.name}
                    onChange={(e) => handleUpdateMedicine(index, { name: e.target.value })}
                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg font-semibold text-slate-900"
                  />
                </div>

                {/* Form / Type */}
                <div className="sm:col-span-2">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">
                    Form
                  </label>
                  <select
                    value={med.type}
                    onChange={(e) => handleUpdateMedicine(index, { type: e.target.value as any })}
                    className="w-full px-2 py-1.5 text-xs bg-white border border-slate-300 rounded-lg text-slate-800"
                  >
                    <option value="Tablet">Tablet</option>
                    <option value="Capsule">Capsule</option>
                    <option value="Syrup">Syrup</option>
                    <option value="Injection">Injection</option>
                    <option value="Inhaler">Inhaler</option>
                    <option value="Drops">Drops</option>
                    <option value="Ointment">Ointment</option>
                  </select>
                </div>

                {/* Dosage */}
                <div className="sm:col-span-2">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">
                    Dosage
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 500 mg"
                    value={med.dosage}
                    onChange={(e) => handleUpdateMedicine(index, { dosage: e.target.value })}
                    className="w-full px-2 py-1.5 text-xs bg-white border border-slate-300 rounded-lg text-slate-800"
                  />
                </div>

                {/* Frequency */}
                <div className="sm:col-span-2">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">
                    Frequency
                  </label>
                  <select
                    value={med.frequency}
                    onChange={(e) => handleUpdateMedicine(index, { frequency: e.target.value })}
                    className="w-full px-2 py-1.5 text-xs bg-white border border-slate-300 rounded-lg text-slate-800"
                  >
                    <option value="1-0-1 (Morning & Night)">1-0-1 (Twice Daily)</option>
                    <option value="1-0-0 (Morning)">1-0-0 (Morning)</option>
                    <option value="0-0-1 (Night)">0-0-1 (Night)</option>
                    <option value="1-1-1 (Thrice Daily)">1-1-1 (Thrice Daily)</option>
                    <option value="1-1-1-1 (QID)">1-1-1-1 (Four times)</option>
                    <option value="SOS (As needed)">SOS (As needed)</option>
                    <option value="Once Weekly">Once Weekly</option>
                  </select>
                </div>

                {/* Timing */}
                <div className="sm:col-span-2">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">
                    Timing
                  </label>
                  <select
                    value={med.timing}
                    onChange={(e) => handleUpdateMedicine(index, { timing: e.target.value as any })}
                    className="w-full px-2 py-1.5 text-xs bg-white border border-slate-300 rounded-lg text-slate-800"
                  >
                    <option value="After Food">After Food</option>
                    <option value="Before Food">Before Food</option>
                    <option value="With Food">With Food</option>
                    <option value="Bedtime">Bedtime</option>
                    <option value="Empty Stomach">Empty Stomach</option>
                  </select>
                </div>
              </div>

              {/* Second Row: Duration & Instructions & Remove */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center pt-2 border-t border-slate-200">
                <div className="sm:col-span-3 flex items-center gap-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase shrink-0">
                    Duration:
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={med.durationDays}
                    onChange={(e) => handleUpdateMedicine(index, { durationDays: Number(e.target.value) })}
                    className="w-16 px-2 py-1 text-xs bg-white border border-slate-300 rounded-lg font-mono text-center"
                  />
                  <span className="text-xs text-slate-500">Days</span>
                </div>

                <div className="sm:col-span-8">
                  <input
                    type="text"
                    placeholder="Specific instructions e.g., swallow whole with water, avoid dairy"
                    value={med.instructions || ''}
                    onChange={(e) => handleUpdateMedicine(index, { instructions: e.target.value })}
                    className="w-full px-2.5 py-1 text-xs bg-white border border-slate-300 rounded-lg text-slate-700"
                  />
                </div>

                <div className="sm:col-span-1 text-right">
                  <button
                    type="button"
                    onClick={() => handleRemoveMedicine(index)}
                    className="text-rose-500 hover:text-rose-700 p-1 hover:bg-rose-50 rounded-lg transition-colors"
                    title="Remove medicine"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={handleAddMedicine}
            className="w-full py-2.5 border-2 border-dashed border-emerald-300 hover:border-emerald-500 bg-emerald-50/50 text-emerald-800 text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Another Medication Line
          </button>
        </div>
      </div>

      {/* Advice, Lab Tests & Follow-Up */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Dietary & Lifestyle Advice:
          </label>
          <textarea
            rows={3}
            value={dietaryAdvice}
            onChange={(e) => setDietaryAdvice(e.target.value)}
            className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
            placeholder="Hydration, physical activity, dietary precautions..."
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Advised Lab Investigations:
          </label>
          <textarea
            rows={3}
            value={investigationsAdvised}
            onChange={(e) => setInvestigationsAdvised(e.target.value)}
            className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
            placeholder="e.g. Complete Blood Count (CBC), Urine Routine..."
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Next Follow-Up / Review Date:
          </label>
          <input
            type="date"
            value={nextFollowUpDate}
            onChange={(e) => setNextFollowUpDate(e.target.value)}
            className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-medium mb-3"
          />

          <div className="bg-emerald-50 border border-emerald-200 p-3 rounded-xl text-[11px] text-emerald-900 space-y-1">
            <p className="font-bold flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" /> WhatsApp Ready
            </p>
            <p className="text-emerald-800">
              Prescription will be formatted with doctor signature, medicines table, and clinic helpline.
            </p>
          </div>
        </div>
      </div>

      {/* Historical Prescriptions List */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-3">
        <h3 className="font-bold text-sm text-slate-900">
          Recently Issued Prescriptions
        </h3>

        <div className="divide-y divide-slate-100">
          {prescriptions.map((rx) => (
            <div
              key={rx.id}
              className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-xs text-slate-900">{rx.id}</span>
                  <span className="font-semibold text-xs text-emerald-800">{rx.patientName}</span>
                  <span className="text-[11px] text-slate-400">({rx.date})</span>
                </div>
                <p className="text-xs text-slate-600 mt-0.5">
                  <strong>Dx:</strong> {rx.diagnosis} • <em>Dr: {rx.doctorName}</em>
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => openPrintModal({ type: 'prescription', data: rx })}
                  className="px-2.5 py-1 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg flex items-center gap-1"
                >
                  <Printer className="w-3 h-3" /> View / Print
                </button>

                <button
                  type="button"
                  onClick={() =>
                    openWhatsAppModal({
                      title: `Prescription #${rx.id}`,
                      recipientName: rx.patientName,
                      phone: patients.find(p => p.id === rx.patientId)?.whatsappNumber || '',
                      message: buildPrescriptionWhatsAppMessage(rx, clinicSettings),
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

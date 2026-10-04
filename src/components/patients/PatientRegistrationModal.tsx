import React, { useState } from 'react';
import { UserPlus, X, AlertTriangle, HeartPulse, Phone, Mail, Calendar, MapPin, Check } from 'lucide-react';
import { useClinic } from '../../context/ClinicContext';
import { Patient } from '../../types/clinic';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (patient: Patient) => void;
}

const COMMON_ALLERGIES = ['Penicillin', 'Sulfa Drugs', 'Aspirin', 'NSAIDs', 'Peanuts', 'Latex', 'Iodine Contrast'];
const COMMON_CONDITIONS = ['Type 2 Diabetes', 'Hypertension', 'Bronchial Asthma', 'Hypothyroidism', 'Coronary Artery Disease', 'Chronic Kidney Disease'];

export const PatientRegistrationModal: React.FC<Props> = ({ isOpen, onClose, onSuccess }) => {
  const { addPatient } = useClinic();

  const [formData, setFormData] = useState({
    name: '',
    dob: '1990-01-01',
    age: 36,
    gender: 'Male' as Patient['gender'],
    phone: '',
    whatsappNumber: '',
    email: '',
    bloodGroup: 'B+' as Patient['bloodGroup'],
    address: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    allergies: [] as string[],
    chronicConditions: [] as string[],
  });

  const [allergyInput, setAllergyInput] = useState('');
  const [conditionInput, setConditionInput] = useState('');
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleDobChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const dobVal = e.target.value;
    const birthYear = new Date(dobVal).getFullYear();
    const currentYear = new Date().getFullYear();
    const calculatedAge = Math.max(0, currentYear - birthYear);
    setFormData({
      ...formData,
      dob: dobVal,
      age: calculatedAge,
    });
  };

  const handleToggleAllergy = (allergy: string) => {
    setFormData(prev => ({
      ...prev,
      allergies: prev.allergies.includes(allergy)
        ? prev.allergies.filter(a => a !== allergy)
        : [...prev.allergies, allergy]
    }));
  };

  const handleAddCustomAllergy = () => {
    if (allergyInput.trim() && !formData.allergies.includes(allergyInput.trim())) {
      setFormData(prev => ({ ...prev, allergies: [...prev.allergies, allergyInput.trim()] }));
      setAllergyInput('');
    }
  };

  const handleToggleCondition = (condition: string) => {
    setFormData(prev => ({
      ...prev,
      chronicConditions: prev.chronicConditions.includes(condition)
        ? prev.chronicConditions.filter(c => c !== condition)
        : [...prev.chronicConditions, condition]
    }));
  };

  const handleAddCustomCondition = () => {
    if (conditionInput.trim() && !formData.chronicConditions.includes(conditionInput.trim())) {
      setFormData(prev => ({ ...prev, chronicConditions: [...prev.chronicConditions, conditionInput.trim()] }));
      setConditionInput('');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      setError('Please provide patient full name.');
      return;
    }
    if (!formData.phone.trim()) {
      setError('Please provide contact phone number.');
      return;
    }

    const created = addPatient({
      name: formData.name.trim(),
      dob: formData.dob,
      age: Number(formData.age),
      gender: formData.gender,
      phone: formData.phone.trim(),
      whatsappNumber: formData.whatsappNumber.trim() || formData.phone.trim(),
      email: formData.email.trim() || undefined,
      bloodGroup: formData.bloodGroup,
      address: formData.address.trim() || 'Local Area',
      emergencyContactName: formData.emergencyContactName.trim() || undefined,
      emergencyContactPhone: formData.emergencyContactPhone.trim() || undefined,
      allergies: formData.allergies,
      chronicConditions: formData.chronicConditions,
    });

    if (onSuccess) {
      onSuccess(created);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
      <div 
        id="patient-registration-dialog"
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-2xl w-full my-6 overflow-hidden flex flex-col max-h-[92vh] animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="bg-slate-900 px-6 py-4 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center text-white shadow-inner">
              <UserPlus className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-lg leading-tight">
                New Patient Registration
              </h3>
              <p className="text-xs text-slate-400">
                Hospital Information System (HIS) Intake Form
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto flex-1">
          {error && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs px-4 py-2.5 rounded-lg flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Section 1: Basic Information */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
              Demographics & Personal Details
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Full Name <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Amina Khatun"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 font-medium text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Date of Birth
                </label>
                <div className="relative">
                  <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="date"
                    value={formData.dob}
                    onChange={handleDobChange}
                    className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 text-slate-800"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Age (Years)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="120"
                    value={formData.age}
                    onChange={(e) => setFormData({ ...formData, age: Number(e.target.value) })}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 text-slate-800 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Gender
                  </label>
                  <select
                    value={formData.gender}
                    onChange={(e) => setFormData({ ...formData, gender: e.target.value as any })}
                    className="w-full px-2.5 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 text-slate-800"
                  >
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Blood Group
                </label>
                <select
                  value={formData.bloodGroup}
                  onChange={(e) => setFormData({ ...formData, bloodGroup: e.target.value as any })}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 text-slate-800 font-semibold text-rose-700"
                >
                  <option value="A+">A Positive (A+)</option>
                  <option value="A-">A Negative (A-)</option>
                  <option value="B+">B Positive (B+)</option>
                  <option value="B-">B Negative (B-)</option>
                  <option value="O+">O Positive (O+)</option>
                  <option value="O-">O Negative (O-)</option>
                  <option value="AB+">AB Positive (AB+)</option>
                  <option value="AB-">AB Negative (AB-)</option>
                  <option value="Unknown">Unknown</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Primary Phone <span className="text-rose-600">*</span>
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="tel"
                    required
                    placeholder="+91 98765 43210"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 text-slate-800 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  WhatsApp Number (For prescriptions & bills)
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-emerald-600 absolute left-3 top-2.5" />
                  <input
                    type="tel"
                    placeholder="Leave empty to use primary phone"
                    value={formData.whatsappNumber}
                    onChange={(e) => setFormData({ ...formData, whatsappNumber: e.target.value })}
                    className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 text-slate-800 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Email Address (Optional)
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="email"
                    placeholder="patient@example.com"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 text-slate-800"
                  />
                </div>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Residential Address
                </label>
                <div className="relative">
                  <MapPin className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    placeholder="Flat / House No, Street, Landmark, City"
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 text-slate-800"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Clinical Risk & Allergies */}
          <div className="pt-2 border-t border-slate-200">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-rose-500"></span>
              Allergies & Known Adverse Reactions
            </h4>
            <p className="text-[11px] text-slate-500 mb-2">
              Critical for safety: medicines flagged here will warn prescribing doctors.
            </p>

            <div className="flex flex-wrap gap-1.5 mb-2">
              {COMMON_ALLERGIES.map((allergy) => {
                const isSelected = formData.allergies.includes(allergy);
                return (
                  <button
                    key={allergy}
                    type="button"
                    onClick={() => handleToggleAllergy(allergy)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-all ${
                      isSelected
                        ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    {isSelected ? `✕ ${allergy}` : `+ ${allergy}`}
                  </button>
                );
              })}
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Other specific allergy..."
                value={allergyInput}
                onChange={(e) => setAllergyInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddCustomAllergy(); } }}
                className="text-xs px-3 py-1.5 bg-white border border-slate-300 rounded-lg flex-1 focus:outline-none focus:ring-2 focus:ring-rose-500/20"
              />
              <button
                type="button"
                onClick={handleAddCustomAllergy}
                className="text-xs px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg"
              >
                Add Allergy
              </button>
            </div>
          </div>

          {/* Section 3: Chronic Conditions */}
          <div className="pt-2 border-t border-slate-200">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1.5">
              <HeartPulse className="w-3.5 h-3.5 text-blue-600" />
              Pre-Existing Chronic Conditions
            </h4>

            <div className="flex flex-wrap gap-1.5 mb-2">
              {COMMON_CONDITIONS.map((cond) => {
                const isSelected = formData.chronicConditions.includes(cond);
                return (
                  <button
                    key={cond}
                    type="button"
                    onClick={() => handleToggleCondition(cond)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-all ${
                      isSelected
                        ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    {isSelected ? `✕ ${cond}` : `+ ${cond}`}
                  </button>
                );
              })}
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Other chronic diagnosis..."
                value={conditionInput}
                onChange={(e) => setConditionInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddCustomCondition(); } }}
                className="text-xs px-3 py-1.5 bg-white border border-slate-300 rounded-lg flex-1 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              <button
                type="button"
                onClick={handleAddCustomCondition}
                className="text-xs px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg"
              >
                Add Condition
              </button>
            </div>
          </div>

          {/* Emergency Contact */}
          <div className="pt-2 border-t border-slate-200">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
              Emergency Contact (Optional)
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text"
                placeholder="Relative / Guardian Name (Relationship)"
                value={formData.emergencyContactName}
                onChange={(e) => setFormData({ ...formData, emergencyContactName: e.target.value })}
                className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
              />
              <input
                type="tel"
                placeholder="Emergency Contact Phone"
                value={formData.emergencyContactPhone}
                onChange={(e) => setFormData({ ...formData, emergencyContactPhone: e.target.value })}
                className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg font-mono"
              />
            </div>
          </div>

          {/* Footer actions */}
          <div className="pt-4 border-t border-slate-200 flex items-center justify-between">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
            >
              Cancel
            </button>

            <button
              type="submit"
              className="px-5 py-2.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900 rounded-lg flex items-center gap-2 shadow-sm transition-colors"
            >
              <Check className="w-4 h-4" />
              Register Patient & Generate UHID
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

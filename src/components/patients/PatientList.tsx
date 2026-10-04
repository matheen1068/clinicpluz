import React, { useState, useMemo } from 'react';
import {
  Users,
  Search,
  UserPlus,
  Calendar,
  FileText,
  FlaskConical,
  Receipt,
  Clock,
  AlertTriangle,
  HeartPulse,
  Phone,
  MessageSquare,
  ChevronRight,
  Filter,
} from 'lucide-react';
import { useClinic } from '../../context/ClinicContext';
import { Patient } from '../../types/clinic';
import { PatientRegistrationModal } from './PatientRegistrationModal';
import { createWhatsAppUrl } from '../../utils/whatsapp';

export const PatientList: React.FC = () => {
  const {
    patients,
    setActiveTab,
    setSelectedPatientId,
    openWhatsAppModal,
    clinicSettings,
  } = useClinic();

  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const [filterBloodGroup, setFilterBloodGroup] = useState<string>('ALL');
  const [filterGender, setFilterGender] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredPatients = useMemo(() => {
    return patients.filter((patient) => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        patient.name.toLowerCase().includes(q) ||
        patient.id.toLowerCase().includes(q) ||
        patient.phone.includes(q) ||
        (patient.email && patient.email.toLowerCase().includes(q));

      const matchesBlood =
        filterBloodGroup === 'ALL' || patient.bloodGroup === filterBloodGroup;
      const matchesGender =
        filterGender === 'ALL' || patient.gender === filterGender;

      return matchesSearch && matchesBlood && matchesGender;
    });
  }, [patients, searchQuery, filterBloodGroup, filterGender]);

  const handleAction = (patient: Patient, tab: any) => {
    setSelectedPatientId(patient.id);
    setActiveTab(tab);
  };

  const handleDirectWhatsApp = (patient: Patient) => {
    openWhatsAppModal({
      title: `Message Patient ${patient.name}`,
      recipientName: patient.name,
      phone: patient.whatsappNumber || patient.phone,
      message: `Hello ${patient.name}, greetings from ${clinicSettings.name}! How may our clinical desk assist you today?`,
    });
  };

  return (
    <div className="space-y-6">
      {/* Top Banner and Quick Add */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <Users className="w-6 h-6 text-emerald-700" />
            <h2 className="text-xl font-bold text-slate-900">
              Patient Registry & Demographics
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Total {patients.length} registered patients with electronic medical records (EMR)
          </p>
        </div>

        <button
          onClick={() => setIsRegisterOpen(true)}
          className="bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900 text-white text-xs font-semibold px-4 py-2.5 rounded-xl flex items-center gap-2 shadow-xs transition-colors self-start sm:self-auto"
        >
          <UserPlus className="w-4 h-4" />
          Register New Patient
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
        <div className="md:col-span-6 relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
          <input
            type="text"
            placeholder="Search by UHID, patient name, or phone number..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 text-slate-900"
          />
        </div>

        <div className="md:col-span-3 flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <select
            value={filterBloodGroup}
            onChange={(e) => setFilterBloodGroup(e.target.value)}
            className="w-full px-2.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
          >
            <option value="ALL">All Blood Groups</option>
            <option value="A+">A+</option>
            <option value="A-">A-</option>
            <option value="B+">B+</option>
            <option value="B-">B-</option>
            <option value="O+">O+</option>
            <option value="O-">O-</option>
            <option value="AB+">AB+</option>
            <option value="AB-">AB-</option>
          </select>
        </div>

        <div className="md:col-span-3">
          <select
            value={filterGender}
            onChange={(e) => setFilterGender(e.target.value)}
            className="w-full px-2.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
          >
            <option value="ALL">All Genders</option>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
            <option value="Other">Other</option>
          </select>
        </div>
      </div>

      {/* Patients Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                <th className="py-3.5 px-4">UHID / Patient</th>
                <th className="py-3.5 px-4">Demographics</th>
                <th className="py-3.5 px-4">Contact Info</th>
                <th className="py-3.5 px-4">Clinical Alerts & Chronic Conditions</th>
                <th className="py-3.5 px-4 text-right">Quick Clinical Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredPatients.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-400">
                    No patients match the search criteria.
                  </td>
                </tr>
              ) : (
                filteredPatients.map((patient) => {
                  const hasAllergies = patient.allergies && patient.allergies.length > 0;
                  const hasConditions = patient.chronicConditions && patient.chronicConditions.length > 0;

                  return (
                    <tr key={patient.id} className="hover:bg-slate-50/70 transition-colors">
                      {/* Name & UHID */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-700 font-bold flex items-center justify-center text-xs shrink-0 border border-emerald-100">
                            {patient.name.charAt(0)}
                          </div>
                          <div>
                            <span className="font-bold text-slate-900 block hover:text-emerald-700 cursor-pointer" onClick={() => handleAction(patient, 'history')}>
                              {patient.name}
                            </span>
                            <span className="text-[11px] font-mono text-slate-500">
                              {patient.id}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Demographics */}
                      <td className="py-3.5 px-4">
                        <div className="text-slate-800 font-medium">
                          {patient.age} yrs • {patient.gender}
                        </div>
                        <span className="inline-block mt-0.5 px-2 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-100">
                          Blood: {patient.bloodGroup}
                        </span>
                      </td>

                      {/* Contact */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-1 text-slate-800 font-mono font-medium">
                          <Phone className="w-3 h-3 text-slate-400" />
                          {patient.phone}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate max-w-[180px] mt-0.5">
                          {patient.address}
                        </div>
                      </td>

                      {/* Clinical Alerts */}
                      <td className="py-3.5 px-4">
                        <div className="space-y-1 max-w-xs">
                          {hasAllergies && (
                            <div className="flex items-center gap-1 flex-wrap">
                              <span className="text-[10px] uppercase font-bold text-rose-700 flex items-center gap-0.5">
                                <AlertTriangle className="w-3 h-3" /> Allergy:
                              </span>
                              {patient.allergies.map((all) => (
                                <span
                                  key={all}
                                  className="bg-rose-50 text-rose-700 border border-rose-200 px-1.5 py-0.5 rounded text-[10px] font-semibold"
                                >
                                  {all}
                                </span>
                              ))}
                            </div>
                          )}

                          {hasConditions && (
                            <div className="flex items-center gap-1 flex-wrap">
                              <span className="text-[10px] uppercase font-bold text-blue-700 flex items-center gap-0.5">
                                <HeartPulse className="w-3 h-3" />
                              </span>
                              {patient.chronicConditions.map((cond) => (
                                <span
                                  key={cond}
                                  className="bg-blue-50 text-blue-700 border border-blue-100 px-1.5 py-0.5 rounded text-[10px] font-medium"
                                >
                                  {cond}
                                </span>
                              ))}
                            </div>
                          )}

                          {!hasAllergies && !hasConditions && (
                            <span className="text-[11px] text-slate-400 italic">
                              No known allergies or chronic alerts
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* WhatsApp quick dispatch */}
                          <button
                            title="Direct WhatsApp"
                            onClick={() => handleDirectWhatsApp(patient)}
                            className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors border border-transparent hover:border-emerald-200"
                          >
                            <MessageSquare className="w-4 h-4" />
                          </button>

                          {/* Book Slot */}
                          <button
                            title="Book Appointment Slot"
                            onClick={() => handleAction(patient, 'appointments')}
                            className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-xs flex items-center gap-1 transition-colors"
                          >
                            <Calendar className="w-3.5 h-3.5 text-slate-600" />
                            Slot
                          </button>

                          {/* Write Rx */}
                          <button
                            title="Write Prescription"
                            onClick={() => handleAction(patient, 'prescriptions')}
                            className="px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-semibold rounded-lg text-xs flex items-center gap-1 transition-colors border border-emerald-200"
                          >
                            <FileText className="w-3.5 h-3.5 text-emerald-700" />
                            Rx
                          </button>

                          {/* Lab Report */}
                          <button
                            title="Generate Lab Report"
                            onClick={() => handleAction(patient, 'reports')}
                            className="px-2.5 py-1.5 bg-sky-50 hover:bg-sky-100 text-sky-800 font-semibold rounded-lg text-xs flex items-center gap-1 transition-colors border border-sky-200"
                          >
                            <FlaskConical className="w-3.5 h-3.5 text-sky-700" />
                            Lab
                          </button>

                          {/* Bill */}
                          <button
                            title="Generate Bill"
                            onClick={() => handleAction(patient, 'billing')}
                            className="px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 font-semibold rounded-lg text-xs flex items-center gap-1 transition-colors border border-amber-200"
                          >
                            <Receipt className="w-3.5 h-3.5 text-amber-700" />
                            Bill
                          </button>

                          {/* History 360 */}
                          <button
                            title="View Patient History Dashboard"
                            onClick={() => handleAction(patient, 'history')}
                            className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Registration Modal */}
      <PatientRegistrationModal
        isOpen={isRegisterOpen}
        onClose={() => setIsRegisterOpen(false)}
        onSuccess={(newP) => {
          setSelectedPatientId(newP.id);
        }}
      />
    </div>
  );
};

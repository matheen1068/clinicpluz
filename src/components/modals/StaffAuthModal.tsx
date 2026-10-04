import React, { useState } from 'react';
import {
  ShieldCheck,
  Stethoscope,
  Users,
  FlaskConical,
  Lock,
  Mail,
  User,
  Building,
  Phone,
  CheckCircle2,
  X,
  LogIn,
  UserPlus,
  ArrowRight,
  Shield,
  KeyRound,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { UserRole } from '../../types/clinic';

export const StaffAuthModal: React.FC = () => {
  const {
    currentUser,
    allStaffUsers,
    isAuthModalOpen,
    setIsAuthModalOpen,
    login,
    loginAsUser,
    registerStaff,
  } = useAuth();

  const [activeTab, setActiveTab] = useState<'quick' | 'credentials' | 'register'>('quick');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Register state
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regRole, setRegRole] = useState<UserRole>('Doctor');
  const [regDepartment, setRegDepartment] = useState('');
  const [regPhone, setRegPhone] = useState('');

  if (!isAuthModalOpen) return null;

  const handleCredentialsLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email) {
      setError('Please enter your staff email address');
      return;
    }
    const res = login(email, password);
    if (!res.success) {
      setError(res.error || 'Authentication failed');
    }
  };

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!regName.trim() || !regEmail.trim()) {
      setError('Please complete all required staff fields');
      return;
    }
    registerStaff({
      name: regName.trim(),
      email: regEmail.trim(),
      role: regRole,
      department: regDepartment.trim() || `${regRole} Department`,
      phone: regPhone.trim(),
    });
  };

  const getRoleBadge = (role: UserRole) => {
    switch (role) {
      case 'Admin':
        return {
          bg: 'bg-rose-50 text-rose-700 border-rose-200',
          icon: ShieldCheck,
          label: 'Admin / Director',
        };
      case 'Doctor':
        return {
          bg: 'bg-emerald-50 text-emerald-700 border-emerald-200',
          icon: Stethoscope,
          label: 'Physician / OPD',
        };
      case 'Receptionist':
        return {
          bg: 'bg-sky-50 text-sky-700 border-sky-200',
          icon: Users,
          label: 'Front Desk / Intake',
        };
      case 'LabTechnician':
        return {
          bg: 'bg-amber-50 text-amber-700 border-amber-200',
          icon: FlaskConical,
          label: 'Pathology & Labs',
        };
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl max-w-xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-slate-900 text-white px-6 py-5 flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-inner">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                Staff Authentication & Switcher
              </h2>
              <p className="text-xs text-slate-400">
                Authorized Clinical Terminal • Role-Based Access Control
              </p>
            </div>
          </div>
          {currentUser && (
            <button
              type="button"
              onClick={() => setIsAuthModalOpen(false)}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Tab Selection */}
        <div className="flex border-b border-slate-200 bg-slate-50 text-xs font-semibold px-4 pt-2">
          <button
            type="button"
            onClick={() => {
              setActiveTab('quick');
              setError(null);
            }}
            className={`pb-2.5 px-4 flex items-center gap-2 border-b-2 transition-all ${
              activeTab === 'quick'
                ? 'border-emerald-600 text-emerald-700 font-bold bg-white rounded-t-lg -mb-px'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <LogIn className="w-3.5 h-3.5" />
            Quick Staff Switch
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('credentials');
              setError(null);
            }}
            className={`pb-2.5 px-4 flex items-center gap-2 border-b-2 transition-all ${
              activeTab === 'credentials'
                ? 'border-emerald-600 text-emerald-700 font-bold bg-white rounded-t-lg -mb-px'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" />
            Sign In with Email
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('register');
              setError(null);
            }}
            className={`pb-2.5 px-4 flex items-center gap-2 border-b-2 transition-all ${
              activeTab === 'register'
                ? 'border-emerald-600 text-emerald-700 font-bold bg-white rounded-t-lg -mb-px'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            Add Staff Member
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {error && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs px-4 py-2.5 rounded-xl flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
              <span>{error}</span>
            </div>
          )}

          {/* Quick Staff Switch View */}
          {activeTab === 'quick' && (
            <div className="space-y-3">
              <div className="text-xs text-slate-600 mb-2">
                Click any registered staff profile to activate their credentials and role permissions immediately:
              </div>

              <div className="grid grid-cols-1 gap-2.5">
                {allStaffUsers.map((staff) => {
                  const badge = getRoleBadge(staff.role);
                  const Icon = badge.icon;
                  const isCurrent = currentUser?.id === staff.id;

                  return (
                    <button
                      key={staff.id}
                      type="button"
                      onClick={() => loginAsUser(staff.id)}
                      className={`w-full text-left p-3.5 rounded-xl border transition-all flex items-center justify-between group ${
                        isCurrent
                          ? 'border-emerald-600 bg-emerald-50/50 shadow-xs ring-1 ring-emerald-600'
                          : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {staff.avatarUrl ? (
                          <img
                            src={staff.avatarUrl}
                            alt={staff.name}
                            className="w-11 h-11 rounded-full object-cover border border-slate-200"
                          />
                        ) : (
                          <div className="w-11 h-11 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-sm">
                            {staff.name.charAt(0)}
                          </div>
                        )}

                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-slate-900 group-hover:text-emerald-700 transition-colors">
                              {staff.name}
                            </span>
                            {isCurrent && (
                              <span className="bg-emerald-600 text-white text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1">
                                <CheckCircle2 className="w-2.5 h-2.5" />
                                Active
                              </span>
                            )}
                          </div>

                          <p className="text-[11px] text-slate-500 truncate">{staff.department}</p>
                          <p className="text-[10px] text-slate-400 font-mono">{staff.email}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <span
                          className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg border flex items-center gap-1.5 ${badge.bg}`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                          {badge.label}
                        </span>

                        <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 group-hover:bg-emerald-600 group-hover:text-white transition-all">
                          <ArrowRight className="w-3.5 h-3.5" />
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Email / Password Sign In */}
          {activeTab === 'credentials' && (
            <form onSubmit={handleCredentialsLogin} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-slate-500" />
                  Staff Work Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="e.g. dr.sharma@lifecareclinic.org"
                  className="w-full px-3.5 py-2.5 text-xs bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-slate-500" />
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter staff security PIN or password"
                  className="w-full px-3.5 py-2.5 text-xs bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <p className="text-[11px] text-slate-400">
                  Demo mode: You can log in using any registered staff email address directly.
                </p>
              </div>

              <button
                type="submit"
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center justify-center gap-2"
              >
                <LogIn className="w-4 h-4" />
                Authenticate & Access OPD
              </button>
            </form>
          )}

          {/* Register New Staff Member */}
          {activeTab === 'register' && (
            <form onSubmit={handleRegister} className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-slate-500" />
                    Full Name & Title
                  </label>
                  <input
                    type="text"
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    placeholder="e.g. Dr. Priya Sen, MD"
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-slate-500" />
                    Staff Email
                  </label>
                  <input
                    type="email"
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    placeholder="dr.priya@lifecareclinic.org"
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">Role & Access Level</label>
                  <select
                    value={regRole}
                    onChange={(e) => setRegRole(e.target.value as UserRole)}
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
                  >
                    <option value="Doctor">Doctor (OPD Consultations & Rx)</option>
                    <option value="Receptionist">Receptionist (Intake, Slots & Billing)</option>
                    <option value="LabTechnician">Lab Technician (Diagnostics & Reports)</option>
                    <option value="Admin">Administrator (Full Access & Settings)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <Building className="w-3.5 h-3.5 text-slate-500" />
                    Department / Specialty
                  </label>
                  <input
                    type="text"
                    value={regDepartment}
                    onChange={(e) => setRegDepartment(e.target.value)}
                    placeholder="e.g. Cardiology OPD"
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-slate-500" />
                  Phone Number
                </label>
                <input
                  type="tel"
                  value={regPhone}
                  onChange={(e) => setRegPhone(e.target.value)}
                  placeholder="+91 98450 99887"
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center justify-center gap-2 mt-2"
              >
                <UserPlus className="w-4 h-4" />
                Enroll Staff & Sign In
              </button>
            </form>
          )}

          {/* Security Banner */}
          <div className="bg-slate-50 rounded-xl p-3 border border-slate-200/80 text-[11px] text-slate-600 flex items-start gap-2.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold text-slate-800">Direct OPD Session Storage:</span> Sessions
              are preserved locally on this clinical terminal. Switching staff will dynamically adapt
              active doctor prescriptions, slot bookings, and role authorizations without delay.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

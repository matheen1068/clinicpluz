import React, { useState } from 'react';
import {
  Users,
  Calendar,
  FileText,
  FlaskConical,
  Receipt,
  History,
  Bell,
  Plus,
  Stethoscope,
  Activity,
  Building2,
  Phone,
  Settings as SettingsIcon,
  Search,
  Menu,
  X,
  Share2,
  Printer,
  HeartPulse,
  Shield,
  ShieldCheck,
  Lock,
  LogOut,
  KeyRound,
  UserCheck,
  ArrowRightLeft,
  Layers,
} from 'lucide-react';
import { ClinicProvider, useClinic } from './context/ClinicContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { WhatsAppShareModal } from './components/modals/WhatsAppShareModal';
import { PrintableDocumentModal } from './components/modals/PrintableDocumentModal';
import { PatientRegistrationModal } from './components/patients/PatientRegistrationModal';
import { StaffAuthModal } from './components/modals/StaffAuthModal';
import { ArchitectureDiagramModal } from './components/modals/ArchitectureDiagramModal';

import { PatientList } from './components/patients/PatientList';
import { SlotBooking } from './components/appointments/SlotBooking';
import { PrescriptionWriter } from './components/consultations/PrescriptionWriter';
import { LabReportGenerator } from './components/reports/LabReportGenerator';
import { BillingDesk } from './components/billing/BillingDesk';
import { PatientHistoryDashboard } from './components/history/PatientHistoryDashboard';
import { AutomatedReminderHub } from './components/reminders/AutomatedReminderHub';
import { UserRole } from './types/clinic';

const MainLayout: React.FC = () => {
  const {
    activeTab,
    setActiveTab,
    patients,
    doctors,
    appointments,
    clinicSettings,
    updateClinicSettings,
  } = useClinic();

  const {
    currentUser,
    setIsAuthModalOpen,
    canAccessTab,
    loginAsRole,
    logout,
  } = useAuth();

  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isArchitectureModalOpen, setIsArchitectureModalOpen] = useState(false);

  // Settings local state
  const [tempClinicName, setTempClinicName] = useState(clinicSettings.name);
  const [tempPhone, setTempPhone] = useState(clinicSettings.phone);
  const [tempAddress, setTempAddress] = useState(clinicSettings.address);
  const [tempCurrency, setTempCurrency] = useState(clinicSettings.currencySymbol);

  const pendingRemindersCount = appointments.filter(
    (a) => !a.reminderSent && a.status !== 'Cancelled'
  ).length;

  const todayTokensCount = appointments.filter(
    (a) => a.date === new Date().toISOString().split('T')[0]
  ).length;

  const getRoleBadgeStyle = (role?: UserRole) => {
    switch (role) {
      case 'Admin':
        return 'bg-rose-500/20 text-rose-300 border-rose-500/40';
      case 'Doctor':
        return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
      case 'Receptionist':
        return 'bg-sky-500/20 text-sky-300 border-sky-500/40';
      case 'LabTechnician':
        return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
      default:
        return 'bg-slate-700 text-slate-300 border-slate-600';
    }
  };

  interface NavItem {
    id: 'dashboard' | 'patients' | 'appointments' | 'prescriptions' | 'reports' | 'billing' | 'reminders';
    label: string;
    description: string;
    icon: React.ElementType;
    count?: number;
    alert?: boolean;
    accent?: string;
  }

  const navItems: NavItem[] = [
    {
      id: 'dashboard',
      label: 'Patient History 360',
      description: 'EHR & Timeline',
      icon: History,
      count: patients.length,
    },
    {
      id: 'patients',
      label: 'Patient Intake',
      description: 'Directory & Search',
      icon: Users,
      count: patients.length,
    },
    {
      id: 'appointments',
      label: 'Doctor Slots',
      description: 'Locking & Queue',
      icon: Calendar,
      count: appointments.length,
    },
    {
      id: 'prescriptions',
      label: 'OPD Consultation',
      description: 'Rx & Medications',
      icon: FileText,
      accent: 'emerald',
    },
    {
      id: 'reports',
      label: 'Lab Reports',
      description: 'Diagnostics & Pathology',
      icon: FlaskConical,
      accent: 'sky',
    },
    {
      id: 'billing',
      label: 'Billing Desk',
      description: 'Invoicing & Payments',
      icon: Receipt,
      accent: 'amber',
    },
    {
      id: 'reminders',
      label: 'Automated Reminders',
      description: 'WhatsApp Queue',
      icon: Bell,
      count: pendingRemindersCount > 0 ? pendingRemindersCount : undefined,
      alert: pendingRemindersCount > 0,
    },
  ];

  const handleSaveSettings = () => {
    updateClinicSettings({
      name: tempClinicName,
      phone: tempPhone,
      address: tempAddress,
      currencySymbol: tempCurrency,
    });
    setIsSettingsModalOpen(false);
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans text-slate-800">
      {/* Top Header Bar */}
      <header className="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-30 shadow-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          {/* Clinic Brand & OPD Status */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-md">
              <Building2 className="w-6 h-6" />
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold text-white tracking-tight">
                  {clinicSettings.name}
                </h1>
                <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  OPD Open
                </span>
              </div>
              <p className="text-[11px] text-slate-400 truncate max-w-[200px] sm:max-w-xs">
                {clinicSettings.tagline} • Helpline: {clinicSettings.phone}
              </p>
            </div>
          </div>

          {/* Quick Metrics & Actions */}
          <div className="flex items-center gap-3">
            {/* Quick Metrics Bar on Desktop */}
            <div className="hidden lg:flex items-center gap-2 text-xs">
              <div className="bg-slate-800/80 px-3 py-1.5 rounded-xl border border-slate-700/60 flex items-center gap-2">
                <Users className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-slate-300">Patients:</span>
                <span className="font-bold font-mono text-white">{patients.length}</span>
              </div>

              <div className="bg-slate-800/80 px-3 py-1.5 rounded-xl border border-slate-700/60 flex items-center gap-2">
                <Stethoscope className="w-3.5 h-3.5 text-blue-400" />
                <span className="text-slate-300">Doctors:</span>
                <span className="font-bold font-mono text-white">{doctors.length}</span>
              </div>

              <div className="bg-slate-800/80 px-3 py-1.5 rounded-xl border border-slate-700/60 flex items-center gap-2">
                <Calendar className="w-3.5 h-3.5 text-purple-400" />
                <span className="text-slate-300">Today Tokens:</span>
                <span className="font-bold font-mono text-emerald-400">{todayTokensCount || appointments.length}</span>
              </div>
            </div>

            {/* Quick Patient Intake Button */}
            <button
              type="button"
              onClick={() => setIsRegisterModalOpen(true)}
              className="bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs font-bold px-3 py-1.5 rounded-xl flex items-center gap-1.5 shadow-sm transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">New Intake</span>
              <span className="sm:hidden">Intake</span>
            </button>

            {/* Staff Role / User Profile Trigger */}
            <button
              type="button"
              onClick={() => setIsAuthModalOpen(true)}
              className="flex items-center gap-2 px-2.5 py-1 rounded-xl bg-slate-800/90 hover:bg-slate-700/80 border border-slate-700/80 text-left transition-all group"
              title="Switch active staff duty or sign in"
            >
              {currentUser?.avatarUrl ? (
                <img
                  src={currentUser.avatarUrl}
                  alt={currentUser.name}
                  className="w-7 h-7 rounded-full object-cover border border-slate-600 shrink-0"
                />
              ) : (
                <div className="w-7 h-7 rounded-full bg-emerald-700 text-white flex items-center justify-center text-xs font-bold shrink-0">
                  {currentUser ? currentUser.name.charAt(0) : <Shield className="w-3.5 h-3.5" />}
                </div>
              )}
              <div className="hidden sm:block text-left leading-tight">
                <div className="text-[11px] font-bold text-white max-w-[110px] truncate group-hover:text-emerald-300 transition-colors">
                  {currentUser ? currentUser.name.split(' ')[0] + ' ' + (currentUser.name.split(' ')[1] || '') : 'Staff Login'}
                </div>
                <div className="text-[9px] text-slate-400 flex items-center gap-1">
                  {currentUser ? (
                    <span className={`px-1.5 py-0.2 rounded font-semibold text-[9px] border ${getRoleBadgeStyle(currentUser.role)}`}>
                      {currentUser.role}
                    </span>
                  ) : (
                    <span className="text-emerald-400">Sign In</span>
                  )}
                  <ArrowRightLeft className="w-2.5 h-2.5 text-slate-500" />
                </div>
              </div>
            </button>

            {/* Architecture Diagram Trigger */}
            <button
              type="button"
              onClick={() => setIsArchitectureModalOpen(true)}
              className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700/80 text-emerald-400 hover:text-emerald-300 border border-slate-700/80 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-xs"
              title="System Architecture Diagram & Interactive Blueprint"
            >
              <Layers className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden sm:inline text-slate-200">Architecture</span>
            </button>

            {/* Clinic Settings Trigger */}
            <button
              type="button"
              onClick={() => setIsSettingsModalOpen(true)}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors"
              title="Clinic Profile Settings"
            >
              <SettingsIcon className="w-5 h-5" />
            </button>

            {/* Mobile Menu Toggle */}
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="p-2 text-slate-300 md:hidden hover:bg-slate-800 rounded-xl"
            >
              {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>

        {/* Desktop Navigation Tabs */}
        <div className="hidden md:block bg-slate-950 border-t border-slate-800/80">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <nav className="flex space-x-1 overflow-x-auto py-1.5 scrollbar-none">
              {navItems.map((item) => {
                const isActive = activeTab === item.id;
                const Icon = item.icon;
                const isAllowed = canAccessTab(item.id);

                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveTab(item.id as any)}
                    className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 whitespace-nowrap transition-all ${
                      isActive
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : isAllowed
                        ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                        : 'text-slate-500 hover:text-slate-400 hover:bg-slate-900/60'
                    }`}
                  >
                    <Icon className={`w-4 h-4 ${isActive ? 'text-white' : isAllowed ? 'text-slate-400' : 'text-slate-500'}`} />
                    <span>{item.label}</span>

                    {!isAllowed && (
                      <span title="Restricted for current role">
                        <Lock className="w-3 h-3 text-slate-500" />
                      </span>
                    )}

                    {item.count !== undefined && (
                      <span
                        className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                          isActive
                            ? 'bg-emerald-700 text-white'
                            : item.alert
                            ? 'bg-amber-500 text-slate-950 font-bold'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {item.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>
        </div>

        {/* Mobile Navigation Drawer */}
        {isMobileMenuOpen && (
          <div className="md:hidden bg-slate-950 border-t border-slate-800 px-4 py-3 space-y-2">
            {/* Active Staff Info in Mobile Menu */}
            <div className="bg-slate-900 rounded-xl p-3 border border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                {currentUser?.avatarUrl ? (
                  <img
                    src={currentUser.avatarUrl}
                    alt={currentUser.name}
                    className="w-8 h-8 rounded-full object-cover border border-slate-700"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-emerald-700 text-white flex items-center justify-center text-xs font-bold">
                    {currentUser ? currentUser.name.charAt(0) : <Shield className="w-4 h-4" />}
                  </div>
                )}
                <div>
                  <div className="text-xs font-bold text-white">
                    {currentUser ? currentUser.name : 'Not Authenticated'}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {currentUser ? `${currentUser.role} • ${currentUser.department}` : 'Staff sign-in required'}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setIsAuthModalOpen(true);
                  setIsMobileMenuOpen(false);
                }}
                className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold rounded-lg"
              >
                {currentUser ? 'Switch' : 'Sign In'}
              </button>
            </div>

            <div className="space-y-1 pt-1">
              {navItems.map((item) => {
                const isActive = activeTab === item.id;
                const Icon = item.icon;
                const isAllowed = canAccessTab(item.id);

                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setActiveTab(item.id as any);
                      setIsMobileMenuOpen(false);
                    }}
                    className={`w-full px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between transition-colors ${
                      isActive
                        ? 'bg-emerald-600 text-white'
                        : isAllowed
                        ? 'text-slate-300 hover:bg-slate-900'
                        : 'text-slate-400 hover:bg-slate-900'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Icon className="w-4 h-4" />
                      <span>{item.label}</span>
                      {!isAllowed && <Lock className="w-3 h-3 text-slate-500 ml-1" />}
                    </div>
                    {item.count !== undefined && (
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full ${
                          item.alert
                            ? 'bg-amber-500 text-slate-950 font-bold'
                            : 'bg-slate-800 text-slate-300'
                        }`}
                      >
                        {item.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </header>

      {/* Main Clinical Body */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {!currentUser ? (
          /* Staff Login Required Screen */
          <div className="max-w-xl mx-auto my-12 bg-white rounded-2xl p-8 border border-slate-200 shadow-xl text-center space-y-6">
            <div className="w-16 h-16 bg-emerald-50 text-emerald-700 rounded-2xl mx-auto flex items-center justify-center shadow-inner border border-emerald-100">
              <ShieldCheck className="w-8 h-8" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900">Hospital & Clinic Staff Terminal</h2>
              <p className="text-xs text-slate-500 mt-1.5 max-w-md mx-auto">
                Please authenticate with your clinic staff credentials or select a clinical duty profile below to access OPD records and patient workflows.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
              <button
                type="button"
                onClick={() => loginAsRole('Admin')}
                className="p-3.5 rounded-xl border border-slate-200 hover:border-rose-400 hover:bg-rose-50/40 transition-all flex items-center gap-3 group"
              >
                <div className="w-10 h-10 rounded-lg bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
                  <Shield className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-900 group-hover:text-rose-700">Administrator</div>
                  <div className="text-[11px] text-slate-500">Full Clinic Oversight & Billing</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => loginAsRole('Doctor')}
                className="p-3.5 rounded-xl border border-slate-200 hover:border-emerald-500 hover:bg-emerald-50/40 transition-all flex items-center gap-3 group"
              >
                <div className="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                  <Stethoscope className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-900 group-hover:text-emerald-700">OPD Physician</div>
                  <div className="text-[11px] text-slate-500">Rx Writing & Patient History</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => loginAsRole('Receptionist')}
                className="p-3.5 rounded-xl border border-slate-200 hover:border-sky-500 hover:bg-sky-50/40 transition-all flex items-center gap-3 group"
              >
                <div className="w-10 h-10 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center shrink-0">
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-900 group-hover:text-sky-700">Front Desk Staff</div>
                  <div className="text-[11px] text-slate-500">Intake, Queue & Reminders</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => loginAsRole('LabTechnician')}
                className="p-3.5 rounded-xl border border-slate-200 hover:border-amber-500 hover:bg-amber-50/40 transition-all flex items-center gap-3 group"
              >
                <div className="w-10 h-10 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                  <FlaskConical className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-900 group-hover:text-amber-700">Pathology Lab Tech</div>
                  <div className="text-[11px] text-slate-500">Lab Diagnostic Reports</div>
                </div>
              </button>
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={() => setIsAuthModalOpen(true)}
                className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 underline underline-offset-4"
              >
                Sign in with custom staff email or register new member →
              </button>
            </div>
          </div>
        ) : !canAccessTab(activeTab) ? (
          /* Role Restricted Boundary Notice */
          <div className="max-w-xl mx-auto my-12 bg-white rounded-2xl p-8 border border-slate-200 shadow-xl text-center space-y-4">
            <div className="w-14 h-14 bg-amber-50 text-amber-600 rounded-2xl mx-auto flex items-center justify-center border border-amber-200/60">
              <Lock className="w-7 h-7" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">Restricted Clinical Section</h3>
              <p className="text-xs text-slate-500 mt-1.5 max-w-md mx-auto">
                The <span className="font-bold text-slate-800 capitalize">{activeTab}</span> module is not authorized for your current role (<span className="font-bold text-slate-800">{currentUser.role}</span>).
                You are currently signed in as <span className="font-bold text-slate-800">{currentUser.name}</span>.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setIsAuthModalOpen(true)}
                className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs transition-colors flex items-center gap-2"
              >
                <ArrowRightLeft className="w-3.5 h-3.5" />
                Switch Staff Profile
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('dashboard')}
                className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors"
              >
                Return to Patient History 360
              </button>
            </div>
          </div>
        ) : (
          <>
            {activeTab === 'dashboard' && <PatientHistoryDashboard />}
            {activeTab === 'patients' && <PatientList />}
            {activeTab === 'appointments' && <SlotBooking />}
            {activeTab === 'prescriptions' && <PrescriptionWriter />}
            {activeTab === 'reports' && <LabReportGenerator />}
            {activeTab === 'billing' && <BillingDesk />}
            {activeTab === 'reminders' && <AutomatedReminderHub />}
          </>
        )}
      </main>

      {/* Footer Strip */}
      <footer className="bg-white border-t border-slate-200 py-4 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-800">{clinicSettings.name}</span>
            <span>• Built for Small Clinics & Hospitals OPD Automation</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIsArchitectureModalOpen(true)}
              className="flex items-center gap-1 text-emerald-700 hover:text-emerald-800 font-semibold transition-colors"
            >
              <Layers className="w-3.5 h-3.5 text-emerald-600" /> System Architecture
            </button>
            <span>•</span>
            <span className="flex items-center gap-1">
              <Share2 className="w-3 h-3 text-emerald-600" /> WhatsApp Integrated
            </span>
            <span>•</span>
            <span className="flex items-center gap-1">
              <Printer className="w-3 h-3 text-slate-600" /> Printable Formats
            </span>
          </div>
        </div>
      </footer>

      {/* Global Modals */}
      <PatientRegistrationModal
        isOpen={isRegisterModalOpen}
        onClose={() => setIsRegisterModalOpen(false)}
      />
      <StaffAuthModal />
      <ArchitectureDiagramModal
        isOpen={isArchitectureModalOpen}
        onClose={() => setIsArchitectureModalOpen(false)}
      />
      <WhatsAppShareModal />
      <PrintableDocumentModal />

      {/* Clinic Settings Modal */}
      {isSettingsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                <SettingsIcon className="w-5 h-5 text-emerald-700" />
                Clinic & Hospital Configuration
              </h3>
              <button
                onClick={() => setIsSettingsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {currentUser?.role !== 'Admin' && (
              <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs p-3 rounded-xl flex items-start gap-2">
                <Shield className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold">Admin Privileges Recommended:</span> You are currently signed in as {currentUser?.name} ({currentUser?.role}). Only Administrator role can persist organizational settings.
                </div>
              </div>
            )}

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Clinic / Hospital Name:
                </label>
                <input
                  type="text"
                  value={tempClinicName}
                  onChange={(e) => setTempClinicName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 font-bold"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Helpline / WhatsApp Number:
                </label>
                <input
                  type="text"
                  value={tempPhone}
                  onChange={(e) => setTempPhone(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono text-slate-800"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Clinic Address:
                </label>
                <input
                  type="text"
                  value={tempAddress}
                  onChange={(e) => setTempAddress(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-800"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Currency Symbol:
                </label>
                <input
                  type="text"
                  value={tempCurrency}
                  onChange={(e) => setTempCurrency(e.target.value)}
                  className="w-20 px-3 py-2 border border-slate-300 rounded-lg font-mono text-center font-bold"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsSettingsModalOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveSettings}
                className="px-4 py-2 text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg shadow-xs"
              >
                Save Clinic Details
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <ClinicProvider>
        <MainLayout />
      </ClinicProvider>
    </AuthProvider>
  );
}

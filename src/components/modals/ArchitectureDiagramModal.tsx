import React, { useState } from 'react';
import {
  X,
  Download,
  ExternalLink,
  Layers,
  Cpu,
  Database,
  Share2,
  Printer,
  Shield,
  Stethoscope,
  Users,
  FlaskConical,
  Receipt,
  Calendar,
  FileText,
  Bell,
  Activity,
  CheckCircle2,
  ArrowRight,
  Maximize2,
  Sparkles,
  Lock,
} from 'lucide-react';
import architectureDiagramImg from '../../assets/images/clinic_architecture_diagram_1789832242888.jpg';
import { useClinic } from '../../context/ClinicContext';
import { useAuth } from '../../context/AuthContext';

interface ArchitectureDiagramModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ArchitectureDiagramModal: React.FC<ArchitectureDiagramModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'animated' | 'blueprint'>('animated');
  const [selectedNode, setSelectedNode] = useState<string>('auth-context');
  const [isZoomed, setIsZoomed] = useState(false);

  const { patients, doctors, appointments, prescriptions, labReports, invoices } = useClinic();
  const { currentUser, allStaffUsers } = useAuth();

  if (!isOpen) return null;

  const handleDownloadImage = () => {
    const link = document.createElement('a');
    link.href = architectureDiagramImg;
    link.download = 'ClinicPulse-Architecture-Diagram.jpg';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const nodeDetails: Record<
    string,
    {
      title: string;
      tier: string;
      role: string;
      responsibilities: string[];
      stateData: string;
      connections: string[];
    }
  > = {
    'staff-roles': {
      title: 'Staff Roles & Presentation Tier',
      tier: 'Presentation Layer (UI / UX)',
      role: 'Role-Based Clinical Gateway',
      responsibilities: [
        'Doctor: OPD consultations, Rx formulations & active doctor ID sync',
        'Receptionist: Patient intake, appointment booking, token locking & reminders',
        'Lab Tech: Diagnostics testing, pathology parameter grading & abnormal flagging',
        'Administrator: Overall clinic management, staff roles, billing & clinic configuration',
      ],
      stateData: `${allStaffUsers.length} Registered Staff Profiles, Active: ${currentUser?.name || 'Guest'} (${currentUser?.role || 'None'})`,
      connections: ['AuthContext', 'ClinicContext', 'RBAC Guard'],
    },
    'auth-context': {
      title: 'AuthContext & RBAC Access Guard',
      tier: 'Security & Session Bus',
      role: 'Credential Verification & Route Boundary',
      responsibilities: [
        'Manages client-side authenticated session in cp_auth_session_v1',
        'Enforces canAccessTab() permissions across all 7 functional areas',
        'Provides instant clinical duty switching with pre-configured staff profiles',
        'Zero backend leaks: client-side secure role tokens',
      ],
      stateData: `Session Token: cp_auth_session_v1 (Role: ${currentUser?.role || 'Unassigned'})`,
      connections: ['Staff Portals', 'ClinicContext', 'LocalStorage'],
    },
    'clinic-context': {
      title: 'ClinicContext Reactive State Bus',
      tier: 'Business Logic Core',
      role: 'Single Source of Clinical Truth',
      responsibilities: [
        'Reactive in-memory state tracking for Patients, Appointments, Prescriptions, Lab Reports, Invoices',
        'Handles token generation & real-time slot conflict locking',
        'Coordinates automated WhatsApp payload dispatching',
        'Provides printable document formatting state',
      ],
      stateData: `EHR Records: ${patients.length} Patients, ${doctors.length} Doctors, ${appointments.length} Slots Locked`,
      connections: ['AuthContext', 'Clinical Micro-Modules', 'LocalStorage', 'WhatsApp Dispatcher'],
    },
    'ehr-module': {
      title: 'Patient Intake & EHR 360',
      tier: 'Clinical Domain Micro-Module',
      role: 'Longitudinal Patient History',
      responsibilities: [
        'Registration with demographic, blood group, chronic conditions, and emergency contacts',
        'Patient 360 timeline merging visits, prescriptions, lab reports, and billing history',
        'Unique Patient ID indexing (e.g. PAT-1001)',
      ],
      stateData: `${patients.length} Live Patient Files with active timeline history`,
      connections: ['ClinicContext', 'Prescription Engine', 'Slot Booking', 'Billing Desk'],
    },
    'appointments-module': {
      title: 'Appointment Slots & Doctor Locking',
      tier: 'Clinical Domain Micro-Module',
      role: 'Queue & Doctor Scheduling',
      responsibilities: [
        'Real-time token generation for daily outpatient queues',
        'Slot locking to prevent double-booking across physician schedules',
        'Lifecycle state tracking: Scheduled -> In-Consultation -> Completed -> Cancelled',
      ],
      stateData: `${appointments.length} Appointments scheduled across ${doctors.length} OPD clinics`,
      connections: ['ClinicContext', 'Patient Intake', 'Automated Reminders', 'Billing Desk'],
    },
    'rx-module': {
      title: 'OPD Consultation & Rx Engine',
      tier: 'Clinical Domain Micro-Module',
      role: 'Prescription & Medical Regimen Builder',
      responsibilities: [
        'Vitals recording (BP, Pulse, Weight, Temp, SpO2) and Chief Complaints',
        'Multi-drug regimen with dosage, frequency (1-0-1), timing, and duration',
        'Doctor digital sign-off and clinical advice generation',
        '1-Click WhatsApp sharing and printable prescription format',
      ],
      stateData: `${prescriptions.length} Prescriptions issued and archived`,
      connections: ['ClinicContext', 'Doctor Profile', 'WhatsApp Engine', 'Printable Layouts'],
    },
    'lab-module': {
      title: 'Pathology Diagnostics & Lab Reports',
      tier: 'Clinical Domain Micro-Module',
      role: 'Diagnostic Testing & Abnormal Flagging',
      responsibilities: [
        'CBC, Lipid Panel, Blood Sugar, Thyroid, Kidney & Liver panels',
        'Automatic calculation and abnormal indicator flags (High/Low vs Reference)',
        'Technician interpretation and pathology signature line',
        'WhatsApp lab report dispatching and printable laboratory documents',
      ],
      stateData: `${labReports.length} Diagnostics & Pathology investigations logged`,
      connections: ['ClinicContext', 'Patient Intake', 'WhatsApp Engine', 'Print Engine'],
    },
    'billing-module': {
      title: 'Billing & Accounts Desk',
      tier: 'Financial Domain Micro-Module',
      role: 'Invoicing, OPD Fees & Receipts',
      responsibilities: [
        'Consultation fees, laboratory tests, medicines, and procedure fee calculation',
        'Automatic tax percentage, itemized subtotals, and custom discounts',
        'Payment status tracking: Paid, Partial, Pending',
        'WhatsApp digital invoice delivery and printable tax receipt generation',
      ],
      stateData: `${invoices.length} Invoices generated`,
      connections: ['ClinicContext', 'Patient Intake', 'Print Engine', 'WhatsApp Engine'],
    },
    'integration-storage': {
      title: 'Persistence & Communication Gateway',
      tier: 'Infrastructure & Integration Layer',
      role: 'I/O, Messaging & Durable Local Persistence',
      responsibilities: [
        'LocalStorage Engine: Synchronous cache & durable JSON storage across reloads',
        'WhatsApp Web URI Gateway: Direct message dispatching with URL-encoded clinical reports',
        'Print & PDF Engine: CSS @media print layout rendering for clean physical documents',
      ],
      stateData: 'LocalStorage Keys: cp_patients_v1, cp_appointments_v1, cp_prescriptions_v1, cp_reports_v1, cp_invoices_v1',
      connections: ['ClinicContext', 'All Modules', 'Browser I/O'],
    },
  };

  const selected = nodeDetails[selectedNode] || nodeDetails['clinic-context'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/80 backdrop-blur-md">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-6xl max-h-[95vh] flex flex-col shadow-2xl overflow-hidden text-slate-100">
        {/* Modal Top Navigation Bar */}
        <div className="px-5 py-3.5 border-b border-slate-800 bg-slate-900/90 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm sm:text-base font-bold text-white">
                  ClinicPulse Web App Architecture
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                  <Activity className="w-2.5 h-2.5 animate-pulse text-emerald-400" />
                  Live Reactive Diagram
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Interactive component hierarchy, security tiers, state management & I/O pipelines
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* View Switcher Tabs */}
            <div className="bg-slate-800/80 p-1 rounded-xl border border-slate-700/80 flex items-center text-xs">
              <button
                onClick={() => setActiveTab('animated')}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-all flex items-center gap-1.5 ${
                  activeTab === 'animated'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Cpu className="w-3.5 h-3.5" />
                <span>Interactive Animated Flow</span>
              </button>
              <button
                onClick={() => setActiveTab('blueprint')}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-all flex items-center gap-1.5 ${
                  activeTab === 'blueprint'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Blueprint Image (PNG/JPG)</span>
              </button>
            </div>

            {/* Download Image Button */}
            <button
              onClick={handleDownloadImage}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white text-xs font-semibold rounded-xl border border-slate-700 flex items-center gap-1.5 transition-colors"
              title="Download Architecture Diagram Image"
            >
              <Download className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden sm:inline">Save Image</span>
            </button>

            {/* Close Button */}
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body Area */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {activeTab === 'animated' ? (
            /* ANIMATED INTERACTIVE SYSTEM PIPELINE */
            <div className="space-y-6">
              {/* Architecture Tiers Canvas */}
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                {/* Tier 1: Client & Presentation */}
                <div
                  onClick={() => setSelectedNode('staff-roles')}
                  className={`cursor-pointer rounded-2xl p-4 border transition-all ${
                    selectedNode === 'staff-roles'
                      ? 'bg-slate-800/90 border-emerald-500 ring-2 ring-emerald-500/20'
                      : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                      Tier 1: Client & Roles
                    </span>
                    <Users className="w-4 h-4 text-emerald-400" />
                  </div>
                  <h3 className="text-sm font-bold text-white mb-1">Staff Presentation</h3>
                  <p className="text-[11px] text-slate-400 mb-3">
                    Multi-role clinical workspaces for hospital staff
                  </p>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-950/60 text-xs border border-slate-800/80">
                      <Stethoscope className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span className="text-slate-300 font-medium">OPD Doctor Station</span>
                    </div>
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-950/60 text-xs border border-slate-800/80">
                      <Users className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                      <span className="text-slate-300 font-medium">Reception & Intake Desk</span>
                    </div>
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-950/60 text-xs border border-slate-800/80">
                      <FlaskConical className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <span className="text-slate-300 font-medium">Pathology Lab Tech</span>
                    </div>
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-950/60 text-xs border border-slate-800/80">
                      <Shield className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                      <span className="text-slate-300 font-medium">Admin & Settings</span>
                    </div>
                  </div>
                </div>

                {/* Tier 2: Security & State Bus */}
                <div
                  onClick={() => setSelectedNode('auth-context')}
                  className={`cursor-pointer rounded-2xl p-4 border transition-all ${
                    selectedNode === 'auth-context' || selectedNode === 'clinic-context'
                      ? 'bg-slate-800/90 border-cyan-500 ring-2 ring-cyan-500/20'
                      : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded-full border border-cyan-500/20">
                      Tier 2: React State Bus
                    </span>
                    <Cpu className="w-4 h-4 text-cyan-400" />
                  </div>
                  <h3 className="text-sm font-bold text-white mb-1">Context & Security</h3>
                  <p className="text-[11px] text-slate-400 mb-3">
                    Centralized reactive state engine & RBAC barriers
                  </p>
                  <div className="space-y-1.5">
                    <div className="p-2 rounded-lg bg-slate-950/60 text-xs border border-cyan-900/40">
                      <div className="flex items-center justify-between font-semibold text-cyan-300 mb-0.5">
                        <span className="flex items-center gap-1.5">
                          <Shield className="w-3 h-3 text-cyan-400" />
                          AuthContext
                        </span>
                        <span className="text-[9px] bg-cyan-950 px-1.5 py-0.2 rounded text-cyan-400 border border-cyan-800">
                          RBAC
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400">
                        canAccessTab() verification
                      </div>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-950/60 text-xs border border-emerald-900/40">
                      <div className="flex items-center justify-between font-semibold text-emerald-300 mb-0.5">
                        <span className="flex items-center gap-1.5">
                          <Activity className="w-3 h-3 text-emerald-400" />
                          ClinicContext
                        </span>
                        <span className="text-[9px] bg-emerald-950 px-1.5 py-0.2 rounded text-emerald-400 border border-emerald-800">
                          State
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400">
                        Tokens, slots, Rx, bills & labs
                      </div>
                    </div>
                  </div>
                </div>

                {/* Tier 3: Core Clinical Engines */}
                <div
                  onClick={() => setSelectedNode('ehr-module')}
                  className={`cursor-pointer rounded-2xl p-4 border transition-all ${
                    [
                      'ehr-module',
                      'appointments-module',
                      'rx-module',
                      'lab-module',
                      'billing-module',
                    ].includes(selectedNode)
                      ? 'bg-slate-800/90 border-violet-500 ring-2 ring-violet-500/20'
                      : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-violet-400 bg-violet-500/10 px-2 py-0.5 rounded-full border border-violet-500/20">
                      Tier 3: Clinical Engines
                    </span>
                    <Activity className="w-4 h-4 text-violet-400" />
                  </div>
                  <h3 className="text-sm font-bold text-white mb-1">Micro-Modules</h3>
                  <p className="text-[11px] text-slate-400 mb-3">
                    OPD business logic & clinical workflows
                  </p>
                  <div className="grid grid-cols-2 gap-1 text-[11px]">
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedNode('ehr-module');
                      }}
                      className="p-1.5 rounded bg-slate-950/60 text-slate-300 border border-slate-800 hover:border-violet-400 transition-colors truncate"
                    >
                      1. Patient EHR 360
                    </div>
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedNode('appointments-module');
                      }}
                      className="p-1.5 rounded bg-slate-950/60 text-slate-300 border border-slate-800 hover:border-violet-400 transition-colors truncate"
                    >
                      2. Slot Locking
                    </div>
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedNode('rx-module');
                      }}
                      className="p-1.5 rounded bg-slate-950/60 text-slate-300 border border-slate-800 hover:border-violet-400 transition-colors truncate"
                    >
                      3. Rx Generator
                    </div>
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedNode('lab-module');
                      }}
                      className="p-1.5 rounded bg-slate-950/60 text-slate-300 border border-slate-800 hover:border-violet-400 transition-colors truncate"
                    >
                      4. Lab Reports
                    </div>
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedNode('billing-module');
                      }}
                      className="p-1.5 rounded bg-slate-950/60 text-slate-300 border border-slate-800 hover:border-violet-400 transition-colors truncate col-span-2"
                    >
                      5. Billing Desk & Invoicing
                    </div>
                  </div>
                </div>

                {/* Tier 4: I/O & Persistence */}
                <div
                  onClick={() => setSelectedNode('integration-storage')}
                  className={`cursor-pointer rounded-2xl p-4 border transition-all ${
                    selectedNode === 'integration-storage'
                      ? 'bg-slate-800/90 border-amber-500 ring-2 ring-amber-500/20'
                      : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
                      Tier 4: I/O & Storage
                    </span>
                    <Database className="w-4 h-4 text-amber-400" />
                  </div>
                  <h3 className="text-sm font-bold text-white mb-1">I/O & Persistence</h3>
                  <p className="text-[11px] text-slate-400 mb-3">
                    Messaging, document print & local DB
                  </p>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-950/60 text-xs border border-emerald-900/40">
                      <Share2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <div className="leading-tight">
                        <div className="text-slate-200 font-medium">WhatsApp API</div>
                        <div className="text-[10px] text-slate-400">Direct URI Dispatch</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-950/60 text-xs border border-slate-800">
                      <Printer className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                      <div className="leading-tight">
                        <div className="text-slate-200 font-medium">Print & PDF Engine</div>
                        <div className="text-[10px] text-slate-400">CSS @media print</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-950/60 text-xs border border-amber-900/40">
                      <Database className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <div className="leading-tight">
                        <div className="text-slate-200 font-medium">LocalStorage Cache</div>
                        <div className="text-[10px] text-slate-400">Durable JSON Store</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Animated SVG Data Flow Pipeline */}
              <div className="bg-slate-950/80 rounded-2xl p-4 border border-slate-800">
                <div className="flex items-center justify-between mb-3 text-xs">
                  <div className="flex items-center gap-2 font-bold text-slate-300">
                    <Sparkles className="w-4 h-4 text-emerald-400" />
                    <span>Reactive Data Stream Pipeline</span>
                  </div>
                  <div className="flex items-center gap-4 text-[11px] text-slate-400 font-mono">
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
                      Active Influx: OPD Visits
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
                      Lock Engine: Synchronized
                    </span>
                  </div>
                </div>

                <div className="relative overflow-x-auto py-2">
                  <svg className="w-full min-w-[700px] h-20" viewBox="0 0 800 80">
                    <defs>
                      <linearGradient id="gradFlow" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#10b981" />
                        <stop offset="33%" stopColor="#06b6d4" />
                        <stop offset="66%" stopColor="#8b5cf6" />
                        <stop offset="100%" stopColor="#f59e0b" />
                      </linearGradient>
                    </defs>

                    {/* Background track line */}
                    <path
                      d="M 60 40 L 740 40"
                      stroke="#1e293b"
                      strokeWidth="6"
                      strokeLinecap="round"
                    />

                    {/* Animated moving pulse flow line */}
                    <path
                      d="M 60 40 L 740 40"
                      stroke="url(#gradFlow)"
                      strokeWidth="4"
                      strokeLinecap="round"
                      className="animate-flow-dash"
                    />

                    {/* Node 1: Staff Input */}
                    <circle cx="80" cy="40" r="14" fill="#0f172a" stroke="#10b981" strokeWidth="3" />
                    <text x="80" y="44" textAnchor="middle" fill="#10b981" fontSize="10" fontWeight="bold">UI</text>
                    <text x="80" y="68" textAnchor="middle" fill="#94a3b8" fontSize="10">Staff Action</text>

                    {/* Node 2: Auth Check */}
                    <circle cx="280" cy="40" r="14" fill="#0f172a" stroke="#06b6d4" strokeWidth="3" />
                    <text x="280" y="44" textAnchor="middle" fill="#06b6d4" fontSize="10" fontWeight="bold">SEC</text>
                    <text x="280" y="68" textAnchor="middle" fill="#94a3b8" fontSize="10">RBAC Guard</text>

                    {/* Node 3: Clinical Logic */}
                    <circle cx="500" cy="40" r="14" fill="#0f172a" stroke="#8b5cf6" strokeWidth="3" />
                    <text x="500" y="44" textAnchor="middle" fill="#8b5cf6" fontSize="10" fontWeight="bold">OPD</text>
                    <text x="500" y="68" textAnchor="middle" fill="#94a3b8" fontSize="10">Clinical Core</text>

                    {/* Node 4: Persistence */}
                    <circle cx="720" cy="40" r="14" fill="#0f172a" stroke="#f59e0b" strokeWidth="3" />
                    <text x="720" y="44" textAnchor="middle" fill="#f59e0b" fontSize="10" fontWeight="bold">I/O</text>
                    <text x="720" y="68" textAnchor="middle" fill="#94a3b8" fontSize="10">Local & WA</text>
                  </svg>
                </div>
              </div>

              {/* Selected Node Inspector Card */}
              <div className="bg-slate-800/80 rounded-2xl p-5 border border-slate-700/80 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-700">
                  <div>
                    <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">
                      {selected.tier}
                    </span>
                    <h4 className="text-base font-bold text-white flex items-center gap-2 mt-0.5">
                      {selected.title}
                      <span className="text-xs font-normal text-slate-400">({selected.role})</span>
                    </h4>
                  </div>
                  <div className="text-xs font-mono bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-700/60 text-emerald-400">
                    {selected.stateData}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div>
                    <h5 className="font-bold text-slate-300 mb-2 flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      Core Architectural Responsibilities:
                    </h5>
                    <ul className="space-y-1.5 text-slate-400">
                      {selected.responsibilities.map((r, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="text-emerald-500 font-bold">•</span>
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <h5 className="font-bold text-slate-300 mb-2 flex items-center gap-1.5">
                      <ArrowRight className="w-3.5 h-3.5 text-cyan-400" />
                      Inter-Module Data Contracts:
                    </h5>
                    <div className="flex flex-wrap gap-1.5">
                      {selected.connections.map((c, i) => (
                        <span
                          key={i}
                          className="px-2.5 py-1 rounded-lg bg-slate-900 text-slate-300 border border-slate-700 text-[11px] font-mono"
                        >
                          ↔ {c}
                        </span>
                      ))}
                    </div>
                    <p className="text-[11px] text-slate-500 mt-3">
                      Click any tier card above to inspect that architectural layer's live parameters and data flow patterns.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* BLUEPRINT HIGH-RES IMAGE VIEW */
            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>
                  High-Resolution System Architecture Diagram (16:9 Aspect Ratio)
                </span>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setIsZoomed(!isZoomed)}
                    className="flex items-center gap-1 text-slate-300 hover:text-white"
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                    <span>{isZoomed ? 'Reset Fit' : 'Expand Image'}</span>
                  </button>
                  <button
                    onClick={handleDownloadImage}
                    className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 font-semibold"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download Image</span>
                  </button>
                </div>
              </div>

              <div
                className={`rounded-2xl border border-slate-800 overflow-hidden bg-slate-950 flex items-center justify-center transition-all ${
                  isZoomed ? 'p-0 max-h-[80vh] overflow-auto' : 'p-2 max-h-[600px]'
                }`}
              >
                <img
                  src={architectureDiagramImg}
                  alt="ClinicPulse Web App Architecture Diagram"
                  referrerPolicy="no-referrer"
                  className={`w-full object-contain rounded-xl shadow-2xl transition-all ${
                    isZoomed ? 'min-w-[1200px]' : 'max-h-[560px]'
                  }`}
                />
              </div>

              <div className="p-4 rounded-xl bg-slate-800/60 border border-slate-700/60 text-xs text-slate-300 flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>
                    Clean, non-stretched architectural blueprint illustrating UI, RBAC Security, Clinical Micro-Modules & Persistence I/O.
                  </span>
                </div>
                <button
                  onClick={handleDownloadImage}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-xs transition-colors flex items-center gap-1.5 shrink-0"
                >
                  <Download className="w-4 h-4" />
                  Save Image File
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-slate-800 bg-slate-900/90 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-300">ClinicPulse Architecture</span>
            <span>• Single-page React 18 + Vite + Tailwind CSS + Context State</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownloadImage}
              className="text-emerald-400 hover:underline flex items-center gap-1"
            >
              <Download className="w-3 h-3" />
              Download Diagram Asset
            </button>
            <span>•</span>
            <button
              onClick={onClose}
              className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

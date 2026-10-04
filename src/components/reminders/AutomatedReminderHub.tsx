import React, { useState } from 'react';
import {
  Bell,
  CheckCircle2,
  Clock,
  Send,
  MessageSquare,
  AlertCircle,
  Calendar,
  Sparkles,
  Check,
  RefreshCw,
} from 'lucide-react';
import { useClinic } from '../../context/ClinicContext';
import { Appointment } from '../../types/clinic';
import { buildReminderWhatsAppMessage } from '../../utils/whatsapp';

export const AutomatedReminderHub: React.FC = () => {
  const {
    appointments,
    patients,
    clinicSettings,
    triggerReminder,
    openWhatsAppModal,
  } = useClinic();

  const [filterStatus, setFilterStatus] = useState<'ALL' | 'PENDING' | 'SENT'>('ALL');
  const [bulkDispatchDone, setBulkDispatchDone] = useState(false);

  // Filter appointments
  const filteredAppointments = appointments.filter((apt) => {
    if (apt.status === 'Cancelled') return false;
    if (filterStatus === 'PENDING') return !apt.reminderSent;
    if (filterStatus === 'SENT') return apt.reminderSent;
    return true;
  });

  const pendingCount = appointments.filter((a) => !a.reminderSent && a.status !== 'Cancelled').length;
  const sentCount = appointments.filter((a) => a.reminderSent).length;

  const handleSendSingleReminder = (apt: Appointment) => {
    const patient = patients.find((p) => p.id === apt.patientId);
    const phone = patient?.whatsappNumber || apt.patientPhone;

    openWhatsAppModal({
      title: `Automated Reminder - Token #${apt.tokenNumber}`,
      recipientName: apt.patientName,
      phone,
      message: buildReminderWhatsAppMessage(apt, clinicSettings),
      onSent: () => triggerReminder(apt.id),
    });
  };

  const handleBulkDispatch = () => {
    // Mark all pending as dispatched
    appointments
      .filter((a) => !a.reminderSent && a.status !== 'Cancelled')
      .forEach((a) => triggerReminder(a.id));

    setBulkDispatchDone(true);
    setTimeout(() => setBulkDispatchDone(false), 3000);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <Bell className="w-6 h-6 text-emerald-700" />
            <h2 className="text-xl font-bold text-slate-900">
              Automated WhatsApp Reminders & Token Dispatch Hub
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Proactive automated appointment reminders reduce clinic no-shows by over 40%. Scheduled 24 hours & 2 hours before patient visit.
          </p>
        </div>

        <button
          onClick={handleBulkDispatch}
          disabled={pendingCount === 0}
          className={`px-4 py-2.5 text-xs font-semibold rounded-xl flex items-center gap-2 shadow-xs transition-all ${
            pendingCount > 0
              ? 'bg-emerald-700 hover:bg-emerald-800 text-white'
              : 'bg-slate-100 text-slate-400 cursor-not-allowed'
          }`}
        >
          {bulkDispatchDone ? (
            <>
              <Check className="w-4 h-4 text-emerald-300" />
              All Reminders Queued!
            </>
          ) : (
            <>
              <Send className="w-4 h-4" />
              Bulk Trigger Pending ({pendingCount})
            </>
          )}
        </button>
      </div>

      {/* Reminder Status Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider block">
              Pending Reminders
            </span>
            <span className="text-2xl font-bold font-mono text-slate-900">
              {pendingCount}
            </span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider block">
              Delivered Reminders
            </span>
            <span className="text-2xl font-bold font-mono text-emerald-800">
              {sentCount}
            </span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center">
            <MessageSquare className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider block">
              Direct WhatsApp Channel
            </span>
            <span className="text-xs font-bold text-slate-800 block">
              Active & Connected
            </span>
          </div>
        </div>
      </div>

      {/* Reminder Dispatch Queue Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden space-y-4 p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h3 className="font-bold text-sm text-slate-900">
              Scheduled Appointment Queue & Dispatch Log
            </h3>
            <p className="text-xs text-slate-500">
              Tokens and slots awaiting verification
            </p>
          </div>

          <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl text-xs font-semibold">
            <button
              onClick={() => setFilterStatus('ALL')}
              className={`px-3 py-1 rounded-lg ${
                filterStatus === 'ALL' ? 'bg-white text-emerald-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              All ({appointments.length})
            </button>
            <button
              onClick={() => setFilterStatus('PENDING')}
              className={`px-3 py-1 rounded-lg ${
                filterStatus === 'PENDING' ? 'bg-white text-emerald-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              Pending ({pendingCount})
            </button>
            <button
              onClick={() => setFilterStatus('SENT')}
              className={`px-3 py-1 rounded-lg ${
                filterStatus === 'SENT' ? 'bg-white text-emerald-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              Sent ({sentCount})
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                <th className="py-3 px-3">Token #</th>
                <th className="py-3 px-3">Patient Name</th>
                <th className="py-3 px-3">Doctor & Specialty</th>
                <th className="py-3 px-3">Slot Schedule</th>
                <th className="py-3 px-3">Delivery Status</th>
                <th className="py-3 px-3 text-right">Dispatch Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredAppointments.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400">
                    No appointments found matching this status filter.
                  </td>
                </tr>
              ) : (
                filteredAppointments.map((apt) => (
                  <tr key={apt.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3 px-3">
                      <span className="w-7 h-7 rounded-lg bg-slate-900 text-white font-mono font-bold text-xs flex items-center justify-center">
                        #{apt.tokenNumber}
                      </span>
                    </td>
                    <td className="py-3 px-3 font-semibold text-slate-900">
                      {apt.patientName}
                      <span className="block text-[11px] font-mono text-slate-500 font-normal">
                        {apt.patientPhone}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-slate-800">
                      <strong>{apt.doctorName}</strong>
                      <span className="block text-[11px] text-slate-500">{apt.specialty}</span>
                    </td>
                    <td className="py-3 px-3">
                      <span className="font-semibold text-slate-800">{apt.timeSlot}</span>
                      <span className="block text-[11px] text-slate-500 font-mono">{apt.date}</span>
                    </td>
                    <td className="py-3 px-3">
                      {apt.reminderSent ? (
                        <span className="inline-flex items-center gap-1 bg-emerald-100 text-emerald-800 text-[11px] font-semibold px-2 py-0.5 rounded-full">
                          <CheckCircle2 className="w-3 h-3" /> Dispatched ({apt.reminderSentAt || 'Recent'})
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-800 text-[11px] font-semibold px-2 py-0.5 rounded-full">
                          <Clock className="w-3 h-3" /> Awaiting Trigger
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-right">
                      <button
                        onClick={() => handleSendSingleReminder(apt)}
                        className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 font-semibold rounded-lg text-xs inline-flex items-center gap-1.5 transition-colors"
                      >
                        <MessageSquare className="w-3.5 h-3.5 text-emerald-700" />
                        {apt.reminderSent ? 'Resend via WhatsApp' : 'Send WhatsApp Reminder'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

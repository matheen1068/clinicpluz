import React, { useState, useMemo } from 'react';
import {
  History,
  User,
  Calendar,
  FileText,
  FlaskConical,
  Receipt,
  HeartPulse,
  AlertTriangle,
  Phone,
  Mail,
  MapPin,
  Share2,
  Printer,
  ChevronDown,
  ChevronUp,
  Plus,
  ArrowUpRight,
  Clock,
  CheckCircle2,
} from 'lucide-react';
import { useClinic } from '../../context/ClinicContext';
import {
  buildPrescriptionWhatsAppMessage,
  buildLabReportWhatsAppMessage,
  buildInvoiceWhatsAppMessage,
} from '../../utils/whatsapp';

export const PatientHistoryDashboard: React.FC = () => {
  const {
    patients,
    selectedPatientId,
    setSelectedPatientId,
    appointments,
    prescriptions,
    labReports,
    invoices,
    setActiveTab,
    openWhatsAppModal,
    openPrintModal,
    clinicSettings,
  } = useClinic();

  const [activePatientId, setActivePatientId] = useState<string>(
    selectedPatientId || (patients[0]?.id || '')
  );

  const [timelineFilter, setTimelineFilter] = useState<'ALL' | 'RX' | 'LAB' | 'BILL' | 'APT'>('ALL');
  const [expandedRecordId, setExpandedRecordId] = useState<string | null>(null);

  const currentPatient = patients.find((p) => p.id === activePatientId) || patients[0];

  // Patient-specific records
  const patientAppointments = useMemo(() => {
    return appointments.filter((a) => a.patientId === currentPatient?.id);
  }, [appointments, currentPatient]);

  const patientPrescriptions = useMemo(() => {
    return prescriptions.filter((r) => r.patientId === currentPatient?.id);
  }, [prescriptions, currentPatient]);

  const patientLabReports = useMemo(() => {
    return labReports.filter((l) => l.patientId === currentPatient?.id);
  }, [labReports, currentPatient]);

  const patientInvoices = useMemo(() => {
    return invoices.filter((i) => i.patientId === currentPatient?.id);
  }, [invoices, currentPatient]);

  // Unified Chronological Timeline
  const unifiedTimeline = useMemo(() => {
    const events: Array<{
      id: string;
      date: string;
      type: 'prescription' | 'report' | 'invoice' | 'appointment';
      title: string;
      subtitle: string;
      badge: string;
      badgeColor: string;
      raw: any;
    }> = [];

    patientPrescriptions.forEach((rx) => {
      events.push({
        id: rx.id,
        date: rx.date,
        type: 'prescription',
        title: `Prescription: ${rx.diagnosis}`,
        subtitle: `Dr. ${rx.doctorName} • ${rx.medicines.length} Medicines Prescribed`,
        badge: '℞ Clinical Rx',
        badgeColor: 'bg-emerald-100 text-emerald-800 border-emerald-200',
        raw: rx,
      });
    });

    patientLabReports.forEach((rep) => {
      events.push({
        id: rep.id,
        date: rep.reportDate,
        type: 'report',
        title: `Lab Report: ${rep.testTitle}`,
        subtitle: `${rep.items.length} Parameters • Ref by ${rep.doctorName}`,
        badge: rep.category,
        badgeColor: 'bg-sky-100 text-sky-800 border-sky-200',
        raw: rep,
      });
    });

    patientInvoices.forEach((inv) => {
      events.push({
        id: inv.id,
        date: inv.date,
        type: 'invoice',
        title: `Official Invoice #${inv.id}`,
        subtitle: `Amount: ${clinicSettings.currencySymbol}${inv.grandTotal.toFixed(2)} • Status: ${inv.paymentStatus}`,
        badge: inv.paymentStatus === 'Paid' ? 'Paid' : 'Due',
        badgeColor: inv.paymentStatus === 'Paid' ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : 'bg-rose-100 text-rose-800 border-rose-200',
        raw: inv,
      });
    });

    patientAppointments.forEach((apt) => {
      events.push({
        id: apt.id,
        date: apt.date,
        type: 'appointment',
        title: `OPD Consultation: Token #${apt.tokenNumber}`,
        subtitle: `${apt.doctorName} (${apt.specialty}) • ${apt.timeSlot}`,
        badge: apt.status,
        badgeColor: 'bg-purple-100 text-purple-800 border-purple-200',
        raw: apt,
      });
    });

    // Sort descending by date
    events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    if (timelineFilter === 'ALL') return events;
    if (timelineFilter === 'RX') return events.filter((e) => e.type === 'prescription');
    if (timelineFilter === 'LAB') return events.filter((e) => e.type === 'report');
    if (timelineFilter === 'BILL') return events.filter((e) => e.type === 'invoice');
    if (timelineFilter === 'APT') return events.filter((e) => e.type === 'appointment');
    return events;
  }, [
    patientPrescriptions,
    patientLabReports,
    patientInvoices,
    patientAppointments,
    timelineFilter,
    clinicSettings,
  ]);

  // Total Lifetime Spent
  const totalBilled = patientInvoices.reduce((acc, inv) => acc + inv.grandTotal, 0);
  const totalBalanceDue = patientInvoices.reduce((acc, inv) => acc + inv.balanceDue, 0);

  const handleShareWhatsApp = (item: any) => {
    if (item.type === 'prescription') {
      openWhatsAppModal({
        title: `Prescription #${item.raw.id}`,
        recipientName: currentPatient.name,
        phone: currentPatient.whatsappNumber || currentPatient.phone,
        message: buildPrescriptionWhatsAppMessage(item.raw, clinicSettings),
      });
    } else if (item.type === 'report') {
      openWhatsAppModal({
        title: `Lab Report #${item.raw.id}`,
        recipientName: currentPatient.name,
        phone: currentPatient.whatsappNumber || currentPatient.phone,
        message: buildLabReportWhatsAppMessage(item.raw, clinicSettings),
      });
    } else if (item.type === 'invoice') {
      openWhatsAppModal({
        title: `Invoice #${item.raw.id}`,
        recipientName: currentPatient.name,
        phone: currentPatient.whatsappNumber || currentPatient.phone,
        message: buildInvoiceWhatsAppMessage(item.raw, clinicSettings),
      });
    }
  };

  const handlePrint = (item: any) => {
    openPrintModal({
      type: item.type,
      data: item.raw,
    });
  };

  return (
    <div className="space-y-6">
      {/* Patient Selector Bar */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <History className="w-6 h-6 text-emerald-700" />
            <h2 className="text-xl font-bold text-slate-900">
              Patient 360 Medical History Dashboard
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Complete longitudinal electronic health record (EHR) aggregating encounters, prescriptions, diagnostic results, and invoices.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs font-bold text-slate-600 uppercase shrink-0">
            Select Patient:
          </label>
          <select
            value={activePatientId}
            onChange={(e) => {
              setActivePatientId(e.target.value);
              setSelectedPatientId(e.target.value);
            }}
            className="px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-xl text-slate-900 font-bold"
          >
            {patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.id}) • {p.age}y/{p.gender}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Patient Profile Card (360 Degree View) */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-emerald-700 text-white font-bold text-xl flex items-center justify-center shadow-inner">
              {currentPatient.name.charAt(0)}
            </div>

            <div>
              <div className="flex items-center gap-2.5">
                <h3 className="text-lg font-bold text-slate-950">
                  {currentPatient.name}
                </h3>
                <span className="font-mono text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded font-semibold">
                  {currentPatient.id}
                </span>
                <span className="text-xs font-bold px-2 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200">
                  Blood: {currentPatient.bloodGroup}
                </span>
              </div>

              <div className="flex items-center gap-4 text-xs text-slate-600 mt-1 flex-wrap">
                <span>{currentPatient.age} years old • {currentPatient.gender}</span>
                <span className="flex items-center gap-1 font-mono">
                  <Phone className="w-3 h-3 text-slate-400" /> {currentPatient.phone}
                </span>
                {currentPatient.email && (
                  <span className="flex items-center gap-1">
                    <Mail className="w-3 h-3 text-slate-400" /> {currentPatient.email}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <MapPin className="w-3 h-3 text-slate-400" /> {currentPatient.address}
                </span>
              </div>
            </div>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => {
                setSelectedPatientId(currentPatient.id);
                setActiveTab('appointments');
              }}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold rounded-lg flex items-center gap-1 transition-colors"
            >
              <Calendar className="w-3.5 h-3.5 text-slate-600" /> Book Slot
            </button>

            <button
              onClick={() => {
                setSelectedPatientId(currentPatient.id);
                setActiveTab('prescriptions');
              }}
              className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold rounded-lg flex items-center gap-1 transition-colors shadow-xs"
            >
              <FileText className="w-3.5 h-3.5" /> New Rx
            </button>

            <button
              onClick={() => {
                setSelectedPatientId(currentPatient.id);
                setActiveTab('reports');
              }}
              className="px-3 py-1.5 bg-sky-700 hover:bg-sky-800 text-white text-xs font-semibold rounded-lg flex items-center gap-1 transition-colors shadow-xs"
            >
              <FlaskConical className="w-3.5 h-3.5" /> Lab Test
            </button>

            <button
              onClick={() => {
                setSelectedPatientId(currentPatient.id);
                setActiveTab('billing');
              }}
              className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1 transition-colors shadow-xs"
            >
              <Receipt className="w-3.5 h-3.5" /> Create Bill
            </button>
          </div>
        </div>

        {/* Clinical Alerts Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-xs font-bold text-rose-900 uppercase tracking-wide">
                Documented Allergies
              </h4>
              <p className="text-xs text-rose-800 mt-0.5 font-medium">
                {currentPatient.allergies && currentPatient.allergies.length > 0
                  ? currentPatient.allergies.join(', ')
                  : 'No known drug or environmental allergies recorded.'}
              </p>
            </div>
          </div>

          <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl flex items-start gap-2.5">
            <HeartPulse className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-xs font-bold text-blue-900 uppercase tracking-wide">
                Pre-existing Chronic Conditions
              </h4>
              <p className="text-xs text-blue-800 mt-0.5 font-medium">
                {currentPatient.chronicConditions && currentPatient.chronicConditions.length > 0
                  ? currentPatient.chronicConditions.join(', ')
                  : 'No chronic cardiovascular or metabolic diseases on file.'}
              </p>
            </div>
          </div>
        </div>

        {/* Lifetime Clinical Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
          <div className="bg-slate-50 border border-slate-200 p-3 rounded-xl">
            <span className="text-slate-400 text-[11px] block font-medium">Total Appointments</span>
            <span className="text-xl font-bold font-mono text-slate-900">{patientAppointments.length}</span>
          </div>

          <div className="bg-slate-50 border border-slate-200 p-3 rounded-xl">
            <span className="text-slate-400 text-[11px] block font-medium">Prescriptions (Rx)</span>
            <span className="text-xl font-bold font-mono text-emerald-800">{patientPrescriptions.length}</span>
          </div>

          <div className="bg-slate-50 border border-slate-200 p-3 rounded-xl">
            <span className="text-slate-400 text-[11px] block font-medium">Diagnostic Lab Reports</span>
            <span className="text-xl font-bold font-mono text-sky-800">{patientLabReports.length}</span>
          </div>

          <div className="bg-slate-50 border border-slate-200 p-3 rounded-xl">
            <span className="text-slate-400 text-[11px] block font-medium">Lifetime Billed / Due</span>
            <span className="text-xl font-bold font-mono text-slate-900">
              {clinicSettings.currencySymbol}{totalBilled.toFixed(0)}
              {totalBalanceDue > 0 && (
                <span className="text-xs text-rose-600 ml-1 font-semibold">
                  (Due: {clinicSettings.currencySymbol}{totalBalanceDue.toFixed(0)})
                </span>
              )}
            </span>
          </div>
        </div>
      </div>

      {/* Chronological Medical Timeline */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
              <Clock className="w-4 h-4 text-emerald-700" />
              Chronological Patient Medical Timeline
            </h3>
            <p className="text-xs text-slate-500">
              Unified encounter stream in reverse chronological order
            </p>
          </div>

          {/* Timeline Filter Pills */}
          <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl text-xs font-semibold">
            {(['ALL', 'RX', 'LAB', 'BILL', 'APT'] as const).map((filterKey) => (
              <button
                key={filterKey}
                onClick={() => setTimelineFilter(filterKey)}
                className={`px-3 py-1 rounded-lg transition-colors ${
                  timelineFilter === filterKey
                    ? 'bg-white text-emerald-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {filterKey === 'ALL' && 'All Records'}
                {filterKey === 'RX' && 'Prescriptions'}
                {filterKey === 'LAB' && 'Lab Reports'}
                {filterKey === 'BILL' && 'Billing'}
                {filterKey === 'APT' && 'Appointments'}
              </button>
            ))}
          </div>
        </div>

        {/* Timeline Event Feed */}
        <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-slate-200">
          {unifiedTimeline.length === 0 ? (
            <div className="text-center py-10 text-xs text-slate-400">
              No historical clinical records found for this patient under this filter.
            </div>
          ) : (
            unifiedTimeline.map((event) => {
              const isExpanded = expandedRecordId === event.id;

              return (
                <div key={event.id} className="relative group">
                  {/* Timeline Dot Indicator */}
                  <div className="absolute -left-6 top-1.5 w-5 h-5 rounded-full bg-white border-2 border-emerald-600 flex items-center justify-center">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>
                  </div>

                  <div className="bg-slate-50 hover:bg-slate-100/80 border border-slate-200 rounded-xl p-4 transition-all">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-xs text-slate-900">
                            {event.title}
                          </span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${event.badgeColor}`}>
                            {event.badge}
                          </span>
                          <span className="text-[11px] font-mono text-slate-500">
                            {event.date}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 mt-1">
                          {event.subtitle}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 self-end sm:self-center">
                        {event.type !== 'appointment' && (
                          <>
                            <button
                              onClick={() => handlePrint(event)}
                              className="px-2.5 py-1 bg-white hover:bg-slate-200 border border-slate-200 text-slate-700 text-xs font-semibold rounded-lg flex items-center gap-1 transition-colors"
                            >
                              <Printer className="w-3 h-3" /> View & Print
                            </button>

                            <button
                              onClick={() => handleShareWhatsApp(event)}
                              className="px-2.5 py-1 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold rounded-lg flex items-center gap-1 transition-colors"
                            >
                              <Share2 className="w-3 h-3" /> WhatsApp
                            </button>
                          </>
                        )}

                        <button
                          onClick={() => setExpandedRecordId(isExpanded ? null : event.id)}
                          className="p-1 text-slate-400 hover:text-slate-700"
                        >
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    {/* Expandable Details Tray */}
                    {isExpanded && (
                      <div className="mt-3 pt-3 border-t border-slate-200 text-xs space-y-2 animate-in fade-in">
                        {event.type === 'prescription' && (
                          <div>
                            <h5 className="font-bold text-slate-700 mb-1">Medication Regimen:</h5>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {event.raw.medicines.map((m: any, i: number) => (
                                <div key={i} className="p-2 bg-white rounded border border-slate-200">
                                  <strong>{m.name}</strong> ({m.dosage}) - {m.frequency} • {m.timing}
                                </div>
                              ))}
                            </div>
                            {event.raw.dietaryAdvice && (
                              <p className="mt-2 text-slate-600 italic">Advice: {event.raw.dietaryAdvice}</p>
                            )}
                          </div>
                        )}

                        {event.type === 'report' && (
                          <div>
                            <h5 className="font-bold text-slate-700 mb-1">Key Results:</h5>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                              {event.raw.items.map((it: any, i: number) => (
                                <div key={i} className="p-2 bg-white rounded border border-slate-200">
                                  <span className="text-slate-500 block text-[10px]">{it.testName}</span>
                                  <strong className={it.status !== 'Normal' ? 'text-rose-700' : 'text-slate-900'}>
                                    {it.resultValue} {it.unit}
                                  </strong>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {event.type === 'invoice' && (
                          <div>
                            <h5 className="font-bold text-slate-700 mb-1">Billed Items:</h5>
                            <ul className="list-disc list-inside space-y-0.5 text-slate-700">
                              {event.raw.items.map((it: any, i: number) => (
                                <li key={i}>{it.description} ({clinicSettings.currencySymbol}{it.total})</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

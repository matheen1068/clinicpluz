import React, { useState, useMemo } from 'react';
import {
  Calendar as CalendarIcon,
  Clock,
  Lock,
  Unlock,
  CheckCircle2,
  AlertCircle,
  Share2,
  User,
  Plus,
  Bell,
  Stethoscope,
  ChevronRight,
  Filter,
  Check,
  XCircle,
} from 'lucide-react';
import { useClinic } from '../../context/ClinicContext';
import { Doctor, Appointment, Patient } from '../../types/clinic';
import {
  buildAppointmentWhatsAppMessage,
  buildReminderWhatsAppMessage,
} from '../../utils/whatsapp';

export const SlotBooking: React.FC = () => {
  const {
    doctors,
    patients,
    appointments,
    clinicSettings,
    bookAppointment,
    toggleSlotLock,
    updateAppointmentStatus,
    cancelAppointment,
    triggerReminder,
    openWhatsAppModal,
    selectedPatientId,
    setSelectedPatientId,
    setActiveTab,
  } = useClinic();

  const todayStr = new Date().toISOString().split('T')[0];
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>(doctors[0]?.id || '');
  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
  const [targetSlotToBook, setTargetSlotToBook] = useState<string>('');

  // Selected doctor details
  const currentDoctor = useMemo(() => {
    return doctors.find((d) => d.id === selectedDoctorId) || doctors[0];
  }, [doctors, selectedDoctorId]);

  // Appointments on selected date for the selected doctor
  const doctorAppointmentsOnDate = useMemo(() => {
    return appointments.filter(
      (a) => a.doctorId === currentDoctor?.id && a.date === selectedDate
    );
  }, [appointments, currentDoctor, selectedDate]);

  // Form state for booking
  const [bookingForm, setBookingForm] = useState({
    patientId: selectedPatientId || (patients[0]?.id || ''),
    type: 'First Visit' as Appointment['type'],
    symptomsBrief: '',
    lockImmediately: true,
  });

  // Calculate slot statuses
  const allDoctorSlots = currentDoctor?.availableTimeSlots || [
    '09:00 AM', '09:30 AM', '10:00 AM', '10:30 AM', '11:00 AM', '11:30 AM',
    '04:00 PM', '04:30 PM', '05:00 PM', '05:30 PM', '06:00 PM', '06:30 PM'
  ];

  const handleOpenBookSlot = (timeSlot: string) => {
    setTargetSlotToBook(timeSlot);
    setBookingForm((prev) => ({
      ...prev,
      patientId: selectedPatientId || (patients[0]?.id || ''),
    }));
    setIsBookingModalOpen(true);
  };

  const handleConfirmBooking = (e: React.FormEvent) => {
    e.preventDefault();
    const patient = patients.find((p) => p.id === bookingForm.patientId);
    if (!patient || !currentDoctor) return;

    const newApt = bookAppointment({
      patientId: patient.id,
      patientName: patient.name,
      patientPhone: patient.phone,
      doctorId: currentDoctor.id,
      doctorName: currentDoctor.name,
      specialty: currentDoctor.specialty,
      date: selectedDate,
      timeSlot: targetSlotToBook,
      type: bookingForm.type,
      symptomsBrief: bookingForm.symptomsBrief,
      isLocked: bookingForm.lockImmediately,
    });

    setIsBookingModalOpen(false);

    // Prompt WhatsApp Confirmation
    openWhatsAppModal({
      title: `Token #${newApt.tokenNumber} Confirmation`,
      recipientName: patient.name,
      phone: patient.whatsappNumber || patient.phone,
      message: buildAppointmentWhatsAppMessage(newApt, clinicSettings),
      onSent: () => triggerReminder(newApt.id),
    });
  };

  const handleSendReminder = (apt: Appointment) => {
    const patient = patients.find((p) => p.id === apt.patientId);
    const phone = patient?.whatsappNumber || apt.patientPhone;

    openWhatsAppModal({
      title: `Automated Reminder (Token #${apt.tokenNumber})`,
      recipientName: apt.patientName,
      phone: phone,
      message: buildReminderWhatsAppMessage(apt, clinicSettings),
      onSent: () => triggerReminder(apt.id),
    });
  };

  return (
    <div className="space-y-6">
      {/* Top Controls: Doctor Assignment & Date Selection */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <CalendarIcon className="w-6 h-6 text-emerald-700" />
              <h2 className="text-xl font-bold text-slate-900">
                Doctor Assignment & Slot Locking Desk
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Select attending specialist, lock appointment slots to prevent double bookings, and issue OPD tokens.
            </p>
          </div>

          {/* Quick Date Bar */}
          <div className="flex items-center gap-2 bg-slate-100 p-1.5 rounded-xl self-start">
            <button
              onClick={() => setSelectedDate(todayStr)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                selectedDate === todayStr
                  ? 'bg-white text-emerald-800 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Today
            </button>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="text-xs px-2.5 py-1 bg-white border border-slate-300 rounded-lg text-slate-800 font-medium focus:outline-none focus:ring-1 focus:ring-emerald-600"
            />
          </div>
        </div>

        {/* Doctor Assignment Ribbon */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
            Assign / Select Attending Doctor:
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {doctors.map((doc) => {
              const isSelected = doc.id === currentDoctor?.id;
              return (
                <div
                  key={doc.id}
                  onClick={() => setSelectedDoctorId(doc.id)}
                  className={`p-3 rounded-xl border cursor-pointer transition-all ${
                    isSelected
                      ? 'border-emerald-600 bg-emerald-50/60 shadow-xs ring-2 ring-emerald-500/20'
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-2.5 mb-1.5">
                    <img
                      src={doc.avatarUrl}
                      alt={doc.name}
                      className="w-9 h-9 rounded-full object-cover ring-1 ring-slate-200"
                    />
                    <div className="overflow-hidden">
                      <h4 className="font-bold text-xs text-slate-900 truncate leading-tight">
                        {doc.name}
                      </h4>
                      <p className="text-[11px] text-slate-500 truncate">
                        {doc.roomNumber}
                      </p>
                    </div>
                  </div>

                  <p className="text-[11px] font-medium text-emerald-800 truncate mb-1">
                    {doc.specialty}
                  </p>

                  <div className="flex items-center justify-between text-[10px] pt-1.5 border-t border-slate-200/70">
                    <span className="font-semibold text-slate-700">
                      Fee: {clinicSettings.currencySymbol}{doc.consultationFee}
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded font-medium ${
                        doc.status === 'Available'
                          ? 'bg-emerald-100 text-emerald-800'
                          : doc.status === 'In Consultation'
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {doc.status}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Doctor OPD Details & Slot Booking Matrix */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Interactive Slot Booking Grid (8 cols) */}
        <div className="lg:col-span-8 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                <Clock className="w-4 h-4 text-emerald-700" />
                Appointment Slots for {selectedDate}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {currentDoctor?.name} ({currentDoctor?.roomNumber})
              </p>
            </div>

            {/* Legend */}
            <div className="flex items-center gap-3 text-[11px]">
              <span className="flex items-center gap-1 text-slate-600">
                <span className="w-3 h-3 rounded bg-emerald-50 border border-emerald-400"></span> Available
              </span>
              <span className="flex items-center gap-1 text-slate-600">
                <span className="w-3 h-3 rounded bg-slate-100 border border-slate-400"></span> Booked / Locked
              </span>
              <span className="flex items-center gap-1 text-slate-600">
                <Lock className="w-3 h-3 text-amber-600" /> Slot Locked
              </span>
            </div>
          </div>

          {/* Grid of Slots */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {allDoctorSlots.map((slot) => {
              const bookedAppointment = doctorAppointmentsOnDate.find(
                (a) => a.timeSlot === slot && a.status !== 'Cancelled'
              );

              if (bookedAppointment) {
                const isLocked = bookedAppointment.isLocked;
                return (
                  <div
                    key={slot}
                    className={`p-3 rounded-xl border relative transition-all ${
                      isLocked
                        ? 'border-slate-300 bg-slate-50/90'
                        : 'border-blue-200 bg-blue-50/40'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-mono font-bold text-xs text-slate-800">
                        {slot}
                      </span>
                      <button
                        title={isLocked ? 'Unlock slot' : 'Lock slot'}
                        onClick={() => toggleSlotLock(bookedAppointment.id)}
                        className="text-slate-500 hover:text-slate-800 p-0.5"
                      >
                        {isLocked ? (
                          <Lock className="w-3.5 h-3.5 text-amber-600" />
                        ) : (
                          <Unlock className="w-3.5 h-3.5 text-slate-400" />
                        )}
                      </button>
                    </div>

                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1 font-semibold text-xs text-slate-900 truncate">
                        <User className="w-3 h-3 text-slate-400 shrink-0" />
                        <span className="truncate">{bookedAppointment.patientName}</span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-500">
                        <span className="font-mono font-semibold text-emerald-800">
                          Token #{bookedAppointment.tokenNumber}
                        </span>
                        <span className={`px-1.5 py-0.2 rounded text-[10px] font-medium ${
                          bookedAppointment.status === 'Checked-In' ? 'bg-emerald-100 text-emerald-800' :
                          bookedAppointment.status === 'In-Progress' ? 'bg-blue-100 text-blue-800' : 'bg-slate-200 text-slate-700'
                        }`}>
                          {bookedAppointment.status}
                        </span>
                      </div>
                    </div>

                    {/* Quick WhatsApp Share & Reminder action buttons */}
                    <div className="flex items-center gap-1 mt-2.5 pt-2 border-t border-slate-200/60">
                      <button
                        title="Send Reminder via WhatsApp"
                        onClick={() => handleSendReminder(bookedAppointment)}
                        className="text-[11px] text-emerald-700 hover:text-emerald-800 font-semibold flex items-center gap-1 px-1.5 py-0.5 hover:bg-emerald-50 rounded"
                      >
                        <Share2 className="w-3 h-3" />
                        WhatsApp
                      </button>

                      <select
                        value={bookedAppointment.status}
                        onChange={(e) =>
                          updateAppointmentStatus(
                            bookedAppointment.id,
                            e.target.value as any
                          )
                        }
                        className="text-[10px] ml-auto bg-white border border-slate-300 rounded px-1 py-0.5"
                      >
                        <option value="Confirmed">Confirmed</option>
                        <option value="Checked-In">Checked In</option>
                        <option value="In-Progress">In Consultation</option>
                        <option value="Completed">Completed</option>
                      </select>
                    </div>
                  </div>
                );
              }

              // Available Slot
              return (
                <button
                  key={slot}
                  onClick={() => handleOpenBookSlot(slot)}
                  className="p-3 rounded-xl border border-emerald-200 bg-emerald-50/40 hover:bg-emerald-100/70 hover:border-emerald-400 text-left transition-all group flex flex-col justify-between"
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="font-mono font-bold text-xs text-emerald-950">
                      {slot}
                    </span>
                    <Plus className="w-3.5 h-3.5 text-emerald-600 group-hover:scale-110 transition-transform" />
                  </div>
                  <div className="mt-3">
                    <span className="text-[11px] font-semibold text-emerald-700 block">
                      Available
                    </span>
                    <span className="text-[10px] text-slate-500">
                      Click to Lock & Book
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: Today's OPD Token Queue & Waitlist (4 cols) */}
        <div className="lg:col-span-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="font-bold text-sm text-slate-900">
                Live OPD Token Queue
              </h3>
              <p className="text-xs text-slate-500">
                {doctorAppointmentsOnDate.length} Patients Scheduled
              </p>
            </div>
            <span className="bg-emerald-100 text-emerald-800 text-xs font-bold px-2 py-0.5 rounded-full">
              Active Queue
            </span>
          </div>

          <div className="space-y-2.5 max-h-[480px] overflow-y-auto pr-1">
            {doctorAppointmentsOnDate.length === 0 ? (
              <div className="text-center py-10 text-xs text-slate-400">
                No appointments booked for this doctor on {selectedDate}.
              </div>
            ) : (
              doctorAppointmentsOnDate.map((apt) => (
                <div
                  key={apt.id}
                  className="p-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-white hover:border-emerald-300 transition-all space-y-2"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-7 h-7 rounded-lg bg-emerald-700 text-white font-bold font-mono text-xs flex items-center justify-center shrink-0">
                        #{apt.tokenNumber}
                      </span>
                      <div>
                        <h5 className="font-bold text-xs text-slate-900 leading-tight">
                          {apt.patientName}
                        </h5>
                        <p className="text-[11px] text-slate-500 font-mono">
                          {apt.timeSlot} • {apt.type}
                        </p>
                      </div>
                    </div>

                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        apt.status === 'Checked-In'
                          ? 'bg-emerald-100 text-emerald-800'
                          : apt.status === 'In-Progress'
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {apt.status}
                    </span>
                  </div>

                  {apt.symptomsBrief && (
                    <p className="text-[11px] text-slate-600 bg-white p-1.5 rounded border border-slate-200 line-clamp-2">
                      {apt.symptomsBrief}
                    </p>
                  )}

                  <div className="flex items-center justify-between text-xs pt-1">
                    <button
                      onClick={() => handleSendReminder(apt)}
                      className="text-[11px] text-emerald-700 hover:text-emerald-800 font-semibold flex items-center gap-1"
                    >
                      <Bell className="w-3 h-3" />
                      {apt.reminderSent ? 'Reminder Sent' : 'Send Reminder'}
                    </button>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          setSelectedPatientId(apt.patientId);
                          setActiveTab('prescriptions');
                        }}
                        className="text-[11px] text-blue-700 hover:underline font-semibold"
                      >
                        Start Rx
                      </button>
                      <button
                        onClick={() => cancelAppointment(apt.id)}
                        className="text-[11px] text-rose-600 hover:underline font-medium"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Booking Slot Modal */}
      {isBookingModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full overflow-hidden p-6 space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-bold text-base text-slate-900">
                  Lock & Book Appointment Slot
                </h3>
                <p className="text-xs text-slate-500">
                  {currentDoctor?.name} • {selectedDate} at {targetSlotToBook}
                </p>
              </div>
              <button
                onClick={() => setIsBookingModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleConfirmBooking} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Select Patient:
                </label>
                <select
                  value={bookingForm.patientId}
                  onChange={(e) =>
                    setBookingForm({ ...bookingForm, patientId: e.target.value })
                  }
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-800 font-medium"
                >
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.id}) - {p.phone}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Visit Category:
                </label>
                <select
                  value={bookingForm.type}
                  onChange={(e) =>
                    setBookingForm({
                      ...bookingForm,
                      type: e.target.value as any,
                    })
                  }
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-800"
                >
                  <option value="First Visit">First Consultation Visit</option>
                  <option value="Follow-up">Follow-up / Review</option>
                  <option value="Routine Checkup">Routine Health Checkup</option>
                  <option value="Emergency">Urgent / Emergency OPD</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Presenting Complaints / Symptoms:
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. Headache, fever for 2 days, knee joint pain..."
                  value={bookingForm.symptomsBrief}
                  onChange={(e) =>
                    setBookingForm({
                      ...bookingForm,
                      symptomsBrief: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-800"
                />
              </div>

              <div className="bg-amber-50 border border-amber-200 p-3 rounded-xl flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-amber-700" />
                  <div>
                    <span className="text-xs font-bold text-amber-900 block">
                      Lock This Slot
                    </span>
                    <span className="text-[11px] text-amber-700">
                      Prevents any other staff from double-booking this time.
                    </span>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={bookingForm.lockImmediately}
                  onChange={(e) =>
                    setBookingForm({
                      ...bookingForm,
                      lockImmediately: e.target.checked,
                    })
                  }
                  className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsBookingModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg shadow-xs flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  Confirm & WhatsApp Token
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

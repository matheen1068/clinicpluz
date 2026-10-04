import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  Patient,
  Doctor,
  Appointment,
  Prescription,
  LabReport,
  Invoice,
  ClinicSettings,
  ActiveTab,
} from '../types/clinic';
import {
  initialClinicSettings,
  initialDoctors,
  initialPatients,
  initialAppointments,
  initialPrescriptions,
  initialLabReports,
  initialInvoices,
} from '../data/mockClinicData';

interface WhatsAppModalOptions {
  isOpen: boolean;
  title: string;
  recipientName: string;
  phone: string;
  message: string;
  onSent?: () => void;
}

interface PrintModalOptions {
  isOpen: boolean;
  type: 'prescription' | 'report' | 'invoice' | 'appointment';
  data: any;
}

interface ClinicContextType {
  patients: Patient[];
  doctors: Doctor[];
  appointments: Appointment[];
  prescriptions: Prescription[];
  labReports: LabReport[];
  invoices: Invoice[];
  clinicSettings: ClinicSettings;
  activeTab: ActiveTab;
  selectedPatientId: string | null;
  searchTerm: string;

  // Modals
  whatsAppModal: WhatsAppModalOptions;
  printModal: PrintModalOptions;
  openWhatsAppModal: (options: Omit<WhatsAppModalOptions, 'isOpen'>) => void;
  closeWhatsAppModal: () => void;
  openPrintModal: (options: Omit<PrintModalOptions, 'isOpen'>) => void;
  closePrintModal: () => void;

  // Actions
  setActiveTab: (tab: ActiveTab) => void;
  setSelectedPatientId: (id: string | null) => void;
  setSearchTerm: (term: string) => void;
  addPatient: (patient: Omit<Patient, 'id' | 'registeredAt'>) => Patient;
  updatePatient: (id: string, updates: Partial<Patient>) => void;
  deletePatient: (id: string) => void;
  
  // Appointments & Slot Locking
  bookAppointment: (apt: {
    patientId: string;
    patientName: string;
    patientPhone: string;
    doctorId: string;
    doctorName: string;
    specialty: string;
    date: string;
    timeSlot: string;
    type: Appointment['type'];
    symptomsBrief?: string;
    isLocked?: boolean;
  }) => Appointment;
  toggleSlotLock: (appointmentId: string) => void;
  updateAppointmentStatus: (appointmentId: string, status: Appointment['status']) => void;
  cancelAppointment: (appointmentId: string) => void;
  triggerReminder: (appointmentId: string) => void;

  // Clinical Records
  addPrescription: (rx: Omit<Prescription, 'id' | 'date'>) => Prescription;
  addLabReport: (report: Omit<LabReport, 'id' | 'reportDate'>) => LabReport;
  addInvoice: (inv: Omit<Invoice, 'id' | 'date'>) => Invoice;
  recordInvoicePayment: (invoiceId: string, amount: number, paymentMode: Invoice['paymentMode'], ref?: string) => void;
  updateDoctorStatus: (doctorId: string, status: Doctor['status']) => void;
  updateClinicSettings: (settings: Partial<ClinicSettings>) => void;
  resetToDefaultData: () => void;
}

const ClinicContext = createContext<ClinicContextType | undefined>(undefined);

const STORAGE_KEYS = {
  PATIENTS: 'cp_patients_v1',
  DOCTORS: 'cp_doctors_v1',
  APPOINTMENTS: 'cp_appointments_v1',
  PRESCRIPTIONS: 'cp_prescriptions_v1',
  LAB_REPORTS: 'cp_lab_reports_v1',
  INVOICES: 'cp_invoices_v1',
  SETTINGS: 'cp_settings_v1',
};

export const ClinicProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [patients, setPatients] = useState<Patient[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.PATIENTS);
      return saved ? JSON.parse(saved) : initialPatients;
    } catch {
      return initialPatients;
    }
  });

  const [doctors, setDoctors] = useState<Doctor[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.DOCTORS);
      return saved ? JSON.parse(saved) : initialDoctors;
    } catch {
      return initialDoctors;
    }
  });

  const [appointments, setAppointments] = useState<Appointment[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.APPOINTMENTS);
      return saved ? JSON.parse(saved) : initialAppointments;
    } catch {
      return initialAppointments;
    }
  });

  const [prescriptions, setPrescriptions] = useState<Prescription[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.PRESCRIPTIONS);
      return saved ? JSON.parse(saved) : initialPrescriptions;
    } catch {
      return initialPrescriptions;
    }
  });

  const [labReports, setLabReports] = useState<LabReport[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.LAB_REPORTS);
      return saved ? JSON.parse(saved) : initialLabReports;
    } catch {
      return initialLabReports;
    }
  });

  const [invoices, setInvoices] = useState<Invoice[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.INVOICES);
      return saved ? JSON.parse(saved) : initialInvoices;
    } catch {
      return initialInvoices;
    }
  });

  const [clinicSettings, setClinicSettings] = useState<ClinicSettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      return saved ? JSON.parse(saved) : initialClinicSettings;
    } catch {
      return initialClinicSettings;
    }
  });

  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // WhatsApp and Print Modals
  const [whatsAppModal, setWhatsAppModal] = useState<WhatsAppModalOptions>({
    isOpen: false,
    title: '',
    recipientName: '',
    phone: '',
    message: '',
  });

  const [printModal, setPrintModal] = useState<PrintModalOptions>({
    isOpen: false,
    type: 'prescription',
    data: null,
  });

  // Sync state to local storage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.PATIENTS, JSON.stringify(patients));
    } catch (e) {
      console.error(e);
    }
  }, [patients]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.DOCTORS, JSON.stringify(doctors));
    } catch (e) {
      console.error(e);
    }
  }, [doctors]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.APPOINTMENTS, JSON.stringify(appointments));
    } catch (e) {
      console.error(e);
    }
  }, [appointments]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.PRESCRIPTIONS, JSON.stringify(prescriptions));
    } catch (e) {
      console.error(e);
    }
  }, [prescriptions]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.LAB_REPORTS, JSON.stringify(labReports));
    } catch (e) {
      console.error(e);
    }
  }, [labReports]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify(invoices));
    } catch (e) {
      console.error(e);
    }
  }, [invoices]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(clinicSettings));
    } catch (e) {
      console.error(e);
    }
  }, [clinicSettings]);

  const openWhatsAppModal = (opts: Omit<WhatsAppModalOptions, 'isOpen'>) => {
    setWhatsAppModal({ ...opts, isOpen: true });
  };

  const closeWhatsAppModal = () => {
    setWhatsAppModal((prev) => ({ ...prev, isOpen: false }));
  };

  const openPrintModal = (opts: Omit<PrintModalOptions, 'isOpen'>) => {
    setPrintModal({ ...opts, isOpen: true });
  };

  const closePrintModal = () => {
    setPrintModal((prev) => ({ ...prev, isOpen: false }));
  };

  // Patients Actions
  const addPatient = (patientData: Omit<Patient, 'id' | 'registeredAt'>): Patient => {
    const nextNum = patients.length + 1;
    const year = new Date().getFullYear();
    const id = `PID-${year}-${String(nextNum).padStart(3, '0')}`;
    const newPatient: Patient = {
      ...patientData,
      id,
      registeredAt: new Date().toISOString().split('T')[0],
    };
    setPatients((prev) => [newPatient, ...prev]);
    return newPatient;
  };

  const updatePatient = (id: string, updates: Partial<Patient>) => {
    setPatients((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...updates } : p))
    );
  };

  const deletePatient = (id: string) => {
    setPatients((prev) => prev.filter((p) => p.id !== id));
    if (selectedPatientId === id) setSelectedPatientId(null);
  };

  // Appointment & Slot Booking Actions
  const bookAppointment = (aptData: {
    patientId: string;
    patientName: string;
    patientPhone: string;
    doctorId: string;
    doctorName: string;
    specialty: string;
    date: string;
    timeSlot: string;
    type: Appointment['type'];
    symptomsBrief?: string;
    isLocked?: boolean;
  }): Appointment => {
    // Generate next token for the doctor on that date
    const doctorTokensForDate = appointments
      .filter((a) => a.doctorId === aptData.doctorId && a.date === aptData.date)
      .map((a) => a.tokenNumber);
    const nextToken = doctorTokensForDate.length > 0 ? Math.max(...doctorTokensForDate) + 1 : 1;

    const newApt: Appointment = {
      id: `APT-${Date.now().toString().slice(-6)}`,
      patientId: aptData.patientId,
      patientName: aptData.patientName,
      patientPhone: aptData.patientPhone,
      doctorId: aptData.doctorId,
      doctorName: aptData.doctorName,
      specialty: aptData.specialty,
      date: aptData.date,
      timeSlot: aptData.timeSlot,
      tokenNumber: nextToken,
      type: aptData.type,
      status: 'Confirmed',
      isLocked: aptData.isLocked ?? true, // Auto lock slot to avoid double booking
      symptomsBrief: aptData.symptomsBrief || '',
      reminderSent: false,
      createdAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
    };

    setAppointments((prev) => [newApt, ...prev]);
    return newApt;
  };

  const toggleSlotLock = (appointmentId: string) => {
    setAppointments((prev) =>
      prev.map((apt) =>
        apt.id === appointmentId ? { ...apt, isLocked: !apt.isLocked } : apt
      )
    );
  };

  const updateAppointmentStatus = (
    appointmentId: string,
    status: Appointment['status']
  ) => {
    setAppointments((prev) =>
      prev.map((apt) => (apt.id === appointmentId ? { ...apt, status } : apt))
    );
  };

  const cancelAppointment = (appointmentId: string) => {
    setAppointments((prev) =>
      prev.map((apt) =>
        apt.id === appointmentId
          ? { ...apt, status: 'Cancelled', isLocked: false }
          : apt
      )
    );
  };

  const triggerReminder = (appointmentId: string) => {
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
    setAppointments((prev) =>
      prev.map((apt) =>
        apt.id === appointmentId
          ? { ...apt, reminderSent: true, reminderSentAt: timestamp }
          : apt
      )
    );
  };

  // Clinical Records Actions
  const addPrescription = (rxData: Omit<Prescription, 'id' | 'date'>): Prescription => {
    const nextRxNum = prescriptions.length + 1;
    const year = new Date().getFullYear();
    const id = `RX-${year}-${String(nextRxNum).padStart(3, '0')}`;
    const newRx: Prescription = {
      ...rxData,
      id,
      date: new Date().toISOString().split('T')[0],
    };
    setPrescriptions((prev) => [newRx, ...prev]);
    return newRx;
  };

  const addLabReport = (reportData: Omit<LabReport, 'id' | 'reportDate'>): LabReport => {
    const nextLabNum = labReports.length + 1;
    const year = new Date().getFullYear();
    const id = `LAB-${year}-${String(nextLabNum).padStart(3, '0')}`;
    const newReport: LabReport = {
      ...reportData,
      id,
      reportDate: new Date().toISOString().split('T')[0],
    };
    setLabReports((prev) => [newReport, ...prev]);
    return newReport;
  };

  const addInvoice = (invData: Omit<Invoice, 'id' | 'date'>): Invoice => {
    const nextInvNum = invoices.length + 1;
    const year = new Date().getFullYear();
    const id = `INV-${year}-${String(nextInvNum).padStart(3, '0')}`;
    const newInvoice: Invoice = {
      ...invData,
      id,
      date: new Date().toISOString().split('T')[0],
    };
    setInvoices((prev) => [newInvoice, ...prev]);
    return newInvoice;
  };

  const recordInvoicePayment = (
    invoiceId: string,
    amount: number,
    paymentMode: Invoice['paymentMode'],
    ref?: string
  ) => {
    setInvoices((prev) =>
      prev.map((inv) => {
        if (inv.id === invoiceId) {
          const newPaid = inv.amountPaid + amount;
          const newBalance = Math.max(0, inv.grandTotal - newPaid);
          const paymentStatus =
            newBalance <= 0.01
              ? 'Paid'
              : newPaid > 0
              ? 'Partial'
              : 'Unpaid';
          return {
            ...inv,
            amountPaid: newPaid,
            balanceDue: newBalance,
            paymentStatus,
            paymentMode,
            transactionReference: ref || inv.transactionReference,
          };
        }
        return inv;
      })
    );
  };

  const updateDoctorStatus = (doctorId: string, status: Doctor['status']) => {
    setDoctors((prev) =>
      prev.map((d) => (d.id === doctorId ? { ...d, status } : d))
    );
  };

  const updateClinicSettings = (settings: Partial<ClinicSettings>) => {
    setClinicSettings((prev) => ({ ...prev, ...settings }));
  };

  const resetToDefaultData = () => {
    setPatients(initialPatients);
    setDoctors(initialDoctors);
    setAppointments(initialAppointments);
    setPrescriptions(initialPrescriptions);
    setLabReports(initialLabReports);
    setInvoices(initialInvoices);
    setClinicSettings(initialClinicSettings);
    localStorage.clear();
  };

  return (
    <ClinicContext.Provider
      value={{
        patients,
        doctors,
        appointments,
        prescriptions,
        labReports,
        invoices,
        clinicSettings,
        activeTab,
        selectedPatientId,
        searchTerm,
        whatsAppModal,
        printModal,
        openWhatsAppModal,
        closeWhatsAppModal,
        openPrintModal,
        closePrintModal,
        setActiveTab,
        setSelectedPatientId,
        setSearchTerm,
        addPatient,
        updatePatient,
        deletePatient,
        bookAppointment,
        toggleSlotLock,
        updateAppointmentStatus,
        cancelAppointment,
        triggerReminder,
        addPrescription,
        addLabReport,
        addInvoice,
        recordInvoicePayment,
        updateDoctorStatus,
        updateClinicSettings,
        resetToDefaultData,
      }}
    >
      {children}
    </ClinicContext.Provider>
  );
};

export const useClinic = () => {
  const context = useContext(ClinicContext);
  if (!context) {
    throw new Error('useClinic must be used within a ClinicProvider');
  }
  return context;
};

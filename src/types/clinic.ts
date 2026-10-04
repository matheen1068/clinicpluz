export interface Doctor {
  id: string;
  name: string;
  specialty: string;
  qualification: string;
  regNumber: string;
  roomNumber: string;
  consultationFee: number;
  phone: string;
  email: string;
  availableDays: string[];
  availableTimeSlots: string[];
  avatarUrl: string;
  status: 'Available' | 'In Consultation' | 'On Break' | 'Off Duty';
}

export interface Patient {
  id: string; // e.g. PID-2026-001
  name: string;
  dob: string;
  age: number;
  gender: 'Male' | 'Female' | 'Other';
  phone: string;
  whatsappNumber: string;
  email?: string;
  bloodGroup: 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-' | 'Unknown';
  address: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  allergies: string[];
  chronicConditions: string[];
  registeredAt: string;
}

export interface Appointment {
  id: string;
  patientId: string;
  patientName: string;
  patientPhone: string;
  doctorId: string;
  doctorName: string;
  specialty: string;
  date: string; // YYYY-MM-DD
  timeSlot: string; // e.g. '09:30 AM'
  tokenNumber: number;
  type: 'First Visit' | 'Follow-up' | 'Emergency' | 'Routine Checkup';
  status: 'Reserved' | 'Confirmed' | 'Checked-In' | 'In-Progress' | 'Completed' | 'Cancelled' | 'Locked';
  isLocked: boolean; // Locked prevents double booking
  symptomsBrief?: string;
  reminderSent: boolean;
  reminderSentAt?: string;
  createdAt: string;
}

export interface Vitals {
  bpSystolic?: number;
  bpDiastolic?: number;
  pulse?: number;
  spo2?: number;
  temperature?: number;
  weight?: number;
  height?: number;
  bmi?: number;
}

export interface MedicineItem {
  id: string;
  name: string;
  type: 'Tablet' | 'Capsule' | 'Syrup' | 'Injection' | 'Ointment' | 'Drops' | 'Inhaler';
  dosage: string; // e.g., 500mg, 10ml
  frequency: string; // 1-0-1, 1-0-0, 0-0-1, 1-1-1, SOS
  timing: 'After Food' | 'Before Food' | 'With Food' | 'Bedtime' | 'Empty Stomach';
  durationDays: number;
  instructions?: string;
}

export interface Prescription {
  id: string; // RX-2026-001
  patientId: string;
  patientName: string;
  patientAge: number;
  patientGender: string;
  doctorId: string;
  doctorName: string;
  doctorSpecialty: string;
  doctorRegNo: string;
  appointmentId?: string;
  date: string;
  vitals: Vitals;
  symptoms: string[];
  diagnosis: string;
  clinicalNotes?: string;
  medicines: MedicineItem[];
  dietaryAdvice?: string;
  investigationsAdvised?: string[];
  nextFollowUpDate?: string;
  whatsappSentAt?: string;
}

export interface LabTestItem {
  testName: string;
  resultValue: string;
  unit: string;
  referenceRange: string;
  status: 'Normal' | 'Low' | 'High' | 'Critical';
}

export interface LabReport {
  id: string; // LAB-2026-001
  patientId: string;
  patientName: string;
  patientAge: number;
  patientGender: string;
  doctorId: string;
  doctorName: string;
  category: 'Hematology' | 'Biochemistry' | 'Thyroid & Endocrine' | 'Radiology' | 'Urine Analysis' | 'Lipid Profile';
  testTitle: string;
  sampleCollectionDate: string;
  reportDate: string;
  items: LabTestItem[];
  technicianNotes?: string;
  impression: string;
  status: 'Preliminary' | 'Verified' | 'Signed';
  technicianName: string;
  whatsappSentAt?: string;
}

export interface BillItem {
  id: string;
  description: string;
  category: 'Consultation' | 'Lab Investigation' | 'Pharmacy' | 'Procedure' | 'Nursing';
  unitPrice: number;
  quantity: number;
  total: number;
}

export interface Invoice {
  id: string; // INV-2026-001
  patientId: string;
  patientName: string;
  patientPhone: string;
  date: string;
  dueDate?: string;
  items: BillItem[];
  subtotal: number;
  discountPercent: number;
  discountAmount: number;
  taxPercent: number;
  taxAmount: number;
  grandTotal: number;
  amountPaid: number;
  balanceDue: number;
  paymentStatus: 'Paid' | 'Partial' | 'Unpaid';
  paymentMode: 'Cash' | 'UPI / QR' | 'Credit/Debit Card' | 'Net Banking' | 'Insurance';
  transactionReference?: string;
  notes?: string;
  whatsappSentAt?: string;
}

export interface ClinicSettings {
  name: string;
  tagline: string;
  regNumber: string;
  address: string;
  phone: string;
  emergencyPhone: string;
  email: string;
  whatsappSupportNumber: string;
  currencySymbol: string;
  taxRate: number; // e.g. 5%
}

export type UserRole = 'Admin' | 'Doctor' | 'Receptionist' | 'LabTechnician';

export interface StaffUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  department: string;
  avatarUrl?: string;
  doctorId?: string;
  phone?: string;
}

export type ActiveTab = 
  | 'dashboard'
  | 'patients'
  | 'appointments'
  | 'prescriptions'
  | 'reports'
  | 'billing'
  | 'reminders'
  | 'doctors';

import { Appointment, Prescription, LabReport, Invoice, ClinicSettings } from '../types/clinic';

/**
 * Normalizes phone numbers for WhatsApp link (removes spaces, dashes, plus, parentheses)
 */
export function sanitizeWhatsAppPhone(phone: string): string {
  // Remove non-numeric characters except initial plus
  const digitsOnly = phone.replace(/\D/g, '');
  // Default to appending country code if missing (e.g. 10 digit Indian/US format)
  if (digitsOnly.length === 10) {
    return '91' + digitsOnly; // Default common standard or keep as provided
  }
  return digitsOnly;
}

export function createWhatsAppUrl(phone: string, text: string): string {
  const cleanPhone = sanitizeWhatsAppPhone(phone);
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;
}

/**
 * Builds formatted text message for Appointment Confirmation & Token
 */
export function buildAppointmentWhatsAppMessage(
  apt: Appointment,
  clinic: ClinicSettings
): string {
  return `🏥 *${clinic.name.toUpperCase()}*
━━━━━━━━━━━━━━━━━━━━
📅 *APPOINTMENT CONFIRMATION & TOKEN*

Dear *${apt.patientName}*, your appointment has been confirmed!

🔖 *Token Number:* #${apt.tokenNumber}
👨‍⚕️ *Doctor:* ${apt.doctorName}
🩺 *Specialty:* ${apt.specialty}
🗓️ *Date:* ${apt.date}
⏰ *Time Slot:* ${apt.timeSlot}
🏢 *Location:* ${clinic.address}

📌 *Instructions for your visit:*
• Please arrive 10 minutes prior to your allocated slot.
• Present this token message at the reception counter.
• Bring your previous medical records or test reports.

📞 Need help? Call ${clinic.phone} or Emergency: ${clinic.emergencyPhone}
━━━━━━━━━━━━━━━━━━━━
_Thank you for trusting ${clinic.name}_`;
}

/**
 * Builds formatted text message for Automated Appointment Reminder
 */
export function buildReminderWhatsAppMessage(
  apt: Appointment,
  clinic: ClinicSettings
): string {
  return `⏰ *APPOINTMENT REMINDER - ${clinic.name}*
━━━━━━━━━━━━━━━━━━━━
Dear *${apt.patientName}*,

This is a gentle automated reminder for your scheduled visit:

🔖 *Token #:* #${apt.tokenNumber}
👨‍⚕️ *Doctor:* ${apt.doctorName}
🗓️ *Scheduled Date:* ${apt.date}
⏰ *Time Slot:* ${apt.timeSlot}
🏥 *Clinic:* ${clinic.name}

Please reply with:
1️⃣ *CONFIRM* - If you are arriving on time
2️⃣ *RESCHEDULE* - If you wish to change your slot

📞 Helpdesk: ${clinic.phone}`;
}

/**
 * Builds formatted text message for Digital Prescription (Rx)
 */
export function buildPrescriptionWhatsAppMessage(
  rx: Prescription,
  clinic: ClinicSettings
): string {
  const medicineList = rx.medicines.map((med, index) => {
    return `${index + 1}. *${med.name}* (${med.type})
   • Dosage: ${med.dosage} | Frequency: ${med.frequency}
   • Timing: ${med.timing}
   • Duration: ${med.durationDays} days
   ${med.instructions ? `• Note: _${med.instructions}_` : ''}`;
  }).join('\n\n');

  const investigations = rx.investigationsAdvised && rx.investigationsAdvised.length > 0
    ? `\n🔬 *Advised Lab Tests:*\n${rx.investigationsAdvised.map(i => `• ${i}`).join('\n')}\n`
    : '';

  return `🏥 *${clinic.name.toUpperCase()}*
━━━━━━━━━━━━━━━━━━━━
℞ *DIGITAL MEDICAL PRESCRIPTION*
📄 *Prescription ID:* ${rx.id}
🗓️ *Date:* ${rx.date}

👤 *Patient:* ${rx.patientName} (${rx.patientAge} yrs, ${rx.patientGender})
👨‍⚕️ *Consultant:* ${rx.doctorName}
🩺 *Specialty:* ${rx.doctorSpecialty} (Reg: ${rx.doctorRegNo})
────────────────────
🎯 *Diagnosis:*
${rx.diagnosis}

💊 *PRESCRIBED MEDICINES:*
${medicineList}
${investigations}
🥗 *Diet & Care Advice:*
${rx.dietaryAdvice || 'Adequate rest, hydration, and adherence to prescription schedule.'}

📅 *Next Follow-up:* ${rx.nextFollowUpDate || 'As advised or SOS in case of emergency'}
━━━━━━━━━━━━━━━━━━━━
📞 Clinic Helpline: ${clinic.phone}
_This is a digitally generated medical record from ${clinic.name}._`;
}

/**
 * Builds formatted text message for Diagnostic Lab Report
 */
export function buildLabReportWhatsAppMessage(
  report: LabReport,
  clinic: ClinicSettings
): string {
  const testResults = report.items.map(item => {
    const alertIcon = item.status === 'High' ? '🔺 [HIGH]' : item.status === 'Low' ? '🔻 [LOW]' : item.status === 'Critical' ? '⚠️ [CRITICAL]' : '✅';
    return `• *${item.testName}*: ${item.resultValue} ${item.unit} (${item.referenceRange}) ${alertIcon}`;
  }).join('\n');

  return `🏥 *${clinic.name.toUpperCase()}*
🔬 *DIAGNOSTIC LAB INVESTIGATION REPORT*
━━━━━━━━━━━━━━━━━━━━
📄 *Report ID:* ${report.id}
🗓️ *Report Date:* ${report.reportDate}
👤 *Patient:* ${report.patientName} (${report.patientAge} yrs)
👨‍⚕️ *Referred By:* ${report.doctorName}
🧪 *Test Category:* ${report.testTitle}
────────────────────
📊 *INVESTIGATION RESULTS:*
${testResults}

📝 *Clinical Impression:*
${report.impression}

🔬 *Verified by:* ${report.technicianName}
━━━━━━━━━━━━━━━━━━━━
_Please consult your attending physician for clinical correlation and treatment adjustments._
📞 Laboratory Desk: ${clinic.phone}`;
}

/**
 * Builds formatted text message for Billing & Payment Receipt
 */
export function buildInvoiceWhatsAppMessage(
  inv: Invoice,
  clinic: ClinicSettings
): string {
  const itemsText = inv.items.map(item => {
    return `• ${item.description}: ${clinic.currencySymbol}${item.total.toFixed(2)}`;
  }).join('\n');

  const statusEmoji = inv.paymentStatus === 'Paid' ? '✅ PAID' : inv.paymentStatus === 'Partial' ? '⚠️ PARTIAL' : '⏳ UNPAID';

  return `🏥 *${clinic.name.toUpperCase()}*
🧾 *OFFICIAL CASH / BILLING RECEIPT*
━━━━━━━━━━━━━━━━━━━━
📄 *Invoice #:* ${inv.id}
🗓️ *Date:* ${inv.date}
👤 *Patient:* ${inv.patientName}
────────────────────
📋 *CHARGES BREAKDOWN:*
${itemsText}

💰 *Subtotal:* ${clinic.currencySymbol}${inv.subtotal.toFixed(2)}
${inv.discountAmount > 0 ? `🏷️ *Discount (${inv.discountPercent}%):* -${clinic.currencySymbol}${inv.discountAmount.toFixed(2)}\n` : ''}🏛️ *Taxes (${inv.taxPercent}%):* ${clinic.currencySymbol}${inv.taxAmount.toFixed(2)}
━━━━━━━━━━━━━━━━━━━━
💵 *GRAND TOTAL:* ${clinic.currencySymbol}${inv.grandTotal.toFixed(2)}
💳 *Amount Received:* ${clinic.currencySymbol}${inv.amountPaid.toFixed(2)}
${inv.balanceDue > 0 ? `❗ *Balance Due:* ${clinic.currencySymbol}${inv.balanceDue.toFixed(2)}\n` : ''}📌 *Payment Status:* ${statusEmoji} (${inv.paymentMode})
${inv.transactionReference ? `🔢 *Ref ID:* ${inv.transactionReference}\n` : ''}━━━━━━━━━━━━━━━━━━━━
_Thank you for your payment! Keep this digital receipt for tax and insurance claims._
📞 Accounts Desk: ${clinic.phone}`;
}

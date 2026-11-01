import { PDFDocument, StandardFonts } from 'pdf-lib';
import type { Medication } from './consultation.ts';

export interface PrescriptionDocument {
  clinic: { slug: string; displayName: string; address?: string | null; phone?: string | null;
    email?: string | null; logoUrl?: string | null };
  doctor: { id: string; displayName: string };
  patient: { id: string; fullName: string; ageYears: number; sex: string };
  appointmentDate: string;
  finalizedAt: string;
  medications: Medication[];
}

export class UnsupportedPrescriptionText extends Error {}

const timeLabels = { morning: 'Morning', afternoon: 'Afternoon', night: 'Night' } as const;
const mealLabels = {
  before: 'Before food', after: 'After food', with: 'With food', unspecified: 'Not specified',
} as const;

function printable(value: string): string {
  // The pilot PDF uses a built-in font. Reject unsupported glyphs rather than corrupting a prescription.
  if (!/^[\x20-\x7e\r\n]*$/.test(value)) throw new UnsupportedPrescriptionText('Unsupported demo PDF text');
  return value;
}

export async function renderPrescriptionPdf(document: PrescriptionDocument,
  logo?: { bytes: Uint8Array; contentType: 'image/png' | 'image/jpeg' }): Promise<Uint8Array> {
  if (document.medications.length < 1 || document.medications.length > 20) {
    throw new UnsupportedPrescriptionText('Unsupported demo PDF content');
  }
  const lines = [
    'CLINICPLUZ SYNTHETIC DEMO - NOT FOR CLINICAL USE',
    '',
    `Clinic: ${printable(document.clinic.displayName)}`,
    ...(document.clinic.address ? [`Address: ${printable(document.clinic.address)}`] : []),
    ...(document.clinic.phone ? [`Phone: ${printable(document.clinic.phone)}`] : []),
    ...(document.clinic.email ? [`Email: ${printable(document.clinic.email)}`] : []),
    `Patient: ${printable(document.patient.fullName)} (ID: ${printable(document.patient.id)})`,
    `Age at registration: ${document.patient.ageYears}; Sex: ${printable(document.patient.sex)}`,
    `Doctor: ${printable(document.doctor.displayName)} (ID: ${printable(document.doctor.id)})`,
    `Appointment date: ${printable(document.appointmentDate)}`,
    `Finalized at: ${printable(document.finalizedAt)}`,
    '',
    'PRESCRIPTION ENTRIES',
  ];
  for (const [index, medication] of document.medications.entries()) {
    if (!medication.name || !medication.dose || !medication.route || !medication.duration ||
        !medication.instructions || Boolean(medication.frequency) === Boolean(medication.timing)) {
      throw new UnsupportedPrescriptionText('Incomplete demo PDF prescription');
    }
    lines.push('', `${index + 1}. ${printable(medication.name)}`,
      `Strength: ${printable(medication.strength)}`,
      `Dose: ${printable(medication.dose)}`,
      `Route: ${printable(medication.route)}`);
    if (medication.timing) {
      const times = medication.timing.timesOfDay.map((time) => timeLabels[time]);
      const meal = mealLabels[medication.timing.mealRelation];
      if (!times.length || times.some((time) => !time) || !meal) {
        throw new UnsupportedPrescriptionText('Invalid demo PDF timing');
      }
      lines.push(`Times of day: ${printable(times.join(', '))}`,
        `Meal relation: ${printable(meal)}`);
    } else {
      lines.push(`Frequency: ${printable(medication.frequency)}`);
    }
    lines.push(`Duration: ${printable(medication.duration)}`,
      `Instructions: ${printable(medication.instructions)}`);
  }
  lines.push('', 'This document is a synthetic staging demonstration only.');

  const pdf = await PDFDocument.create();
  pdf.setTitle('ClinicPluz synthetic demo prescription');
  pdf.setCreator('ClinicPluz synthetic staging');
  const font = await pdf.embedFont(StandardFonts.Courier);
  let page = pdf.addPage([595, 842]);
  let logoImage: Awaited<ReturnType<typeof pdf.embedPng>> | undefined;
  if (logo) {
    try {
      logoImage = logo.contentType === 'image/png' ? await pdf.embedPng(logo.bytes) :
        await pdf.embedJpg(logo.bytes);
      if (logoImage.width < 1 || logoImage.width > 2048 ||
          logoImage.height < 1 || logoImage.height > 2048) {
        throw new UnsupportedPrescriptionText('Invalid demo clinic logo');
      }
      const scale = Math.min(72 / logoImage.width, 72 / logoImage.height);
      page.drawImage(logoImage, { x: 42, y: 705,
        width: logoImage.width * scale, height: logoImage.height * scale });
    } catch {
      throw new UnsupportedPrescriptionText('Invalid demo clinic logo');
    }
  }
  const wrapped = lines.flatMap((line) => line.replace(/\r\n?/g, '\n').split('\n')
    .flatMap((part) => part.length ? part.match(/.{1,78}/g) ?? [''] : ['']));
  if (wrapped.length > 720) throw new UnsupportedPrescriptionText('Demo PDF too long');
  let y = logoImage ? 680 : 800;
  for (const line of wrapped) {
    if (y < 42) {
      page = pdf.addPage([595, 842]);
      y = 800;
    }
    page.drawText(line, { x: 42, y, font, size: 10 });
    y -= 14;
  }
  const bytes = await pdf.save();
  if (bytes.length > 1_000_000) throw new UnsupportedPrescriptionText('Demo PDF too large');
  return bytes;
}

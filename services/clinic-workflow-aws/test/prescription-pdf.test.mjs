import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, decodePDFRawStream } from 'pdf-lib';
import { renderPrescriptionPdf, UnsupportedPrescriptionText } from '../src/prescription-pdf.ts';

function pageTextOperators(pdf) {
  return pdf.getPages().map((page) => {
    const contents = page.node.Contents();
    return Array.from({ length: contents.size() }, (_, index) =>
      Buffer.from(decodePDFRawStream(pdf.context.lookup(contents.get(index))).decode()).toString('ascii')).join('\n');
  }).join('\n');
}

const demo = {
  clinic: { slug: 'goodwell', displayName: 'Goodwell Demo Clinic' },
  doctor: { id: 'd1', displayName: 'Dr Demo' },
  patient: { id: 'p1', fullName: 'Fictional Patient', ageYears: 38, sex: 'female' },
  appointmentDate: '2026-10-10', finalizedAt: '2026-10-10T10:00:00Z',
  medications: [{ name: 'Demo Medicine', strength: '10 mg', dose: '1 tablet', route: 'oral',
    frequency: '', timing: { timesOfDay: ['morning', 'night'], mealRelation: 'after' },
    duration: '3 days', instructions: 'Clinician-entered directions' }],
};

test('server PDF carries the synthetic mark and all clinician-entered timing without notes', async () => {
  const bytes = await renderPrescriptionPdf(demo);
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 1);
  const operators = pageTextOperators(pdf);
  for (const phrase of ['CLINICPLUZ SYNTHETIC DEMO', 'Demo Medicine', 'Times of day: Morning, Night',
    'Meal relation: After food', 'Clinician-entered directions']) {
    assert.ok(operators.includes(Buffer.from(phrase).toString('hex').toUpperCase()), phrase);
  }
  assert.equal(operators.includes(Buffer.from('doctor-only note').toString('hex').toUpperCase()), false);
});

test('long directions paginate without truncation; unsupported Unicode fails closed', async () => {
  const many = { ...demo, medications: Array.from({ length: 20 }, (_, index) => ({
    ...demo.medications[0], name: `Demo Medicine ${index + 1}`,
    instructions: `Item ${index + 1}: ${'X'.repeat(480)}`,
  })) };
  const bytes = await renderPrescriptionPdf(many);
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() > 1);
  const operators = pageTextOperators(pdf);
  assert.ok(operators.includes(Buffer.from('Demo Medicine 20').toString('hex').toUpperCase()));
  await assert.rejects(() => renderPrescriptionPdf({ ...demo,
    patient: { ...demo.patient, fullName: 'अमन' } }), UnsupportedPrescriptionText);
  await assert.rejects(() => renderPrescriptionPdf({ ...demo,
    medications: [{ ...demo.medications[0], timing: { timesOfDay: ['mañana'], mealRelation: 'after' } }] }),
  UnsupportedPrescriptionText);
});

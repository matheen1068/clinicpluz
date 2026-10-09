import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ConsultationApiError, finalizeEncounter, getConsultationQueue, readEncounter, searchMedicines,
  saveDraft, saveVitals,
} from './consultationApi.ts';

const clinicDate = '2026-10-10';
const appointmentId = 'appointment-1';
const observedAt = '2026-10-10T09:30:00+05:30';
const finalizedAt = '2026-10-10T10:15:00+05:30';
const note = {
  chiefComplaint: 'Synthetic complaint', history: 'Synthetic history',
  exam: 'Synthetic exam', assessment: 'Synthetic assessment', plan: 'Synthetic plan',
};
const medicine = {
  name: 'Synthetic medicine', strength: '5 mg', dose: '1 tablet', route: 'oral',
  frequency: 'once daily', duration: '3 days', instructions: 'Synthetic instructions',
};

test('medicine lookup uses the clinic session and leaves dose selection to the doctor', async () => {
  const restore = mockFetch(async (url, options) => {
    assert.equal(url, '/api/workflow/clinics/goodwell/consultations/medicines/search');
    assert.equal(options.method, 'POST');
    assert.equal(options.credentials, 'include');
    assert.equal(options.headers['X-CSRF-Token'], 'session-csrf');
    assert.deepEqual(JSON.parse(options.body), { query: 'Synthetic tablet' });
    return Response.json({ items: [{ id: 'med-1', name: 'Synthetic tablet A', strength: '5 mg', favorite: true }] });
  });
  try {
    const items = await searchMedicines('goodwell', '  Synthetic  tablet ', 'session-csrf');
    assert.deepEqual(items, [{ id: 'med-1', name: 'Synthetic tablet A', strength: '5 mg', favorite: true }]);
    await assert.rejects(searchMedicines('goodwell', 'x', 'session-csrf'), ConsultationApiError);
  } finally { restore(); }

  const malformed = mockFetch(async () => Response.json({ items: [{ id: 'med-1', name: 'Synthetic tablet A' }] }));
  try { await assert.rejects(searchMedicines('goodwell', 'tablet', 'session-csrf'), ConsultationApiError); }
  finally { malformed(); }
});

function encounter(overrides = {}) {
  return {
    appointmentId, clinicDate, status: 'draft', revision: 1, vitals: null,
    finalizedAt: null,
    patient: { id: 'patient-1', fullName: 'Synthetic Patient', ageYears: 34, sex: 'undisclosed' },
    doctor: { id: 'doctor-1', displayName: 'Dr Synthetic' },
    clinic: { slug: 'goodwell', displayName: 'Goodwell Clinic' },
    ...overrides,
  };
}

function finalizedEncounter() {
  const base = encounter({ status: 'finalized', revision: 3, finalizedAt, note, medications: [medicine] });
  return {
    encounter: base,
    printablePrescription: {
      clinic: base.clinic, patient: base.patient, doctor: base.doctor,
      appointmentDate: clinicDate, finalizedAt, medications: [medicine],
    },
  };
}

function mockFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return () => { globalThis.fetch = original; };
}

test('date queue is clinic-scoped, uncached, and rejects invalid dates and items', async () => {
  let calls = 0;
  const restore = mockFetch(async (url, options) => {
    calls += 1;
    assert.equal(url, '/api/workflow/clinics/goodwell/consultations?date=2026-10-10');
    assert.equal(options.method, 'GET');
    assert.equal(options.credentials, 'include');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.mode, 'same-origin');
    assert.equal(options.redirect, 'error');
    return Response.json({ items: [{
      appointmentId, clinicDate, patientId: 'patient-1', patientName: 'Synthetic Patient',
      doctorId: 'doctor-1', doctorName: 'Dr Synthetic', startAt: observedAt,
      appointmentStatus: 'checked_in', encounterStatus: 'draft',
    }] });
  });
  try {
    assert.equal((await getConsultationQueue('goodwell', clinicDate))[0].appointmentId, appointmentId);
    await assert.rejects(getConsultationQueue('goodwell', '2026-02-30'), ConsultationApiError);
    assert.equal(calls, 1);
  } finally { restore(); }

  const restoreMalformed = mockFetch(async () => Response.json({ items: [{ appointmentId }] }));
  try { await assert.rejects(getConsultationQueue('goodwell', clinicDate), ConsultationApiError); }
  finally { restoreMalformed(); }
});

test('encounter read keeps patient data out of the URL and accepts a nurse-shaped response without a note', async () => {
  const restore = mockFetch(async (url, options) => {
    assert.equal(url, '/api/workflow/clinics/goodwell/consultations/read');
    assert.equal(options.method, 'POST');
    assert.equal(options.credentials, 'include');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.mode, 'same-origin');
    assert.equal(options.headers['X-CSRF-Token'], 'session-csrf');
    assert.deepEqual(JSON.parse(options.body), { appointmentId, clinicDate });
    assert.equal(url.includes('Synthetic Patient'), false);
    return Response.json({ encounter: encounter({
      vitals: {
        observedAt, recordedAt: observedAt, recordedBySub: 'nurse-1',
        recordedByDisplayName: 'Nurse Synthetic', pulseBpm: 72, spo2Percent: 98,
      },
    }) });
  });
  try {
    const result = await readEncounter('goodwell', appointmentId, clinicDate, 'session-csrf');
    assert.equal(result.patient.id, 'patient-1');
    assert.equal(result.vitals.recordedBySub, 'nurse-1');
    assert.equal(Object.hasOwn(result, 'note'), false);
    assert.equal(Object.hasOwn(result, 'medications'), false);
  } finally { restore(); }
});

test('vitals, draft, and finalization send appointment identity, revision, and CSRF in JSON bodies', async () => {
  const calls = [];
  const restore = mockFetch(async (url, options) => {
    calls.push({ url, options });
    const suffix = url.split('/').at(-1);
    if (suffix === 'vitals') return Response.json({ encounter: encounter({ revision: 2 }) });
    if (suffix === 'draft') return Response.json({ encounter: encounter({ revision: 3, note, medications: [medicine] }) });
    return Response.json(finalizedEncounter());
  });
  try {
    await saveVitals('goodwell', appointmentId, clinicDate, 1, { observedAt, pulseBpm: 72 }, 'session-csrf');
    await saveDraft('goodwell', appointmentId, clinicDate, 2, note, [medicine], 'session-csrf');
    const final = await finalizeEncounter('goodwell', appointmentId, clinicDate, 3, 'session-csrf');
    assert.equal(final.status, 'finalized');
    assert.equal(final.printablePrescription.patient.id, final.patient.id);
    assert.deepEqual(calls.map(({ url }) => url), [
      '/api/workflow/clinics/goodwell/consultations/vitals',
      '/api/workflow/clinics/goodwell/consultations/draft',
      '/api/workflow/clinics/goodwell/consultations/finalize',
    ]);
    for (const { url, options } of calls) {
      assert.equal(options.method, 'POST');
      assert.equal(options.credentials, 'include');
      assert.equal(options.cache, 'no-store');
      assert.equal(options.headers['X-CSRF-Token'], 'session-csrf');
      assert.equal(url.includes(note.chiefComplaint), false);
      assert.equal(url.includes(medicine.name), false);
      const body = JSON.parse(options.body);
      assert.equal(body.appointmentId, appointmentId);
      assert.equal(body.clinicDate, clinicDate);
    }
    assert.deepEqual(JSON.parse(calls[0].options.body).vitals, { observedAt, pulseBpm: 72 });
    assert.deepEqual(JSON.parse(calls[1].options.body).medications, [medicine]);
    assert.equal(JSON.parse(calls[2].options.body).expectedRevision, 3);
  } finally { restore(); }
});

test('encounter identity must match the selected appointment, date, and clinic', async () => {
  for (const changed of [
    { appointmentId: 'appointment-2' },
    { clinicDate: '2026-10-11' },
    { clinic: { slug: 'blesswell', displayName: 'Blesswell Clinic' } },
  ]) {
    const restore = mockFetch(async () => Response.json({ encounter: encounter(changed) }));
    try {
      await assert.rejects(readEncounter('goodwell', appointmentId, clinicDate, 'csrf'),
        (error) => error instanceof ConsultationApiError && error.status === null);
    } finally { restore(); }
  }
});

test('finalized print payload must match the encounter clinic, patient, doctor, date, and finalization time', async () => {
  const badPrints = [
    { clinic: { slug: 'blesswell', displayName: 'Blesswell Clinic' } },
    { patient: { id: 'patient-2', fullName: 'Other Patient', ageYears: 35, sex: 'female' } },
    { doctor: { id: 'doctor-2', displayName: 'Dr Other' } },
    { appointmentDate: '2026-10-11' },
    { finalizedAt: '2026-10-10T11:15:00+05:30' },
    { medications: [{ ...medicine, dose: 'Different dose' }] },
  ];
  for (const badPrint of badPrints) {
    const item = finalizedEncounter();
    item.printablePrescription = { ...item.printablePrescription, ...badPrint };
    const restore = mockFetch(async () => Response.json(item));
    try {
      await assert.rejects(readEncounter('goodwell', appointmentId, clinicDate, 'csrf'),
        (error) => error instanceof ConsultationApiError && error.status === null);
    } finally { restore(); }
  }
  const draftWithPrint = finalizedEncounter();
  draftWithPrint.encounter = encounter({ note, medications: [medicine] });
  const restoreDraft = mockFetch(async () => Response.json(draftWithPrint));
  try { await assert.rejects(readEncounter('goodwell', appointmentId, clinicDate, 'csrf'), ConsultationApiError); }
  finally { restoreDraft(); }
});

test('JSON authorization and conflict statuses survive, while non-JSON edge responses fail closed', async () => {
  for (const status of [401, 403, 409]) {
    const restore = mockFetch(async () => Response.json({ error: 'Denied or conflict' }, { status }));
    try {
      await assert.rejects(readEncounter('goodwell', appointmentId, clinicDate, 'csrf'),
        (error) => error instanceof ConsultationApiError && error.status === status);
    } finally { restore(); }
  }
  const restoreXml = mockFetch(async () => new Response('<Error>AccessDenied</Error>', {
    status: 403, headers: { 'Content-Type': 'application/xml' },
  }));
  try {
    await assert.rejects(readEncounter('goodwell', appointmentId, clinicDate, 'csrf'),
      (error) => error instanceof ConsultationApiError && error.status === null);
  } finally { restoreXml(); }
  const restoreHtml = mockFetch(async () => new Response('<html>Not an API</html>', {
    status: 200, headers: { 'Content-Type': 'text/html' },
  }));
  try { await assert.rejects(getConsultationQueue('goodwell', clinicDate), ConsultationApiError); }
  finally { restoreHtml(); }
});

test('invalid clinic, appointment, date, revision, and missing CSRF never reach the network', async () => {
  let calls = 0;
  const restore = mockFetch(async () => { calls += 1; return Response.json({}); });
  try {
    await assert.rejects(getConsultationQueue('../other', clinicDate), ConsultationApiError);
    await assert.rejects(getConsultationQueue('goodwell', '2026-02-30'), ConsultationApiError);
    await assert.rejects(readEncounter('goodwell', '', clinicDate, 'csrf'), ConsultationApiError);
    await assert.rejects(readEncounter('goodwell', appointmentId, clinicDate, ''), ConsultationApiError);
    await assert.rejects(saveVitals('goodwell', appointmentId, clinicDate, -1, { observedAt }, 'csrf'), ConsultationApiError);
    await assert.rejects(saveDraft('goodwell', appointmentId, clinicDate, 1.5, note, [medicine], 'csrf'), ConsultationApiError);
    await assert.rejects(saveDraft('goodwell', appointmentId, clinicDate, 1,
      { ...note, history: 'x'.repeat(18_000) }, [medicine], 'csrf'), ConsultationApiError);
    await assert.rejects(finalizeEncounter('goodwell', appointmentId, clinicDate, 0, 'csrf'), ConsultationApiError);
    assert.equal(calls, 0);
  } finally { restore(); }
});

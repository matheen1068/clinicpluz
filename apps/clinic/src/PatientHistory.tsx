import { useEffect, useMemo, useRef, useState } from 'react';
import { ConsultationApiError } from './consultationApi';
import { VITAL_FIELDS } from './consultationForm';
import {
  listPatientHistory, readPatientHistory,
  type HistoryContext, type HistoryDetail, type HistoryVisit,
} from './patientHistoryApi';

const NOTE_FIELDS = [
  { key: 'chiefComplaint', label: 'Chief complaint' },
  { key: 'history', label: 'History' },
  { key: 'exam', label: 'Examination' },
  { key: 'assessment', label: 'Assessment' },
  { key: 'plan', label: 'Plan' },
] as const;

interface Props extends HistoryContext {
  csrfToken: string;
  onSessionLost: () => void;
}

function clinicTime(value: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(value));
}

export default function PatientHistory({ clinicSlug, appointmentId, clinicDate, patientId, currentVisitAt, csrfToken, onSessionLost }: Props) {
  const context = useMemo(() => ({ clinicSlug, appointmentId, clinicDate, patientId, currentVisitAt }),
    [clinicSlug, appointmentId, clinicDate, patientId, currentVisitAt]);
  const [items, setItems] = useState<HistoryVisit[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState('');
  const [moreError, setMoreError] = useState('');
  const [cursorNeedsRefresh, setCursorNeedsRefresh] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [selected, setSelected] = useState<HistoryVisit | null>(null);
  const [detail, setDetail] = useState<HistoryDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [reload, setReload] = useState(0);
  const pageController = useRef<AbortController | null>(null);
  const detailController = useRef<AbortController | null>(null);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const sessionLostRef = useRef(onSessionLost);
  useEffect(() => { sessionLostRef.current = onSessionLost; }, [onSessionLost]);

  function handleAccessError(error: unknown): boolean {
    if (!(error instanceof ConsultationApiError)) return false;
    if (error.status === 401) {
      pageController.current?.abort(); detailController.current?.abort();
      setItems([]); setSelected(null); setDetail(null);
      sessionLostRef.current();
      return true;
    }
    if (error.status === 403) {
      pageController.current?.abort(); detailController.current?.abort();
      setItems([]); setSelected(null); setDetail(null); setNextCursor(null);
      setAccessDenied(true);
      return true;
    }
    return false;
  }

  useEffect(() => {
    const controller = new AbortController();
    pageController.current?.abort();
    detailController.current?.abort();
    setItems([]); setNextCursor(null); setSelected(null); setDetail(null);
    setAccessDenied(false); setListError(''); setMoreError(''); setCursorNeedsRefresh(false); setDetailError('');
    setLoading(true); setLoadingMore(false); setDetailLoading(false);
    void listPatientHistory(context, csrfToken, undefined, controller.signal).then((page) => {
      if (!controller.signal.aborted) { setItems(page.items); setNextCursor(page.nextCursor); }
    }).catch((error: unknown) => {
      if (!controller.signal.aborted && !handleAccessError(error)) {
        setListError(error instanceof ConsultationApiError && error.status === 404
          ? 'History is unavailable for this selected visit. Refresh the visit list.'
          : 'Previous visits could not be loaded. You can continue the current consultation.');
      }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [context, csrfToken, reload]);
  useEffect(() => () => { pageController.current?.abort(); detailController.current?.abort(); }, []);
  useEffect(() => { if (detail) detailHeading.current?.focus(); }, [detail]);

  function refreshHistory() {
    pageController.current?.abort();
    detailController.current?.abort();
    setNextCursor(null);
    setMoreError('');
    setCursorNeedsRefresh(false);
    setReload((value) => value + 1);
  }

  function requireFreshPage(message: string) {
    setNextCursor(null);
    setMoreError(message);
    setCursorNeedsRefresh(true);
  }

  async function loadMore() {
    if (!nextCursor || loadingMore || loading || accessDenied) return;
    const cursor = nextCursor;
    const controller = new AbortController();
    pageController.current?.abort(); pageController.current = controller;
    setLoadingMore(true); setMoreError('');
    try {
      const page = await listPatientHistory(context, csrfToken, cursor, controller.signal);
      if (controller.signal.aborted) return;
      const known = new Set(items.map((item) => item.historyId));
      if (page.items.some((item) => known.has(item.historyId))) {
        requireFreshPage('The next history page could not be verified. Refresh history to continue.');
        return;
      }
      if (items.length > 0 && page.items.length > 0 &&
          Date.parse(page.items[0].visitAt) > Date.parse(items[items.length - 1].visitAt)) {
        requireFreshPage('The older history page is out of order. Refresh history to continue.');
        return;
      }
      setItems([...items, ...page.items]); setNextCursor(page.nextCursor);
    } catch (error) {
      if (!controller.signal.aborted && !handleAccessError(error)) {
        if (error instanceof ConsultationApiError && error.status === 400) {
          requireFreshPage('The history page has expired. Refresh history to continue.');
        } else {
          setMoreError('Older visits could not be loaded. Retry when the service is available.');
        }
      }
    } finally { if (!controller.signal.aborted) setLoadingMore(false); }
  }

  async function openVisit(item: HistoryVisit) {
    if (accessDenied) return;
    detailController.current?.abort();
    const controller = new AbortController();
    detailController.current = controller;
    setSelected(item); setDetail(null); setDetailError(''); setDetailLoading(true);
    try {
      const value = await readPatientHistory(context, item, csrfToken, controller.signal);
      if (!controller.signal.aborted) setDetail(value);
    } catch (error) {
      if (!controller.signal.aborted && !handleAccessError(error)) {
        setDetailError(error instanceof ConsultationApiError && error.status === 404
          ? 'This finalized visit is no longer available. Refresh history.'
          : 'This visit could not be opened. Your current consultation is unchanged.');
      }
    } finally { if (!controller.signal.aborted) setDetailLoading(false); }
  }

  return <section className="workflow-card consultation-history" aria-labelledby="patient-history-heading">
    <div className="workflow-card-head"><div><span className="workflow-step">READ ONLY</span><h4 id="patient-history-heading">Previous finalized visits</h4></div><p>Earlier clinic visits for this patient. The current consultation stays separate.</p></div>
    <button type="button" className="workflow-link consultation-history-refresh" onClick={refreshHistory} disabled={loading}>Refresh history</button>
    <p className="consultation-history-intro">Only indexed, finalized visits appear in this synthetic pilot. Older unindexed records may be absent. This history does not provide clinical advice.</p>
    {accessDenied ? <p className="workflow-error" role="alert">Previous visits are unavailable for this staff assignment. The current consultation remains separate.</p>
      : loading ? <p className="workflow-muted" role="status">Loading previous finalized visits…</p>
      : listError ? <div className="workflow-error" role="alert"><p>{listError}</p><button type="button" className="workflow-link" onClick={refreshHistory}>Retry history</button></div>
      : items.length === 0 ? <p className="workflow-empty" role="status">No earlier finalized visits are available in this clinic’s pilot index.</p>
      : <div className="consultation-history-layout">
        <div className="consultation-history-list"><ul>{items.map((item) => <li key={item.historyId}><button type="button" className={`consultation-history-visit${selected?.historyId === item.historyId ? ' is-selected' : ''}`} aria-pressed={selected?.historyId === item.historyId} onClick={() => void openVisit(item)}><strong>{clinicTime(item.visitAt)}</strong><span>{item.doctor.displayName}</span><small>Finalized {clinicTime(item.finalizedAt)}</small></button></li>)}</ul>
          {nextCursor && <button type="button" className="workflow-link consultation-history-more" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? 'Loading older visits…' : 'Load older visits'}</button>}
          {moreError && <div className="workflow-error" role="alert"><p>{moreError}</p>{cursorNeedsRefresh && <button type="button" className="workflow-link" onClick={refreshHistory}>Refresh history to continue</button>}</div>}
        </div>
        <div className="consultation-history-detail">
          {!selected ? <p className="workflow-empty">Select a previous visit to view its finalized record.</p>
            : detailLoading ? <p className="workflow-muted" role="status">Loading finalized visit…</p>
            : detailError || !detail ? <div className="workflow-error" role="alert"><p>{detailError || 'The selected visit could not be verified.'}</p><button type="button" className="workflow-link" onClick={() => void openVisit(selected)}>Retry visit</button></div>
            : <><div className="consultation-history-detail-head"><h5 ref={detailHeading} tabIndex={-1}>Finalized visit · {clinicTime(detail.visitAt)}</h5><p>Doctor: {detail.doctor.displayName} · Finalized: {clinicTime(detail.finalizedAt)}</p></div>
              <div className="consultation-history-block"><h6>Recorded vitals</h6>{detail.vitals ? <><p>Observed {clinicTime(detail.vitals.observedAt)} · recorded by {detail.vitals.recordedByDisplayName} at {clinicTime(detail.vitals.recordedAt)}</p><dl>{VITAL_FIELDS.filter(({ key }) => detail.vitals?.[key] !== undefined).map(({ key, label, unit }) => <div key={key}><dt>{label}</dt><dd>{detail.vitals?.[key]} {unit}</dd></div>)}</dl></> : <p>No vitals recorded for this visit.</p>}</div>
              <div className="consultation-history-block"><h6>Doctor’s note</h6>{NOTE_FIELDS.map(({ key, label }) => <div className="consultation-history-note" key={key}><strong>{label}</strong><p>{detail.note[key] || 'Not recorded'}</p></div>)}</div>
              <div className="consultation-history-block"><h6>Doctor-entered prescriptions</h6>{detail.medications.length === 0 ? <p>No medicines recorded for this visit.</p> : <ol>{detail.medications.map((medicine, index) => <li key={index}><strong>{medicine.name} {medicine.strength}</strong><p>Dose: {medicine.dose} · Route: {medicine.route} · Frequency: {medicine.frequency} · Duration: {medicine.duration}</p><p>Instructions: {medicine.instructions}</p></li>)}</ol>}</div>
            </>}
        </div>
      </div>}
  </section>;
}

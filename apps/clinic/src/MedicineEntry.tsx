import { useEffect, useRef, useState } from 'react';
import { ConsultationApiError, searchMedicines, type MedicineCatalogItem, type Medication } from './consultationApi';

const DIRECTION_FIELDS = [
  { key: 'dose', label: 'Dose' },
  { key: 'route', label: 'Route' },
  { key: 'frequency', label: 'Frequency' },
  { key: 'duration', label: 'Duration' },
  { key: 'instructions', label: 'Instructions' },
] as const;

interface Props {
  clinicSlug: string;
  csrfToken: string;
  index: number;
  medicine: Medication;
  disabled: boolean;
  onChange: (medicine: Medication) => void;
  onRemove: () => void;
  onSessionLost: () => void;
}

export function MedicineEntry({ clinicSlug, csrfToken, index, medicine, disabled, onChange, onRemove, onSessionLost }: Props) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<MedicineCatalogItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState('');
  const sessionLostRef = useRef(onSessionLost);
  useEffect(() => { sessionLostRef.current = onSessionLost; }, [onSessionLost]);

  useEffect(() => {
    const term = query.trim().replace(/\s+/g, ' ');
    if (disabled || term.length < 2 || term.length > 64) {
      setItems([]); setSearching(false); setMessage('');
      return;
    }
    if (!/^[\p{L}\p{M}\p{N} .'-]+$/u.test(term)) {
      setItems([]); setSearching(false); setMessage('Use letters or numbers to search the clinic list.');
      return;
    }
    const controller = new AbortController();
    setItems([]); setSearching(true); setMessage('');
    const timer = window.setTimeout(() => {
      void searchMedicines(clinicSlug, term, csrfToken, controller.signal).then((results) => {
        if (controller.signal.aborted) return;
        setItems(results);
        setMessage(results.length ? '' : 'No match in this clinic’s list. Enter the medicine manually below.');
      }).catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ConsultationApiError && error.status === 401) { sessionLostRef.current(); return; }
        setItems([]);
        setMessage('Clinic medicine list unavailable. Enter the medicine manually below.');
      }).finally(() => { if (!controller.signal.aborted) setSearching(false); });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [clinicSlug, csrfToken, query, disabled]);

  function choose(item: MedicineCatalogItem) {
    onChange({ ...medicine, name: item.name, strength: item.strength });
    setQuery(''); setItems([]);
  }

  return <fieldset className="consultation-med">
    <legend>Medicine {index + 1}</legend>
    <div className="consultation-catalog">
      <label htmlFor={`medicine-search-${index}`}>Find in clinic medicine list</label>
      <input id={`medicine-search-${index}`} type="search" autoComplete="off" maxLength={64}
        placeholder="Search by name or strength" value={query} onChange={(event) => setQuery(event.target.value)} disabled={disabled} />
      {searching && <p role="status">Searching clinic list…</p>}
      {message && <p role="status">{message}</p>}
      {items.length > 0 && <div className="consultation-catalog-results" role="group" aria-label={`Medicine ${index + 1} search results`}>
        {items.map((item) => <button key={item.id} type="button" disabled={disabled} onClick={() => choose(item)}>
          <span><strong>{item.name}</strong><small>{item.strength}{item.favorite ? ' · Clinic favorite' : ''}</small></span>
          <span>Select</span>
        </button>)}
      </div>}
    </div>
    <p className="consultation-catalog-hint">Select an exact match above, or enter a medicine manually. The list does not suggest a treatment or dose.</p>
    <div className="consultation-med-fields">
      <label>Medicine name<input type="text" maxLength={160} required value={medicine.name}
        onChange={(event) => onChange({ ...medicine, name: event.target.value })} disabled={disabled} /></label>
      <label>Strength <span className="workflow-optional">optional</span><input type="text" maxLength={160} value={medicine.strength}
        onChange={(event) => onChange({ ...medicine, strength: event.target.value })} disabled={disabled} /></label>
      {DIRECTION_FIELDS.map(({ key, label }) => <label key={key}>{label}<input type="text" maxLength={key === 'instructions' ? 500 : 160}
        value={medicine[key]} onChange={(event) => onChange({ ...medicine, [key]: event.target.value })} disabled={disabled} /></label>)}
    </div>
    <button type="button" className="workflow-link" disabled={disabled} onClick={onRemove}>Remove medicine {index + 1}</button>
  </fieldset>;
}

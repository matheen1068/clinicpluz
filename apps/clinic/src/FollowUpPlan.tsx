import { addDaysIso, appendChip, followUpProblem, type FollowUpForm } from './consultationForm.ts';

const WHEN = [['1 week', 7], ['2 weeks', 14], ['1 month', 30], ['3 months', 90]] as const;
const PURPOSES = ['Review progress', 'Review reports', 'BP / sugar check', 'Wound check', 'Medicine review'];
const TESTS = ['Blood test report', 'Fasting sugar', 'Urine test', 'X-ray', 'ECG', 'Old prescriptions'];

export function formatDay(value: string): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
    .format(new Date(`${value}T00:00:00Z`));
}

interface Props {
  value: FollowUpForm;
  clinicDate: string;
  disabled: boolean;
  onChange: (value: FollowUpForm) => void;
}

export default function FollowUpPlan({ value, clinicDate, disabled, onChange }: Props) {
  const problem = followUpProblem(value, clinicDate);
  return <fieldset className="followup-plan" disabled={disabled}>
    <legend>Next visit <span className="workflow-optional">optional</span></legend>
    <p className="workflow-hint">Reception sees this to book the visit, and it prints on the prescription.</p>
    <div className="followup-chips" role="group" aria-label="Pick when to come back">
      {WHEN.map(([label, days]) => <button type="button" key={label}
        className={value.date === addDaysIso(clinicDate, days) ? 'chip is-on' : 'chip'}
        onClick={() => onChange({ ...value, date: addDaysIso(clinicDate, days) })}>After {label}</button>)}
    </div>
    <label>Follow-up date<input type="date" value={value.date} min={addDaysIso(clinicDate, 1)} max={addDaysIso(clinicDate, 365)}
      onChange={(event) => onChange({ ...value, date: event.target.value })} aria-invalid={!!problem} /></label>
    {value.date && <p className="followup-summary">Come back on <strong>{formatDay(value.date)}</strong>. <button type="button" className="workflow-link" onClick={() => onChange({ date: '', purpose: '', bring: '' })}>Remove follow-up</button></p>}
    {problem && <p className="workflow-error" role="alert">{problem}</p>}
    {value.date && <>
      <label>Purpose of the visit<input type="text" maxLength={300} value={value.purpose} placeholder="e.g. Review progress"
        onChange={(event) => onChange({ ...value, purpose: event.target.value })} /></label>
      <div className="followup-chips">{PURPOSES.map((item) => <button type="button" className="chip" key={item}
        onClick={() => onChange({ ...value, purpose: appendChip(value.purpose, item) })}>{item}</button>)}</div>
      <label>Tests / reports to bring<input type="text" maxLength={300} value={value.bring} placeholder="e.g. Fasting sugar, Blood test report"
        onChange={(event) => onChange({ ...value, bring: event.target.value })} /></label>
      <div className="followup-chips">{TESTS.map((item) => <button type="button" className="chip" key={item}
        onClick={() => onChange({ ...value, bring: appendChip(value.bring, item) })}>{item}</button>)}</div>
    </>}
  </fieldset>;
}

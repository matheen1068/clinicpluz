import { useEffect, useRef, useState } from 'react';
import { ConsultationApiError } from './consultationApi';
import { previewPrescriptionEmail, sendPrescriptionEmail, type EmailPreview, type EmailSendResult, type PrescriptionEmailSelection } from './prescriptionEmailApi';

interface Props {
  clinicSlug: string;
  csrfToken: string;
  selection: PrescriptionEmailSelection;
  onAccessError: (error: unknown) => boolean;
  onSendingChange: (sending: boolean) => void;
}

export default function PrescriptionEmail({ clinicSlug, csrfToken, selection, onAccessError, onSendingChange }: Props) {
  const [preview, setPreview] = useState<EmailPreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<EmailSendResult | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  const previewController = useRef<AbortController | null>(null);
  useEffect(() => () => previewController.current?.abort(), []);
  useEffect(() => { onSendingChange(sending); }, [sending, onSendingChange]);
  useEffect(() => () => onSendingChange(false), [onSendingChange]);

  async function checkStoredAddress() {
    if (previewLoading || sending) return;
    previewController.current?.abort();
    const controller = new AbortController();
    previewController.current = controller;
    setPreview(null); setConfirmed(false); setResult(null); setUncertain(false); setError(''); setPreviewLoading(true);
    try {
      const value = await previewPrescriptionEmail(clinicSlug, selection, csrfToken, controller.signal);
      if (!controller.signal.aborted) setPreview(value);
    } catch (caught) {
      if (controller.signal.aborted || onAccessError(caught)) return;
      setError(caught instanceof ConsultationApiError && caught.status === 409
        ? 'The stored patient email is missing or is not approved for this staging send. Use browser print; no email was sent.'
        : caught instanceof ConsultationApiError && caught.status === 503
          ? 'Patient email is unavailable in this staging clinic. Use browser print.'
          : caught instanceof ConsultationApiError && caught.status === 422
            ? 'This staging service cannot create the prescription PDF. Use browser print; no email was sent.'
          : 'The stored patient email could not be verified. No email has been sent.');
    } finally { if (!controller.signal.aborted) setPreviewLoading(false); }
  }

  async function send() {
    if (!preview || !confirmed || sending || result || uncertain) return;
    setSending(true); setError('');
    try {
      const value = await sendPrescriptionEmail(clinicSlug, selection, csrfToken, preview.recipientEmail);
      setResult(value); setConfirmed(false);
    } catch (caught) {
      if (onAccessError(caught)) return;
      setConfirmed(false);
      if (caught instanceof ConsultationApiError && caught.status === 409) {
        setPreview(null);
        setError('The stored patient email changed, is missing, or is not approved for this staging send. Check it again or use browser print; no email was confirmed.');
      } else if (caught instanceof ConsultationApiError && caught.status === 422) {
        setUncertain(true);
        setError('The staging service cannot create this prescription PDF. Use browser print; no email was confirmed.');
      } else {
        setUncertain(true);
        setError('Email outcome could not be confirmed. Do not send again until the clinic checks the delivery log. Browser print remains available.');
      }
    } finally { setSending(false); }
  }

  return <section className="prescription-email" aria-labelledby="prescription-email-heading">
    <h6 id="prescription-email-heading">Email finalized PDF to patient</h6>
    <p>This uses the patient email stored by the clinic. The server creates the PDF and chooses the recipient; this browser cannot change it.</p>
    {!preview && !result && !uncertain && <button type="button" className="workflow-link" onClick={() => void checkStoredAddress()} disabled={previewLoading || sending}>{previewLoading ? 'Checking stored email…' : 'Check stored patient email'}</button>}
    {preview && !result && !uncertain && <div className="prescription-email-confirm"><p>Stored patient email: <strong>{preview.recipientEmail}</strong></p><label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={sending} /> I checked this stored patient email for the selected finalized prescription.</label><button type="button" className="workflow-action" onClick={() => void send()} disabled={!confirmed || sending}>{sending ? 'Submitting email…' : 'Email PDF to stored address'}</button></div>}
    {result && <p className={result.status === 'unknown' ? 'workflow-error' : 'workflow-success'} role="status">{result.status === 'accepted' ? `AWS SES accepted the request for ${result.recipientMasked}. Delivery is not confirmed.` : result.status === 'pending' ? `Email request for ${result.recipientMasked} is still processing. Do not send again.` : `The email outcome for ${result.recipientMasked} is unknown. Check the clinic email log before any retry.`}</p>}
    {error && <p className="workflow-error" role="alert">{error}</p>}
  </section>;
}

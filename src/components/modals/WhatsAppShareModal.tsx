import React, { useState, useEffect } from 'react';
import { MessageSquare, ExternalLink, Copy, Check, X, Phone, User } from 'lucide-react';
import { useClinic } from '../../context/ClinicContext';
import { createWhatsAppUrl, sanitizeWhatsAppPhone } from '../../utils/whatsapp';

export const WhatsAppShareModal: React.FC = () => {
  const { whatsAppModal, closeWhatsAppModal, clinicSettings } = useClinic();
  const [phoneNumber, setPhoneNumber] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (whatsAppModal.phone) {
      setPhoneNumber(whatsAppModal.phone);
    }
  }, [whatsAppModal.phone]);

  if (!whatsAppModal.isOpen) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(whatsAppModal.message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const handleSendWhatsApp = () => {
    const url = createWhatsAppUrl(phoneNumber || whatsAppModal.phone, whatsAppModal.message);
    window.open(url, '_blank', 'noopener,noreferrer');
    if (whatsAppModal.onSent) {
      whatsAppModal.onSent();
    }
    closeWhatsAppModal();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div 
        id="whatsapp-share-dialog"
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-lg w-full overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="bg-emerald-700 px-6 py-4 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600/80 flex items-center justify-center text-white shadow-inner">
              <MessageSquare className="w-5 h-5 text-emerald-100" />
            </div>
            <div>
              <h3 className="font-semibold text-lg leading-tight flex items-center gap-2">
                Share via WhatsApp
              </h3>
              <p className="text-xs text-emerald-100 font-medium">
                {whatsAppModal.title || 'Instant Patient Dispatch'}
              </p>
            </div>
          </div>
          <button
            onClick={closeWhatsAppModal}
            className="text-emerald-200 hover:text-white hover:bg-emerald-600/50 p-1.5 rounded-lg transition-colors"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          {/* Recipient info */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2.5">
            <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
              <span className="flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-slate-400" />
                Patient: <strong className="text-slate-800">{whatsAppModal.recipientName}</strong>
              </span>
              <span className="bg-emerald-100 text-emerald-800 font-semibold px-2 py-0.5 rounded-full text-[11px]">
                Active Recipient
              </span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                WhatsApp Phone Number (with country code):
              </label>
              <div className="relative">
                <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="+91 98765 43210"
                  className="w-full pl-9 pr-3 py-1.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-mono text-slate-800"
                />
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                Cleaned international format: <code className="text-emerald-700 font-mono font-medium">+{sanitizeWhatsAppPhone(phoneNumber)}</code>
              </p>
            </div>
          </div>

          {/* Message Preview in WhatsApp styling */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                Message Preview
              </label>
              <button
                type="button"
                onClick={handleCopy}
                className="text-xs text-slate-600 hover:text-emerald-700 flex items-center gap-1 font-medium transition-colors"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied to clipboard' : 'Copy text'}
              </button>
            </div>

            {/* Chat Bubble Simulation */}
            <div className="bg-[#EFEAE2] p-3.5 rounded-xl border border-slate-300 shadow-inner">
              <div className="bg-white rounded-lg p-3 shadow-xs border-l-4 border-emerald-600 max-h-56 overflow-y-auto text-xs text-slate-800 whitespace-pre-wrap font-sans leading-relaxed">
                {whatsAppModal.message}
              </div>
              <div className="flex justify-end mt-1 text-[10px] text-slate-500 font-medium">
                Sent from {clinicSettings.name}
              </div>
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div className="bg-slate-50 border-t border-slate-200 px-6 py-3.5 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={closeWhatsAppModal}
            className="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200 rounded-lg transition-colors"
          >
            Cancel
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg flex items-center gap-1.5 transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </button>

            <button
              type="button"
              onClick={handleSendWhatsApp}
              className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 rounded-lg flex items-center gap-2 shadow-xs transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open in WhatsApp
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

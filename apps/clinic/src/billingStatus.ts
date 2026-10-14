import type { Episode } from './billingApi.ts';

export type BillingStage = 'awaiting_fee' | 'awaiting_consultation' | 'awaiting_pharmacy' | 'ready_for_checkout' | 'partly_paid' | 'paid';
export const BILLING_STAGE_LABELS: Record<BillingStage, string> = {
  awaiting_fee: 'Awaiting consultation fee',
  awaiting_consultation: 'Awaiting consultation',
  awaiting_pharmacy: 'Awaiting pharmacy',
  ready_for_checkout: 'Ready for checkout',
  partly_paid: 'Partly paid',
  paid: 'Paid receipt issued',
};

export function billingStage(episode: Episode): BillingStage {
  if (episode.receiptIssued) return 'paid';
  if (episode.checkoutStatus === 'awaiting_fee' || episode.consultationTotalPaise === 0) return 'awaiting_fee';
  if (episode.checkoutStatus === 'awaiting_consultation') return 'awaiting_consultation';
  if (episode.checkoutStatus === 'awaiting_pharmacy' || episode.pharmacyDisposition === 'awaiting' || episode.pharmacyDisposition === 'open') return 'awaiting_pharmacy';
  if (episode.paidPaise > 0 && episode.outstandingPaise > 0) return 'partly_paid';
  return 'ready_for_checkout';
}

export function mayRequestReceipt(episode: Episode): boolean {
  return !episode.receiptIssued && episode.consultationTotalPaise > 0 && episode.totalPaise > 0 && episode.outstandingPaise === 0 &&
    episode.checkoutStatus === 'ready_for_checkout' &&
    (episode.pharmacyDisposition === 'not_required' || episode.pharmacyDisposition === 'closed');
}

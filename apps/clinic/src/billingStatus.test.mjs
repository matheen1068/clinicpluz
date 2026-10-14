import assert from 'node:assert/strict';
import test from 'node:test';
import { billingStage, mayRequestReceipt } from './billingStatus.ts';

const base = { receiptIssued: false, checkoutStatus: 'ready_for_checkout', pharmacyDisposition: 'not_required', consultationTotalPaise: 200000, totalPaise: 200000, paidPaise: 0, outstandingPaise: 200000 };

test('a fully prepaid fee is still awaiting pharmacy when new charges can arrive', () => {
  const episode = { ...base, checkoutStatus: 'awaiting_pharmacy', pharmacyDisposition: 'open', paidPaise: 200000, outstandingPaise: 0 };
  assert.equal(billingStage(episode), 'awaiting_pharmacy');
  assert.equal(mayRequestReceipt(episode), false);
});

test('paid is shown only after an issued receipt and balance/disposition gates receipt request', () => {
  assert.equal(billingStage({ ...base, checkoutStatus: 'paid', paidPaise: 200000, outstandingPaise: 0 }), 'ready_for_checkout');
  assert.equal(mayRequestReceipt({ ...base, paidPaise: 200000, outstandingPaise: 0 }), true);
  assert.equal(mayRequestReceipt({ ...base, consultationTotalPaise: 0, paidPaise: 0, outstandingPaise: 0 }), false);
  assert.equal(billingStage({ ...base, receiptIssued: true, paidPaise: 200000, outstandingPaise: 0 }), 'paid');
  assert.equal(mayRequestReceipt({ ...base, receiptIssued: true, paidPaise: 200000, outstandingPaise: 0 }), false);
  assert.equal(billingStage({ ...base, paidPaise: 50000, outstandingPaise: 150000 }), 'partly_paid');
});

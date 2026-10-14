import assert from 'node:assert/strict';
import test from 'node:test';
import { formatPaise, rupeesToPaise } from './billingMoney.ts';

test('billing money uses integer paise and readable INR', () => {
  assert.equal(formatPaise(200_000), '₹2,000.00');
  assert.equal(formatPaise(0), '₹0.00');
  assert.equal(rupeesToPaise('2000'), 200_000);
  assert.equal(rupeesToPaise('12.3'), 1_230);
  assert.equal(rupeesToPaise('12.34'), 1_234);
});

test('billing money rejects extra decimals, negative, and unsafe amounts', () => {
  for (const value of ['-1', '1.234', '1e3', 'NaN', '', '01', '1,000']) {
    assert.equal(rupeesToPaise(value), null);
  }
  assert.equal(rupeesToPaise('90071992547410'), null);
  assert.throws(() => formatPaise(-1), RangeError);
  assert.throws(() => formatPaise(1.5), RangeError);
});

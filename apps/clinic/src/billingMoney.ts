const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2,
});

export function formatPaise(paise: number): string {
  if (!Number.isSafeInteger(paise) || paise < 0) throw new RangeError('Invalid paise amount');
  return inr.format(paise / 100);
}

export function rupeesToPaise(value: string): number | null {
  const text = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(text)) return null;
  const [rupees, fraction = ''] = text.split('.');
  const paise = Number(rupees) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(paise) ? paise : null;
}

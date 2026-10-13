import assert from 'node:assert/strict';
import test from 'node:test';
import { medicationTimingText } from './medicationDirections.ts';

const base = { name: 'Synthetic medicine', strength: '', dose: '1 tablet', route: 'oral',
  frequency: '', duration: '3 days', instructions: 'Synthetic instruction', timing: null };

test('structured timing displays the doctor-selected times and food relation verbatim', () => {
  assert.equal(medicationTimingText({ ...base, timing: { timesOfDay: ['morning', 'night'], mealRelation: 'after' } }),
    'Morning, Night · After food');
  assert.equal(medicationTimingText({ ...base, timing: { timesOfDay: ['afternoon'], mealRelation: 'unspecified' } }),
    'Afternoon · Food timing not specified');
});

test('older prescriptions retain the manually entered frequency', () => {
  assert.equal(medicationTimingText({ ...base, frequency: 'Every six hours' }), 'Custom frequency: Every six hours');
});

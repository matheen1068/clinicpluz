import assert from 'node:assert/strict';
import test from 'node:test';
import { matchingAllergies, parseAllergyInput } from './allergyCheck.ts';

test('matches medicine names against recorded allergy text, case-insensitively and by word', () => {
  assert.deepEqual(matchingAllergies('Amoxicillin', ['amoxicillin']), ['amoxicillin']);
  assert.deepEqual(matchingAllergies('Amoxicillin 500', ['Amoxicillin', 'Peanut oil']), ['Amoxicillin']);
  assert.deepEqual(matchingAllergies('Synthetic Penicillin V', ['penicillin']), ['penicillin']);
});

test('does not claim safety: unrelated or class-level allergies are simply not matched', () => {
  assert.deepEqual(matchingAllergies('Amoxicillin', ['Penicillin']), []);
  assert.deepEqual(matchingAllergies('Paracetamol', ['Peanut oil']), []);
  assert.deepEqual(matchingAllergies('Paracetamol', []), []);
  assert.deepEqual(matchingAllergies('Paracetamol', null), []);
  assert.deepEqual(matchingAllergies('', ['Penicillin']), []);
});

test('allergy input splits on commas, semicolons and new lines', () => {
  assert.deepEqual(parseAllergyInput(' Penicillin ,  Peanut   oil;Latex\n'), ['Penicillin', 'Peanut oil', 'Latex']);
  assert.deepEqual(parseAllergyInput('  '), []);
});

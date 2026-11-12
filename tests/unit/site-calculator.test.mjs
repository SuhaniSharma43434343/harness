// The savings calculator's arithmetic (starters/astro-base/src/lib/calculator.mjs), which the
// APP-01/SavingsCalculator section runs at build time and in the browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check, compute, explain, format } from '../../starters/astro-base/src/lib/calculator.mjs';

const inputs = [
  { name: 'hours', label: 'Hours a week' },
  { name: 'rate', label: 'Hourly rate' },
];

test('a formula is a sum of products of inputs and plain numbers', () => {
  assert.equal(compute([['hours', 'rate', 52, 0.5]], { hours: 5, rate: 40 }), 5200);
  assert.equal(compute([['hours', 52], ['rate', -1]], { hours: 2, rate: 4 }), 100);
  assert.equal(compute([[12]], {}), 12);
});

test('a missing or non-numeric input gives NaN, never a made-up number', () => {
  assert.ok(Number.isNaN(compute([['hours', 'rate']], { hours: 5 })));
  assert.ok(Number.isNaN(compute([['hours']], { hours: 'lots' })));
});

test('results are formatted in the page language with a prefix, suffix and decimals', () => {
  assert.equal(format(5200, { prefix: '£' }, 'en'), '£5,200');
  assert.equal(format(1234.5, { suffix: ' kWh', decimals: 1 }, 'en'), '1,234.5 kWh');
  assert.equal(format(1234.567, {}, 'de'), '1.235');
});

test('the formula is explained in words, with the inputs\' labels', () => {
  assert.equal(explain([['hours', 'rate', 52]], inputs), 'Hours a week × Hourly rate × 52');
  assert.equal(explain([['hours'], [10]], inputs), 'Hours a week + 10');
});

test('check names every factor that is not a number or an input', () => {
  assert.deepEqual(check([['hours', 'rate', 52]], inputs), []);
  assert.deepEqual(check([['hours', 'rat']], inputs), ['formula factor "rat" is not a number or an input name']);
  assert.equal(check([], inputs).length, 1);
  assert.equal(check([[]], inputs).length, 1);
  assert.equal(check([['hours', null]], inputs).length, 1);
});

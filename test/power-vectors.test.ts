import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { minHoursToDistinguish, powerTwoRates } from '../src/index.js';

// Shared with python/tests/test_power_vectors.py so both implementations are checked against the same cases.
const fx = JSON.parse(
  readFileSync(new URL('./fixtures/power-vectors.json', import.meta.url), 'utf8'),
) as any;

const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-9 * Math.max(1, Math.abs(b)));

describe('shared power vectors', () => {
  for (const v of fx.powerTwoRates) {
    it(`powerTwoRates(${v.rate1}, ${v.rate2}, ${v.hours}, ${v.alpha ?? 0.05})`, () => {
      near(powerTwoRates(v.rate1, v.rate2, v.hours, v.alpha), v.value);
    });
  }
  it('powerTwoRates rejects non-positive input', () => {
    for (const v of fx.powerTwoRatesThrows) expect(() => powerTwoRates(v.rate1, v.rate2, v.hours)).toThrow(RangeError);
  });
  for (const v of fx.minHoursToDistinguish) {
    it(`minHoursToDistinguish(${v.rate1}, ${v.rate2}, ${JSON.stringify(v.options)})`, () => {
      near(minHoursToDistinguish(v.rate1, v.rate2, v.options), v.value);
    });
  }
  it('minHoursToDistinguish rejects bad input', () => {
    for (const v of fx.minHoursToDistinguishThrows) {
      expect(() => minHoursToDistinguish(v.rate1, v.rate2, v.options)).toThrow(RangeError);
    }
  });
});

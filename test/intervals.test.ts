import { describe, expect, it } from 'vitest';
import {
  casesForPrecision,
  dart,
  dartInterval,
  minHoursToDistinguish,
  poissonExactInterval,
  powerTwoRates,
  rateInterval,
  trir,
  trirInterval,
  type CaseCounts,
} from '../src/index.js';

// Reference values were computed independently of this code in Python (no
// scipy): chi-square quantiles by bisection on the regularized incomplete gamma
// function, lower = chi2(a/2; 2k)/2, upper = chi2(1-a/2; 2k+2)/2. They agree
// with the published Garwood limits for 0, 1 and 10 events (3.689; 0.0253 to
// 5.572; 4.795 to 18.390).
const REFERENCE_95: Array<[number, number, number]> = [
  [0, 0, 3.688879454],
  [1, 0.02531780798, 5.571643391],
  [2, 0.2422092785, 7.224687668],
  [5, 1.62348639, 11.66833208],
  [10, 4.795388696, 18.39035604],
  [35, 24.3787824, 48.67652737],
  [100, 81.36399125, 121.6267938],
];

describe('poissonExactInterval', () => {
  it.each(REFERENCE_95)('matches the reference limits for k=%i', (k, lo, hi) => {
    const [l, u] = poissonExactInterval(k);
    expect(l).toBeCloseTo(lo, 6);
    expect(u).toBeCloseTo(hi, 6);
  });

  it('matches reference limits at other confidence levels', () => {
    const [l99, u99] = poissonExactInterval(3, 0.99);
    expect(l99).toBeCloseTo(0.3378633887, 8);
    expect(u99).toBeCloseTo(10.9774775, 6);
    const [l90, u90] = poissonExactInterval(3, 0.9);
    expect(l90).toBeCloseTo(0.8176914472, 8);
    expect(u90).toBeCloseTo(7.753656528, 7);
  });

  it('rejects invalid input', () => {
    expect(() => poissonExactInterval(-1)).toThrow(RangeError);
    expect(() => poissonExactInterval(1.5)).toThrow(RangeError);
    expect(() => poissonExactInterval(1, 1)).toThrow(RangeError);
    expect(() => poissonExactInterval(1, 0)).toThrow(RangeError);
  });
});

describe('rate intervals', () => {
  const cases: CaseCounts = { deaths: 0, daysAwayCases: 3, jobTransferCases: 2, otherRecordableCases: 7 };

  it('scales the count interval by 200,000 / hours', () => {
    const r = rateInterval(10, 400_000);
    expect(r.rate).toBeCloseTo(5, 12);
    expect(r.lower).toBeCloseTo(4.795388696 / 2, 8);
    expect(r.upper).toBeCloseTo(18.39035604 / 2, 8);
  });

  it('brackets the point estimate and agrees with trir()/dart()', () => {
    const t = trirInterval(cases, { employeeHours: 480_000 });
    expect(t.rate).toBeCloseTo(trir(cases, { employeeHours: 480_000 }).value!, 12);
    expect(t.lower).toBeLessThan(t.rate);
    expect(t.upper).toBeGreaterThan(t.rate);
    const d = dartInterval(cases, { employeeHours: 480_000 });
    expect(d.rate).toBeCloseTo(dart(cases, { employeeHours: 480_000 }).value!, 12);
    expect(d.cases).toBe(5);
  });

  it('honours the contractor basis', () => {
    const h = { employeeHours: 400_000, contractorHours: 400_000 };
    expect(trirInterval(cases, h).hours).toBe(400_000);
    expect(trirInterval(cases, h, { contractorBasis: 'combined' }).hours).toBe(800_000);
  });

  it('gives a finite upper bound, not a point, for zero cases', () => {
    const r = rateInterval(0, 200_000);
    expect(r.rate).toBe(0);
    expect(r.lower).toBe(0);
    expect(r.upper).toBeCloseTo(3.688879454, 8);
  });

  it('rejects non-positive hours', () => {
    expect(() => rateInterval(1, 0)).toThrow(RangeError);
  });
});

describe('casesForPrecision', () => {
  it('finds the smallest count with upper/lower <= 2 (35; ratio 1.9967 at 35)', () => {
    expect(casesForPrecision(2)).toBe(35);
    const [l, u] = poissonExactInterval(34);
    expect(u / l).toBeGreaterThan(2);
  });
  it('needs 99 cases for a ratio of 1.5', () => {
    expect(casesForPrecision(1.5)).toBe(99);
  });
});

describe('powerTwoRates / minHoursToDistinguish', () => {
  it('matches exact power from an independent brute-force joint-Poisson sum', () => {
    // Python: sum over all (x1,x2) of Poisson pmf where the exact two-sided
    // binomial p-value is <= 0.05.
    expect(powerTwoRates(5, 10, 50_000)).toBeCloseTo(0.013784590126, 9);
    expect(powerTwoRates(5, 10, 100_000)).toBeCloseTo(0.068960675534, 9);
    expect(powerTwoRates(5, 10, 200_000)).toBeCloseTo(0.177970961288, 9);
    expect(powerTwoRates(4.131574224094077, 8.263148448188154, 595_345.0369606849)).toBeCloseTo(
      0.4652810741384848,
      9,
    );
  });

  it('returns hours that reach, and a step below that miss, 80% power', () => {
    const h = minHoursToDistinguish(5, 10);
    expect(powerTwoRates(5, 10, h)).toBeGreaterThanOrEqual(0.8);
    expect(powerTwoRates(5, 10, h / 1.01)).toBeLessThan(0.8);
    // An independent brute-force 1%-step search (different grid, from 1,000 h) gave 997,776.8.
    expect(h).toBeGreaterThan(900_000);
    expect(h).toBeLessThan(1_100_000);
  });

  it('is symmetric in the two rates and grows as the gap shrinks', () => {
    const a = minHoursToDistinguish(5, 10);
    expect(minHoursToDistinguish(10, 5)).toBeCloseTo(a, 6);
    expect(minHoursToDistinguish(5, 7.5)).toBeGreaterThan(a);
  });

  it('works for non-default power and alpha', () => {
    const h = minHoursToDistinguish(5, 10, { power: 0.9, alpha: 0.1 });
    expect(powerTwoRates(5, 10, h, 0.1)).toBeGreaterThanOrEqual(0.9);
  });

  it('rejects equal or non-positive rates', () => {
    expect(() => minHoursToDistinguish(5, 5)).toThrow(RangeError);
    expect(() => minHoursToDistinguish(0, 5)).toThrow(RangeError);
  });
});

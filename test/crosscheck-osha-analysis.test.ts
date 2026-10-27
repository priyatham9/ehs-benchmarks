import { describe, expect, it } from 'vitest';
import { casesForPrecision, minHoursToDistinguish, powerTwoRates, rateInterval } from '../src/index.js';

/**
 * Cross-check against the independent Python implementation in
 * priyatham9/ehs-osha-analysis (commit 2f636ee, "F2: rate detectability
 * planner"), file outputs/tables/detectability_by_size_band.csv. Values below
 * are copied verbatim from that committed table. Mean hours per filing is
 * mean_hours_per_filing; "hours for 80% power" is site_years_per_arm x
 * mean_hours_per_filing (ratio 2 column).
 */
const ROWS = [
  {
    band: '001-019', trir: 4.938927266334603, hours: 15710.055890744732,
    zeroUpper: 46.962015663956564, siteYears2x: 64.64618616412922, power1: 0.0001082419589739633,
  },
  {
    band: '250-499', trir: 4.131574224094077, hours: 595345.0369606849,
    zeroUpper: 1.2392408519759073, siteYears2x: 2.039242963110798, power1: 0.46528107413848563,
  },
  {
    band: '1000+', trir: 3.1425407115071806, hours: 4598278.183918371,
    zeroUpper: 0.16044611946337264, siteYears2x: 0.3471179842098617, power1: 0.9984157776898892,
  },
] as const;

describe('agreement with ehs-osha-analysis detectability table', () => {
  it('uses the same 35-case precision threshold (upper/lower <= 2)', () => {
    expect(casesForPrecision(2)).toBe(35);
  });

  it.each(ROWS)('zero-case upper bound, band $band', (r) => {
    expect(rateInterval(0, r.hours).upper).toBeCloseTo(r.zeroUpper, 8);
  });

  it.each(ROWS)('exact power for one site-year each at 2x, band $band', (r) => {
    expect(powerTwoRates(r.trir, 2 * r.trir, r.hours)).toBeCloseTo(r.power1, 9);
  });

  it.each(ROWS)('minHoursToDistinguish at 2x, band $band', (r) => {
    const expected = r.siteYears2x * r.hours;
    expect(minHoursToDistinguish(r.trir, 2 * r.trir) / expected).toBeCloseTo(1, 9);
  });
});

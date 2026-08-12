import { describe, expect, it } from 'vitest';
import {
  buildDistribution,
  percentile,
  rankAgainst,
  sizeBandFor,
  type BenchmarkDistribution,
} from '../src/index.js';

describe('sizeBandFor', () => {
  it.each([
    [20, '20-49'],
    [49, '20-49'],
    [50, '50-99'],
    [99, '50-99'],
    [100, '100-249'],
    [250, '250-499'],
    [500, '500-999'],
    [1000, '1000+'],
    [50_000, '1000+'],
  ])('assigns %i employees to %s', (employees, band) => {
    expect(sizeBandFor(employees)).toBe(band);
  });

  it('returns null below the ITA reporting threshold of 20', () => {
    expect(sizeBandFor(19)).toBeNull();
  });

  it('returns null for non-finite input', () => {
    expect(sizeBandFor(Number.NaN)).toBeNull();
  });
});

describe('percentile', () => {
  const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  it('returns the max at p100', () => {
    expect(percentile(data, 100)).toBe(10);
  });

  it('returns the min at p0', () => {
    expect(percentile(data, 0)).toBe(1);
  });

  it('uses nearest-rank, never inventing an unobserved value', () => {
    // With zero-inflated data, interpolation would produce values nobody reported.
    const zeroHeavy = [0, 0, 0, 0, 0, 0, 10, 20, 30, 40];
    expect(zeroHeavy).toContain(percentile(zeroHeavy, 50));
    expect(percentile(zeroHeavy, 50)).toBe(0);
  });

  it('rejects an out-of-range percentile', () => {
    expect(() => percentile(data, 101)).toThrow(RangeError);
    expect(() => percentile(data, -1)).toThrow(RangeError);
  });

  it('rejects an empty array rather than returning undefined', () => {
    expect(() => percentile([], 50)).toThrow(RangeError);
  });
});

describe('buildDistribution', () => {
  const rates = [0, 0, 0, 1, 2, 3, 4, 5, 6, 20];

  const dist = buildDistribution(rates, {
    naics: '325',
    sizeBand: 'all',
    totalCases: 41,
    totalHours: 2_000_000,
  });

  it('records the peer group size', () => {
    expect(dist.n).toBe(10);
  });

  it('computes the zero rate', () => {
    expect(dist.zeroRate).toBeCloseTo(0.3, 10);
  });

  it('produces monotonically non-decreasing percentiles', () => {
    const p = dist.percentiles;
    expect(p.p10).toBeLessThanOrEqual(p.p25);
    expect(p.p25).toBeLessThanOrEqual(p.p50);
    expect(p.p50).toBeLessThanOrEqual(p.p75);
    expect(p.p75).toBeLessThanOrEqual(p.p90);
    expect(p.p90).toBeLessThanOrEqual(p.p95);
    expect(p.p95).toBeLessThanOrEqual(p.p99);
  });

  it('computes an hours-weighted aggregate distinct from the median', () => {
    expect(dist.aggregate).toBeCloseTo((41 * 200_000) / 2_000_000, 10);
    expect(dist.aggregate).not.toBe(dist.percentiles.p50);
  });

  it('does not mutate the caller’s array', () => {
    const input = [5, 1, 3];
    buildDistribution(input, { naics: '1', sizeBand: 'all', totalCases: 1, totalHours: 1 });
    expect(input).toEqual([5, 1, 3]);
  });

  it('rejects an empty rate set', () => {
    expect(() =>
      buildDistribution([], { naics: '325', sizeBand: 'all', totalCases: 0, totalHours: 0 }),
    ).toThrow(RangeError);
  });
});

describe('rankAgainst', () => {
  // Mirrors the real CY2025 NAICS 325 distribution measured from the ITA file.
  const chem: BenchmarkDistribution = {
    naics: '325',
    sizeBand: 'all',
    n: 5055,
    percentiles: { p10: 0, p25: 0, p50: 0.84, p75: 3.06, p90: 6.03, p95: 8.88, p99: 18.24 },
    zeroRate: 0.421,
    aggregate: 2.1,
  };

  it('ranks a zero rate at the midpoint of the zero mass', () => {
    expect(rankAgainst(0, chem).percentileRank).toBeCloseTo(21.05, 2);
  });

  it('does not claim a zero rate is best-in-class', () => {
    const r = rankAgainst(0, chem);
    expect(r.interpretation).toContain('42.1%');
    expect(r.interpretation).toMatch(/not by itself evidence/);
  });

  it('ranks the median rate at 50', () => {
    expect(rankAgainst(0.84, chem).percentileRank).toBeCloseTo(50, 5);
  });

  it('ranks a rate above p99 at 99', () => {
    expect(rankAgainst(100, chem).percentileRank).toBe(99);
  });

  it('interpolates between breakpoints', () => {
    const mid = rankAgainst((0.84 + 3.06) / 2, chem).percentileRank;
    expect(mid).toBeGreaterThan(50);
    expect(mid).toBeLessThan(75);
  });

  it('is monotonic — a worse rate never ranks better', () => {
    const probes = [0.5, 1, 2, 3, 5, 7, 10, 15, 20];
    const ranks = probes.map((p) => rankAgainst(p, chem).percentileRank);
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i] as number).toBeGreaterThanOrEqual(ranks[i - 1] as number);
    }
  });

  it('always returns a rank within 0-100', () => {
    for (const p of [0, 0.01, 1, 50, 1000]) {
      const r = rankAgainst(p, chem).percentileRank;
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(100);
    }
  });

  it('cannot rank a non-zero rate in the best quartile when 42.1% report zero', () => {
    // Any rate above 0 is worse than every zero-reporting peer, so the best
    // achievable rank here is bounded below by the zero mass.
    const rank = rankAgainst(0.3, chem).percentileRank;
    expect(rank).toBeGreaterThan(chem.zeroRate * 100);
    expect(rankAgainst(0.3, chem).interpretation).not.toContain('best quartile');
  });

  it('describes a top-quartile rate as such in a distribution without zero inflation', () => {
    const spread: BenchmarkDistribution = {
      naics: '236',
      sizeBand: 'all',
      n: 1000,
      percentiles: { p10: 0.5, p25: 1.0, p50: 2.0, p75: 3.5, p90: 5.0, p95: 7.0, p99: 12.0 },
      zeroRate: 0,
      aggregate: 2.4,
    };
    expect(rankAgainst(0.6, spread).interpretation).toContain('best quartile');
  });

  it('keeps interpolation monotonic even when low percentiles sit inside the zero mass', () => {
    // Regression: p10 and p25 are both 0 here while zeroRate is 42.1%. Including
    // those points made the breakpoint list non-monotonic in percentile.
    const probes = [0.1, 0.4, 0.84, 1.5, 3.06, 5, 6.03];
    const ranks = probes.map((p) => rankAgainst(p, chem).percentileRank);
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i] as number).toBeGreaterThanOrEqual(ranks[i - 1] as number);
    }
    expect(ranks[0] as number).toBeGreaterThanOrEqual(42.1);
  });

  it('describes a bottom-quartile rate as such', () => {
    expect(rankAgainst(12, chem).interpretation).toContain('worst quartile');
  });

  it('rejects a negative rate', () => {
    expect(() => rankAgainst(-1, chem)).toThrow(RangeError);
  });

  it('handles a distribution with no zeros without dividing by zero', () => {
    const noZeros: BenchmarkDistribution = { ...chem, zeroRate: 0, percentiles: { ...chem.percentiles, p10: 0.2, p25: 0.5 } };
    expect(rankAgainst(0, noZeros).percentileRank).toBeGreaterThanOrEqual(0);
  });
});

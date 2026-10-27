import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  poissonExactInterval,
  priorFromCsv,
  selectPeerGroup,
  whereDoIRank,
  type BenchmarkDistribution,
  type GammaPoissonPrior,
  type StoredPeerGroup,
} from '../src/index.js';

// Hand-built peer distribution: 20% zeros, then breakpoints (value -> percentile)
// 1 -> 25, 2 -> 50, 4 -> 75, 8 -> 90, 10 -> 95, 20 -> 99. Rank interpolates linearly between them.
const DIST: BenchmarkDistribution = {
  naics: '99', sizeBand: 'all', n: 1000, zeroRate: 0.2, aggregate: 3,
  percentiles: { p10: 0, p25: 1, p50: 2, p75: 4, p90: 8, p95: 10, p99: 20 },
};
// Gamma(shape 2, rate 1): mean 2 per 200,000 hours; one exposure unit = 200,000 hours.
const PRIOR: GammaPoissonPrior = {
  mean: 2, shape: 2, rate: 1, dispersion: 0.5, sites: 1000, totalCases: 0, totalHours: 0,
};

describe('whereDoIRank, hand-calculated', () => {
  it('4 cases in 400,000 hours: shrunk (2+4)/(1+2) = 2 sits at the median breakpoint', () => {
    const r = whereDoIRank({ cases: 4, hours: 400_000, prior: PRIOR, distribution: DIST });
    expect(r.raw).toBe(2);
    expect(r.shrunk).toBeCloseTo(2, 12);
    expect(r.weight).toBeCloseTo(1 / 3, 12);
    expect(r.percentile).toBeCloseTo(50, 9);
    expect(r.rawPercentile).toBeCloseTo(50, 9);
    expect(r.peerSites).toBe(1000);
  });

  it('1 case in 200,000 hours: shrunk (2+1)/(1+1) = 1.5, halfway from 1 (25) to 2 (50) gives 37.5', () => {
    const r = whereDoIRank({ cases: 1, hours: 200_000, prior: PRIOR, distribution: DIST });
    expect(r.shrunk).toBeCloseTo(1.5, 12);
    expect(r.percentile).toBeCloseTo(37.5, 9);
    expect(r.rawPercentile).toBeCloseTo(25, 9);
  });

  it('the Garwood range is the exact interval scaled to the rate basis', () => {
    const r = whereDoIRank({ cases: 4, hours: 400_000, prior: PRIOR, distribution: DIST });
    const [lo, hi] = poissonExactInterval(4);
    expect(r.garwood[0]).toBeCloseTo(lo / 2, 9);
    expect(r.garwood[1]).toBeCloseTo(hi / 2, 9);
    // Reference Garwood limits for 4 events: 1.0898650 and 10.2416 (to 4 d.p.)
    expect(r.garwood[0]).toBeCloseTo(1.08987 / 2, 4);
    expect(r.garwood[1]).toBeCloseTo(10.2416 / 2, 3);
  });

  it('keeps point <= credible bounds in rate and in percentile, and the credible range is narrower', () => {
    const r = whereDoIRank({ cases: 3, hours: 300_000, prior: PRIOR, distribution: DIST });
    expect(r.credible[0]).toBeLessThan(r.shrunk);
    expect(r.credible[1]).toBeGreaterThan(r.shrunk);
    expect(r.percentileRange[0]).toBeLessThanOrEqual(r.percentile);
    expect(r.percentileRange[1]).toBeGreaterThanOrEqual(r.percentile);
    expect(r.garwood[1] - r.garwood[0]).toBeGreaterThan(r.credible[1] - r.credible[0]);
  });

  it('pulls a tiny-exposure zero up off the best-in-class end', () => {
    const r = whereDoIRank({ cases: 0, hours: 20_000, prior: PRIOR, distribution: DIST });
    expect(r.raw).toBe(0);
    expect(r.rawPercentile).toBeCloseTo(10, 9); // midpoint of the 20% zero mass
    expect(r.shrunk).toBeCloseTo(2 / 1.1, 12);
    expect(r.percentile).toBeGreaterThan(25);
  });

  it('the caveat states direction, the range, the shrink weight and the limits', () => {
    const r = whereDoIRank({ cases: 4, hours: 400_000, prior: PRIOR, distribution: DIST });
    expect(r.caveat).toContain('Lower is better');
    expect(r.caveat).toContain('33% of the way');
    expect(r.caveat).toContain('not a safety rating');
  });

  it('rejects invalid input', () => {
    expect(() => whereDoIRank({ cases: -1, hours: 1000, prior: PRIOR, distribution: DIST })).toThrow(RangeError);
    expect(() => whereDoIRank({ cases: 1, hours: 0, prior: PRIOR, distribution: DIST })).toThrow(RangeError);
  });
});

function group(n: number): StoredPeerGroup {
  return { n, zeroRate: 0.2, trir: { p10: 0, p25: 1, p50: 2, p75: 4, p90: 8, p95: 10, p99: 20, aggregate: 3 } };
}

describe('selectPeerGroup', () => {
  const groups = { '23|all': group(100), '23|50-99': group(40), '236|all': group(60), '236220|all': group(10) };

  it('prefers the full code, then coarser codes', () => {
    expect(selectPeerGroup(groups, '236220')?.key).toBe('236220|all');
    expect(selectPeerGroup(groups, '236118')?.key).toBe('236|all');
    expect(selectPeerGroup(groups, '237110')?.key).toBe('23|all');
    expect(selectPeerGroup(groups, '236118')?.note).toContain('used NAICS 236');
    expect(selectPeerGroup(groups, '236220')?.note).toBeNull();
  });

  it('matches the size band first, across NAICS levels', () => {
    const c = selectPeerGroup(groups, '236220', 60);
    expect(c?.key).toBe('23|50-99');
    expect(c?.distribution.n).toBe(40);
  });

  it('falls back to all sizes when the band is absent, and says so', () => {
    const c = selectPeerGroup(groups, '236220', 700);
    expect(c?.key).toBe('236220|all');
    expect(c?.note).toContain('500-999');
    expect(selectPeerGroup(groups, '236220', 5)?.note).toContain('fewer than 20');
  });

  it('returns null for an unknown sector and rejects malformed codes', () => {
    expect(selectPeerGroup(groups, '31')).toBeNull();
    expect(() => selectPeerGroup(groups, '2')).toThrow(RangeError);
    expect(() => selectPeerGroup(groups, 'abc')).toThrow(RangeError);
  });
});

describe('priorFromCsv', () => {
  const csv = 'naics2,year,metric,sites,pooled_rate,dispersion,prior_shape,prior_weight_hours\n' +
    '23,2024,trir,24194,1.70,0.976,1.02,120643\n23,2024,dart,24194,1.04,1.194,0.84,160950\n' +
    '99,2024,trir,500,2.00,0.000,inf,inf\n';
  it('reads mean and shape and derives the rate', () => {
    const p = priorFromCsv(csv, '23');
    expect(p?.mean).toBe(1.7);
    expect(p?.shape).toBe(1.02);
    expect(p?.rate).toBeCloseTo(0.6, 12);
    expect(p?.year).toBe('2024');
    expect(priorFromCsv(csv, '23', 'dart')?.mean).toBe(1.04);
  });
  it('reads complete pooling and missing sectors', () => {
    expect(priorFromCsv(csv, '99')?.shape).toBe(Infinity);
    expect(priorFromCsv(csv, '10')).toBeNull();
  });
});

describe('committed data end to end (NAICS 23, all sizes)', () => {
  const groups = JSON.parse(readFileSync('docs/data/benchmarks/23.json', 'utf8'));
  const prior = priorFromCsv(readFileSync('outputs/shrinkage_by_naics2.csv', 'utf8'), '23')!;
  const peer = selectPeerGroup(groups, '23')!;

  it('uses the committed peer group (n 29,664; zero share 0.41; p50 1.2; p75 3.85)', () => {
    expect(peer.distribution.n).toBe(29_664);
    expect(peer.distribution.percentiles.p50).toBe(1.2);
    expect(peer.distribution.percentiles.p75).toBe(3.85);
  });

  it('1 case in 20,000 hours: shrunk (1.02+1)/(0.6+0.1) = 2.8857, percentile 50 + (2.8857-1.2)/(3.85-1.2) x 25 = 65.9', () => {
    const r = whereDoIRank({ cases: 1, hours: 20_000, prior, distribution: peer.distribution });
    expect(r.raw).toBe(10);
    expect(r.shrunk).toBeCloseTo(2.02 / 0.7, 9);
    expect(r.percentile).toBeCloseTo(50 + ((2.02 / 0.7 - 1.2) / (3.85 - 1.2)) * 25, 9);
    expect(r.garwood[0]).toBeCloseTo(0.25, 2);
    expect(r.garwood[1]).toBeCloseTo(55.72, 2);
  });

  it('5 cases in 1,000,000 hours stays near its raw rate of 1.00 (README: 1.08)', () => {
    const r = whereDoIRank({ cases: 5, hours: 1_000_000, prior, distribution: peer.distribution });
    expect(r.shrunk).toBeCloseTo(6.02 / 5.6, 9);
    expect(r.shrunk).toBeCloseTo(1.08, 1);
    expect(r.weight).toBeLessThan(0.15);
  });
});

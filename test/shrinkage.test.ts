import { describe, expect, it } from 'vitest';
import {
  fitGammaPoissonPrior,
  gammaQuantile,
  poissonExactInterval,
  shrinkDart,
  shrinkRate,
  shrinkTrir,
  type CaseCounts,
  type GammaPoissonPrior,
} from '../src/index.js';

const H = 200_000;

// Gamma(k, 1) quantiles are Garwood limits: lower(k) = Gamma(k, 1) at alpha/2 and
// upper(k) = Gamma(k + 1, 1) at 1 - alpha/2. Reference values are the independent
// chi-square-based limits already used in intervals.test.ts.
const GARWOOD_95: Array<[number, number, number]> = [
  [1, 0.02531780798, 5.571643391],
  [2, 0.2422092785, 7.224687668],
  [5, 1.62348639, 11.66833208],
  [10, 4.795388696, 18.39035604],
  [35, 24.3787824, 48.67652737],
  [100, 81.36399125, 121.6267938],
];

describe('gammaQuantile', () => {
  it.each(GARWOOD_95)('reproduces the Garwood limits for k=%i', (k, lo, hi) => {
    expect(gammaQuantile(0.025, k)).toBeCloseTo(lo, 6);
    expect(gammaQuantile(0.975, k + 1)).toBeCloseTo(hi, 6);
  });

  it('has the closed form -ln(1 - p) for shape 1', () => {
    expect(gammaQuantile(0.5, 1)).toBeCloseTo(Math.LN2, 12);
    expect(gammaQuantile(0.975, 1)).toBeCloseTo(-Math.log(0.025), 12);
  });

  it('matches the chi-square median for 1 degree of freedom (shape 1/2)', () => {
    // chi2(0.5; 1) = 0.454936423119572..., Gamma(1/2, 1) quantile = chi2 / 2.
    expect(gammaQuantile(0.5, 0.5)).toBeCloseTo(0.454936423119572 / 2, 9);
  });

  it('rejects invalid input', () => {
    expect(() => gammaQuantile(0, 1)).toThrow(RangeError);
    expect(() => gammaQuantile(1, 1)).toThrow(RangeError);
    expect(() => gammaQuantile(0.5, 0)).toThrow(RangeError);
  });
});

describe('fitGammaPoissonPrior', () => {
  it('matches a hand calculation', () => {
    // exposures e = 1, 1, 1, 1 (200,000 h each); cases 0, 4, 0, 4.
    // mean = 8 / 4 = 2; sum (y - 2)^2 = 16; minus mean x sum e = 8 gives 8;
    // phi = 8 / (mean^2 x sum e^2) = 8 / 16 = 0.5; shape = 2; rate = shape / mean = 1.
    const p = fitGammaPoissonPrior([
      { cases: 0, hours: H },
      { cases: 4, hours: H },
      { cases: 0, hours: H },
      { cases: 4, hours: H },
    ]);
    expect(p.mean).toBeCloseTo(2, 12);
    expect(p.dispersion).toBeCloseTo(0.5, 12);
    expect(p.shape).toBeCloseTo(2, 12);
    expect(p.rate).toBeCloseTo(1, 12);
    expect(p.sites).toBe(4);
    expect(p.totalCases).toBe(8);
    expect(p.totalHours).toBe(4 * H);
  });

  it('pools completely when the data are no more variable than Poisson', () => {
    // Hand calculation: mean 2.5, sum of squared residuals 2.875 < mean x sum e = 10.
    const p = fitGammaPoissonPrior([
      { cases: 1, hours: 100_000 },
      { cases: 3, hours: 200_000 },
      { cases: 0, hours: 100_000 },
      { cases: 6, hours: 400_000 },
    ]);
    expect(p.mean).toBeCloseTo(2.5, 12);
    expect(p.shape).toBe(Infinity);
    expect(p.dispersion).toBe(0);
    const s = shrinkRate(7, 50_000, p);
    expect(s.shrunk).toBeCloseTo(2.5, 12);
    expect(s.weight).toBe(1);
  });

  it('rejects unusable peer groups', () => {
    expect(() => fitGammaPoissonPrior([{ cases: 1, hours: H }])).toThrow(RangeError);
    expect(() =>
      fitGammaPoissonPrior([
        { cases: 0, hours: H },
        { cases: 0, hours: H },
      ]),
    ).toThrow(RangeError);
    expect(() =>
      fitGammaPoissonPrior([
        { cases: 1, hours: 0 },
        { cases: 1, hours: H },
      ]),
    ).toThrow(RangeError);
    expect(() =>
      fitGammaPoissonPrior([
        { cases: 1.5, hours: H },
        { cases: 1, hours: H },
      ]),
    ).toThrow(RangeError);
  });
});

describe('shrinkRate', () => {
  // Prior Gamma(shape 4, rate 2): mean 2 per 200,000 h, worth 2 x 200,000 = 400,000 hours.
  const prior: GammaPoissonPrior = {
    mean: 2, shape: 4, rate: 2, dispersion: 0.25, sites: 1000, totalCases: 0, totalHours: 0,
  };

  it('gives the conjugate posterior mean by hand', () => {
    // 0 cases over 100,000 h: e = 0.5. Posterior Gamma(4, 2.5): mean 1.6.
    // Weighted form: w = 2 / 2.5 = 0.8; 0.8 x 2 + 0.2 x 0 = 1.6.
    const s = shrinkRate(0, 100_000, prior);
    expect(s.raw).toBe(0);
    expect(s.shrunk).toBeCloseTo(1.6, 12);
    expect(s.weight).toBeCloseTo(0.8, 12);
    // 3 cases over 400,000 h: e = 2, raw = 1.5. Posterior Gamma(7, 4): mean 1.75.
    const t = shrinkRate(3, 400_000, prior);
    expect(t.raw).toBeCloseTo(1.5, 12);
    expect(t.shrunk).toBeCloseTo(1.75, 12);
    expect(t.weight).toBeCloseTo(0.5, 12);
    expect(t.shrunk).toBeCloseTo(t.weight * 2 + (1 - t.weight) * t.raw, 12);
  });

  it('has an exact closed-form credible interval for shape 1', () => {
    // Shape 1, rate 1; 0 cases over 200,000 h: posterior Gamma(1, 2), an exponential with rate 2.
    const p1: GammaPoissonPrior = { ...prior, mean: 1, shape: 1, rate: 1 };
    const s = shrinkRate(0, H, p1);
    expect(s.lower).toBeCloseTo(-Math.log(0.975) / 2, 12);
    expect(s.upper).toBeCloseTo(-Math.log(0.025) / 2, 12);
  });

  it('is a weighted average of the peer mean and the raw rate and stays between them', () => {
    for (const [cases, hours] of [[0, 5_000], [1, 10_000], [7, 150_000], [30, 2_000_000]] as const) {
      const s = shrinkRate(cases, hours, prior);
      expect(s.shrunk).toBeGreaterThanOrEqual(Math.min(s.raw, prior.mean) - 1e-12);
      expect(s.shrunk).toBeLessThanOrEqual(Math.max(s.raw, prior.mean) + 1e-12);
      expect(s.lower).toBeLessThan(s.shrunk);
      expect(s.upper).toBeGreaterThan(s.shrunk);
    }
  });

  it('goes to the peer mean with no exposure and to the raw rate with a lot', () => {
    expect(shrinkRate(0, 1e-3, prior).shrunk).toBeCloseTo(2, 3);
    const big = shrinkRate(2_000, 2e8, prior);
    expect(big.raw).toBe(2);
    expect(big.shrunk).toBeCloseTo(big.raw, 2);
    const heavy = shrinkRate(10_000, 1e9, { ...prior, mean: 5 });
    expect(heavy.shrunk).toBeCloseTo(heavy.raw, 3);
  });

  it('does not let a tiny exposure produce an extreme rate', () => {
    // One case in 2,000 hours is a raw rate of 100 per 200,000 h; the shrunken rate stays near the peer mean.
    const s = shrinkRate(1, 2_000, prior);
    expect(s.raw).toBeCloseTo(100, 9);
    expect(s.shrunk).toBeCloseTo(5 / 2.01, 9);
    expect(s.shrunk).toBeLessThan(2.5);
  });

  it('gives a credible interval that is narrower than the Garwood interval for the same data', () => {
    const [lo, hi] = poissonExactInterval(2);
    const e = 0.5;
    const s = shrinkRate(2, 100_000, prior);
    expect(s.upper - s.lower).toBeLessThan((hi - lo) / e);
  });

  it('rejects invalid input', () => {
    expect(() => shrinkRate(-1, H, prior)).toThrow(RangeError);
    expect(() => shrinkRate(1.5, H, prior)).toThrow(RangeError);
    expect(() => shrinkRate(1, 0, prior)).toThrow(RangeError);
    expect(() => shrinkRate(1, H, prior, 1)).toThrow(RangeError);
  });

  it('wraps TRIR and DART with the same case definitions as the rate functions', () => {
    const c: CaseCounts = { deaths: 0, daysAwayCases: 1, jobTransferCases: 1, otherRecordableCases: 2 };
    const t = shrinkTrir(c, { employeeHours: 100_000 }, prior);
    expect(t.cases).toBe(4);
    expect(t.shrunk).toBeCloseTo((4 + 4) / 2.5, 12);
    const d = shrinkDart(c, { employeeHours: 100_000, contractorHours: 100_000 }, prior, {
      contractorBasis: 'combined',
    });
    expect(d.cases).toBe(2);
    expect(d.hours).toBe(200_000);
    expect(d.shrunk).toBeCloseTo((4 + 2) / 3, 12);
  });
});

// Seeded simulation: draw true rates from a known Gamma prior, observe Poisson
// counts, and check that the fit recovers the prior and that shrinkage lowers error.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function poissonDraw(mu: number, rnd: () => number): number {
  const L = Math.exp(-mu);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rnd();
  } while (p > L);
  return k - 1;
}

describe('simulation with known truth', () => {
  const rnd = mulberry32(20261027);
  const TRUE_SHAPE = 3;
  const TRUE_MEAN = 3;
  const N = 20_000;
  const sites: Array<{ cases: number; hours: number; truth: number }> = [];
  for (let i = 0; i < N; i++) {
    // Gamma(3, rate = 1) as a sum of three exponentials, rescaled to mean 3.
    let g = 0;
    for (let j = 0; j < TRUE_SHAPE; j++) g -= Math.log(1 - rnd());
    const truth = (g / TRUE_SHAPE) * TRUE_MEAN;
    const e = 0.05 + 2 * rnd(); // 10,000 to about 410,000 hours
    sites.push({ cases: poissonDraw(truth * e, rnd), hours: e * H, truth });
  }
  const prior = fitGammaPoissonPrior(sites);

  it('recovers the prior mean and shape', () => {
    expect(Math.abs(prior.mean - TRUE_MEAN) / TRUE_MEAN).toBeLessThan(0.03);
    expect(Math.abs(prior.shape - TRUE_SHAPE) / TRUE_SHAPE).toBeLessThan(0.15);
  });

  it('has lower squared error than raw rates, most of all at small exposure', () => {
    let rawSe = 0;
    let ebSe = 0;
    let rawSmall = 0;
    let ebSmall = 0;
    let nSmall = 0;
    for (const s of sites) {
      const r = shrinkRate(s.cases, s.hours, prior);
      rawSe += (r.raw - s.truth) ** 2;
      ebSe += (r.shrunk - s.truth) ** 2;
      if (s.hours < 60_000) {
        rawSmall += (r.raw - s.truth) ** 2;
        ebSmall += (r.shrunk - s.truth) ** 2;
        nSmall++;
      }
    }
    expect(nSmall).toBeGreaterThan(1000);
    expect(ebSe).toBeLessThan(rawSe);
    expect(ebSmall / rawSmall).toBeLessThan(0.5);
  });

  it('covers the true rate with close to nominal 95% credible intervals', () => {
    let hit = 0;
    for (const s of sites.slice(0, 4000)) {
      const r = shrinkRate(s.cases, s.hours, prior);
      if (r.lower <= s.truth && s.truth <= r.upper) hit++;
    }
    expect(hit / 4000).toBeGreaterThan(0.93);
    expect(hit / 4000).toBeLessThan(0.97);
  });
});

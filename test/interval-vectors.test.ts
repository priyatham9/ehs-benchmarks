import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  casesForPrecision,
  dartInterval,
  fitGammaPoissonPrior,
  gammaQuantile,
  poissonExactInterval,
  rateInterval,
  shrinkDart,
  shrinkRate,
  shrinkTrir,
  trirInterval,
  type CaseCounts,
} from '../src/index.js';

// Shared with python/tests/test_interval_vectors.py so both implementations are checked against the same cases.
const fx = JSON.parse(
  readFileSync(new URL('./fixtures/interval-vectors.json', import.meta.url), 'utf8'),
) as any;

const num = (x: number | string) => (x === 'Infinity' ? Infinity : (x as number));
const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-9);
const toCases = (c: Partial<CaseCounts>) => ({ deaths: 0, daysAwayCases: 0, jobTransferCases: 0, otherRecordableCases: 0, ...c }) as CaseCounts;
const fit = (sites: number[][]) => fitGammaPoissonPrior(sites.map(([cases, hours]) => ({ cases: cases!, hours: hours! })));

describe('shared interval vectors', () => {
  for (const v of fx.poissonExact) {
    it(`poissonExactInterval(${v.count}, ${v.confidence})`, () => {
      const [l, u] = poissonExactInterval(v.count, v.confidence);
      near(l, v.lower);
      near(u, v.upper);
    });
  }
  it('poissonExactInterval rejects bad input', () => {
    for (const v of fx.poissonExactThrows) expect(() => poissonExactInterval(v.count, v.confidence)).toThrow(RangeError);
  });
  for (const v of fx.rateInterval) {
    it(`rateInterval(${v.cases}, ${v.hours}, ${v.confidence})`, () => {
      const r = rateInterval(v.cases, v.hours, v.confidence);
      near(r.rate, v.rate);
      near(r.lower, v.lower);
      near(r.upper, v.upper);
    });
  }
  it('rateInterval rejects bad input', () => {
    for (const v of fx.rateIntervalThrows) expect(() => rateInterval(v.cases, v.hours)).toThrow(RangeError);
  });
  for (const v of fx.trirDart) {
    it(`trir/dart interval ${JSON.stringify(v.hours)} ${JSON.stringify(v.options)}`, () => {
      for (const [name, fn] of [['trir', trirInterval], ['dart', dartInterval]] as const) {
        const r = fn(toCases(v.cases), v.hours, v.options);
        const e = v[name];
        near(r.rate, e.rate);
        near(r.lower, e.lower);
        near(r.upper, e.upper);
        expect(r.hours).toBe(e.hours);
      }
    });
  }
  for (const v of fx.casesForPrecision) {
    it(`casesForPrecision(${v.maxRatio}, ${v.confidence})`, () => {
      expect(casesForPrecision(v.maxRatio, v.confidence)).toBe(v.value);
    });
  }
  for (const v of fx.gammaQuantile) {
    it(`gammaQuantile(${v.p}, ${v.shape})`, () => near(gammaQuantile(v.p, v.shape), v.value));
  }
  it('gammaQuantile rejects bad input', () => {
    for (const v of fx.gammaQuantileThrows) expect(() => gammaQuantile(v.p, v.shape)).toThrow(RangeError);
  });
  for (const [name, e] of Object.entries<any>(fx.prior)) {
    it(`fitGammaPoissonPrior(${name})`, () => {
      const p = fit(e.sites);
      near(p.mean, e.mean);
      expect(p.shape).toBe(num(e.shape));
      expect(p.rate).toBe(num(e.rate));
      near(p.dispersion, e.dispersion);
      expect(p.sites).toBe(e.nSites);
      expect(p.totalCases).toBe(e.totalCases);
      near(p.totalHours, e.totalHours);
    });
  }
  it('fitGammaPoissonPrior rejects unusable peer groups', () => {
    for (const sites of fx.priorThrows) expect(() => fit(sites)).toThrow(RangeError);
  });
  for (const v of fx.shrink) {
    it(`shrinkRate(${v.cases}, ${v.hours}, ${v.prior}, ${v.confidence})`, () => {
      const s = shrinkRate(v.cases, v.hours, fit(fx.prior[v.prior].sites), v.confidence);
      for (const k of ['raw', 'shrunk', 'weight', 'lower', 'upper', 'priorMean'] as const) near(s[k], v[k]);
    });
  }
  it('shrinkRate rejects bad input', () => {
    const p = fit(fx.prior.mixed.sites);
    for (const v of fx.shrinkThrows) expect(() => shrinkRate(v.cases, v.hours, p, v.confidence)).toThrow(RangeError);
  });
  for (const v of fx.shrinkTrirDart) {
    it(`shrinkTrir/Dart ${JSON.stringify(v.hours)} ${JSON.stringify(v.options)}`, () => {
      const p = fit(fx.prior[v.prior].sites);
      for (const [name, fn] of [['trir', shrinkTrir], ['dart', shrinkDart]] as const) {
        const s = fn(toCases(v.cases), v.hours, p, v.options);
        for (const k of ['raw', 'shrunk', 'weight', 'lower', 'upper'] as const) near(s[k], v[name][k]);
        expect(s.hours).toBe(v[name].hours);
        expect(s.cases).toBe(v[name].cases);
      }
    });
  }
});

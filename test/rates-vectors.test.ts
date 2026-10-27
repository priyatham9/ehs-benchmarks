import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  dart,
  dartCases,
  fatalityRate,
  ltir,
  nearMissRatio,
  severityRate,
  totalRecordableCases,
  trir,
  OSHA_HOURS_BASIS,
  type CaseCounts,
  type HoursWorked,
  type RateOptions,
} from '../src/index.js';

// Shared with python/tests/test_vectors.py so both implementations are checked against the same cases.
const fixtures = JSON.parse(
  readFileSync(new URL('./fixtures/rate-vectors.json', import.meta.url), 'utf8'),
) as any;

const fns = { trir, dart, ltir, fatalityRate, severityRate } as const;

function toCases(raw: Record<string, number | string>): CaseCounts {
  const c: Record<string, number> = { deaths: 0, daysAwayCases: 0, jobTransferCases: 0, otherRecordableCases: 0 };
  for (const [k, v] of Object.entries(raw)) c[k] = v === 'NaN' ? Number.NaN : (v as number);
  return c as unknown as CaseCounts;
}

describe('shared rate vectors', () => {
  it('uses the OSHA basis from the fixture', () => {
    expect(OSHA_HOURS_BASIS).toBe(fixtures.basis);
  });

  for (const v of fixtures.rates) {
    it(v.name, () => {
      const fn = fns[v.fn as keyof typeof fns];
      const run = () => fn(toCases(v.cases), v.hours as HoursWorked, (v.options ?? {}) as RateOptions);
      if (v.throws) {
        expect(run).toThrow(RangeError);
        return;
      }
      const r = run();
      const codes = r.flags.map((f) => f.code);
      if ('value' in v) {
        if (v.value === null) expect(r.value).toBeNull();
        else expect(r.value).toBeCloseTo(v.value, 10);
      }
      if ('casesUsed' in v) expect(r.cases).toBe(v.casesUsed);
      if ('hoursUsed' in v) expect(r.hours).toBe(v.hoursUsed);
      for (const c of v.flagsInclude ?? []) expect(codes).toContain(c);
      for (const c of v.flagsExclude ?? []) expect(codes).not.toContain(c);
    });
  }

  for (const v of fixtures.aggregation) {
    it('aggregates case columns', () => {
      expect(totalRecordableCases(toCases(v.cases))).toBe(v.totalRecordable);
      expect(dartCases(toCases(v.cases))).toBe(v.dart);
    });
  }

  for (const v of fixtures.nearMiss) {
    it(`nearMissRatio(${v.nearMisses}, ${v.recordables})`, () => {
      if (v.throws) expect(() => nearMissRatio(v.nearMisses, v.recordables)).toThrow(RangeError);
      else expect(nearMissRatio(v.nearMisses, v.recordables)).toBe(v.value);
    });
  }
});

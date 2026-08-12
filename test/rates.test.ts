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
} from '../src/index.js';

const empty: CaseCounts = {
  deaths: 0,
  daysAwayCases: 0,
  jobTransferCases: 0,
  otherRecordableCases: 0,
};

describe('OSHA basis', () => {
  it('is exactly 200,000 hours (100 FTE x 40 hrs x 50 weeks)', () => {
    expect(OSHA_HOURS_BASIS).toBe(200_000);
    expect(100 * 40 * 50).toBe(OSHA_HOURS_BASIS);
  });
});

describe('case aggregation', () => {
  it('sums 300A columns G+H+I+J for total recordables', () => {
    const c: CaseCounts = { deaths: 1, daysAwayCases: 2, jobTransferCases: 3, otherRecordableCases: 4 };
    expect(totalRecordableCases(c)).toBe(10);
  });

  it('counts only days-away and job-transfer cases for DART', () => {
    const c: CaseCounts = { deaths: 1, daysAwayCases: 2, jobTransferCases: 3, otherRecordableCases: 4 };
    expect(dartCases(c)).toBe(5);
  });
});

describe('trir', () => {
  it('computes the textbook example: 5 cases over 500,000 hours = 2.0', () => {
    const c: CaseCounts = { ...empty, otherRecordableCases: 5 };
    expect(trir(c, { employeeHours: 500_000 }).value).toBeCloseTo(2.0, 10);
  });

  it('returns exactly the basis when cases equal hours/200000', () => {
    const c: CaseCounts = { ...empty, otherRecordableCases: 1 };
    expect(trir(c, { employeeHours: 200_000 }).value).toBe(1);
  });

  it('includes deaths in the numerator', () => {
    const withDeath: CaseCounts = { ...empty, deaths: 1 };
    expect(trir(withDeath, { employeeHours: 200_000 }).value).toBe(1);
  });

  it('returns null — not 0 or Infinity — when hours are zero', () => {
    const r = trir({ ...empty, otherRecordableCases: 3 }, { employeeHours: 0 });
    expect(r.value).toBeNull();
    expect(r.flags.map((f) => f.code)).toContain('ZERO_HOURS');
  });

  it('reports zero rate for zero cases over valid hours', () => {
    expect(trir(empty, { employeeHours: 200_000 }).value).toBe(0);
  });

  it('throws on negative case counts rather than returning a negative rate', () => {
    expect(() => trir({ ...empty, otherRecordableCases: -1 }, { employeeHours: 200_000 })).toThrow(
      RangeError,
    );
  });
});

describe('contractor hours', () => {
  const c: CaseCounts = { ...empty, otherRecordableCases: 10 };
  const hours = { employeeHours: 500_000, contractorHours: 500_000 };

  it('excludes contractor hours by default', () => {
    expect(trir(c, hours).value).toBeCloseTo(4.0, 10);
  });

  it('includes contractor hours when basis is combined', () => {
    expect(trir(c, hours, { contractorBasis: 'combined' }).value).toBeCloseTo(2.0, 10);
  });

  it('halves the rate here — the classic non-comparable-TRIR trap', () => {
    const employeeOnly = trir(c, hours).value as number;
    const combined = trir(c, hours, { contractorBasis: 'combined' }).value as number;
    expect(employeeOnly / combined).toBeCloseTo(2.0, 10);
  });

  it('treats a missing contractorHours as zero under combined basis', () => {
    expect(trir(c, { employeeHours: 500_000 }, { contractorBasis: 'combined' }).value).toBeCloseTo(4.0, 10);
  });
});

describe('dart and ltir', () => {
  const c: CaseCounts = { deaths: 0, daysAwayCases: 3, jobTransferCases: 2, otherRecordableCases: 5 };

  it('DART counts days-away plus restricted cases', () => {
    expect(dart(c, { employeeHours: 200_000 }).value).toBe(5);
  });

  it('LTIR counts days-away cases only, excluding restricted duty', () => {
    expect(ltir(c, { employeeHours: 200_000 }).value).toBe(3);
  });

  it('DART is always <= TRIR for the same inputs', () => {
    const t = trir(c, { employeeHours: 200_000 }).value as number;
    const d = dart(c, { employeeHours: 200_000 }).value as number;
    expect(d).toBeLessThanOrEqual(t);
  });

  it('LTIR is always <= DART for the same inputs', () => {
    const d = dart(c, { employeeHours: 200_000 }).value as number;
    const l = ltir(c, { employeeHours: 200_000 }).value as number;
    expect(l).toBeLessThanOrEqual(d);
  });
});

describe('fatalityRate', () => {
  it('counts deaths only', () => {
    const c: CaseCounts = { deaths: 2, daysAwayCases: 50, jobTransferCases: 50, otherRecordableCases: 50 };
    expect(fatalityRate(c, { employeeHours: 200_000 }).value).toBe(2);
  });
});

describe('severityRate', () => {
  it('measures days lost, not cases', () => {
    const c: CaseCounts = { ...empty, daysAwayCases: 1, daysAway: 30, daysRestricted: 10 };
    expect(severityRate(c, { employeeHours: 200_000 }).value).toBe(40);
  });

  it('flags an error when no day counts are supplied', () => {
    const r = severityRate({ ...empty, daysAwayCases: 1 }, { employeeHours: 200_000 });
    expect(r.flags.map((f) => f.code)).toContain('MISSING_DAY_COUNTS');
  });

  it('does not flag when only one of the two day fields is present', () => {
    const r = severityRate({ ...empty, daysAway: 12 }, { employeeHours: 200_000 });
    expect(r.flags.map((f) => f.code)).not.toContain('MISSING_DAY_COUNTS');
    expect(r.value).toBeCloseTo(12, 10);
  });
});

describe('nearMissRatio', () => {
  it('divides near misses by recordables', () => {
    expect(nearMissRatio(100, 4)).toBe(25);
  });

  it('returns null rather than Infinity when there are no recordables', () => {
    expect(nearMissRatio(50, 0)).toBeNull();
  });

  it('rejects negative inputs', () => {
    expect(() => nearMissRatio(-1, 5)).toThrow(RangeError);
  });
});

describe('partial periods', () => {
  const c: CaseCounts = { ...empty, otherRecordableCases: 2 };

  it('does NOT annualize — the 200,000 basis already normalizes time', () => {
    const full = trir(c, { employeeHours: 100_000 }).value;
    const partial = trir(c, { employeeHours: 100_000 }, { monthsCovered: 6 }).value;
    expect(partial).toBe(full);
  });

  it('flags the partial period so callers know the rate is volatile', () => {
    const r = trir(c, { employeeHours: 100_000 }, { monthsCovered: 6 });
    expect(r.flags.map((f) => f.code)).toContain('PARTIAL_PERIOD');
  });

  it('does not flag a full 12-month period', () => {
    const r = trir(c, { employeeHours: 100_000 }, { monthsCovered: 12 });
    expect(r.flags.map((f) => f.code)).not.toContain('PARTIAL_PERIOD');
  });
});

describe('result metadata', () => {
  it('reports the numerator and denominator actually used', () => {
    const c: CaseCounts = { ...empty, otherRecordableCases: 7 };
    const r = trir(c, { employeeHours: 300_000, contractorHours: 100_000 }, { contractorBasis: 'combined' });
    expect(r.cases).toBe(7);
    expect(r.hours).toBe(400_000);
  });
});

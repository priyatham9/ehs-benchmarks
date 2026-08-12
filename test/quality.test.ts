import { describe, expect, it } from 'vitest';
import {
  checkPlausibility,
  isPublishable,
  MAX_HOURS_PER_EMPLOYEE,
  MIN_HOURS_PER_EMPLOYEE,
} from '../src/index.js';

const codes = (input: Parameters<typeof checkPlausibility>[0]) =>
  checkPlausibility(input).map((f) => f.code);

describe('checkPlausibility — hours', () => {
  it('accepts a normal establishment with no flags', () => {
    expect(codes({ hours: 89_734, employees: 48, totalCases: 2 })).toEqual([]);
  });

  it('flags zero hours as an error', () => {
    expect(codes({ hours: 0 })).toContain('ZERO_HOURS');
  });

  it('flags negative hours as an error', () => {
    expect(codes({ hours: -1 })).toContain('ZERO_HOURS');
  });

  it('flags NaN hours as an error', () => {
    expect(codes({ hours: Number.NaN })).toContain('ZERO_HOURS');
  });

  it('short-circuits after zero hours rather than emitting downstream noise', () => {
    expect(codes({ hours: 0, employees: 50, totalCases: 900 })).toEqual(['ZERO_HOURS']);
  });
});

describe('checkPlausibility — the 88.4% problem', () => {
  // Real record from the CY2025 ITA file: 1.2e11 hours reported for 60 employees.
  it('rejects the worst real-world record in the CY2025 file', () => {
    const flags = codes({ hours: 1.2e11, employees: 60 });
    expect(flags).toContain('IMPLAUSIBLE_HOURS_PER_EMPLOYEE');
    expect(isPublishable(checkPlausibility({ hours: 1.2e11, employees: 60 }))).toBe(false);
  });

  it('rejects hours reported in the wrong unit (too few per employee)', () => {
    expect(codes({ hours: 50, employees: 20 })).toContain('IMPLAUSIBLE_HOURS_PER_EMPLOYEE');
  });

  it('accepts heavy overtime just inside the upper bound', () => {
    const hours = 10 * (MAX_HOURS_PER_EMPLOYEE - 1);
    expect(codes({ hours, employees: 10 })).not.toContain('IMPLAUSIBLE_HOURS_PER_EMPLOYEE');
  });

  it('rejects just outside the upper bound', () => {
    const hours = 10 * (MAX_HOURS_PER_EMPLOYEE + 1);
    expect(codes({ hours, employees: 10 })).toContain('IMPLAUSIBLE_HOURS_PER_EMPLOYEE');
  });

  it('accepts exactly at the lower bound', () => {
    const hours = 100 * MIN_HOURS_PER_EMPLOYEE;
    expect(codes({ hours, employees: 100 })).not.toContain('IMPLAUSIBLE_HOURS_PER_EMPLOYEE');
  });

  it('cannot check hours-per-employee when employee count is absent', () => {
    expect(codes({ hours: 1.2e11 })).not.toContain('IMPLAUSIBLE_HOURS_PER_EMPLOYEE');
  });

  it('ignores a zero employee count instead of dividing by it', () => {
    expect(codes({ hours: 50_000, employees: 0 })).not.toContain('IMPLAUSIBLE_HOURS_PER_EMPLOYEE');
  });
});

describe('checkPlausibility — small denominators', () => {
  it('warns that a low hour base makes the rate unstable', () => {
    expect(codes({ hours: 5_000, employees: 3 })).toContain('LOW_HOUR_BASE');
  });

  it('does not warn at or above the meaningful threshold', () => {
    expect(codes({ hours: 10_000, employees: 5 })).not.toContain('LOW_HOUR_BASE');
  });

  it('states the rate a single case would produce', () => {
    const flag = checkPlausibility({ hours: 5_000, employees: 3 }).find(
      (f) => f.code === 'LOW_HOUR_BASE',
    );
    expect(flag?.message).toContain('40.0');
  });

  it('treats a low hour base as a warning, not a publish blocker', () => {
    expect(isPublishable(checkPlausibility({ hours: 5_000, employees: 3 }))).toBe(true);
  });
});

describe('checkPlausibility — case counts', () => {
  it('warns when cases exceed headcount', () => {
    expect(codes({ hours: 100_000, employees: 50, totalCases: 60 })).toContain(
      'CASES_EXCEED_EMPLOYEES',
    );
  });

  it('does not warn when cases equal headcount', () => {
    expect(codes({ hours: 100_000, employees: 50, totalCases: 50 })).not.toContain(
      'CASES_EXCEED_EMPLOYEES',
    );
  });
});

describe('isPublishable', () => {
  it('is true for an empty flag list', () => {
    expect(isPublishable([])).toBe(true);
  });

  it('is false when any flag is an error', () => {
    expect(
      isPublishable([
        { code: 'LOW_HOUR_BASE', severity: 'warn', message: '' },
        { code: 'ZERO_HOURS', severity: 'error', message: '' },
      ]),
    ).toBe(false);
  });
});

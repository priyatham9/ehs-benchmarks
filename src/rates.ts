import {
  OSHA_HOURS_BASIS,
  type CaseCounts,
  type ContractorBasis,
  type DataQualityFlag,
  type HoursWorked,
  type RateResult,
} from './types.js';
import { checkPlausibility } from './quality.js';

export interface RateOptions {
  /** How to treat contractor hours. Defaults to 'employee-only'. */
  contractorBasis?: ContractorBasis;
  /** Annual average employee count, used only for plausibility screening. */
  employees?: number;
  /**
   * Months covered by this period, 1-12. Defaults to 12.
   *
   * Rates are already time-normalized by the 200,000-hour basis, so a partial
   * period does NOT need annualizing — the hours denominator shrinks with the
   * period. Supplying this only adds a PARTIAL_PERIOD flag so the caller knows
   * the rate is volatile. Annualizing a partial-period rate on top of the
   * 200,000 basis is a real and common double-counting error.
   */
  monthsCovered?: number;
}

/** Total recordable cases: 300A columns G + H + I + J. */
export function totalRecordableCases(c: CaseCounts): number {
  return c.deaths + c.daysAwayCases + c.jobTransferCases + c.otherRecordableCases;
}

/** DART cases: those with days away, job transfer, or restriction (H + I). */
export function dartCases(c: CaseCounts): number {
  return c.daysAwayCases + c.jobTransferCases;
}

function resolveHours(h: HoursWorked, basis: ContractorBasis): number {
  return basis === 'combined' ? h.employeeHours + (h.contractorHours ?? 0) : h.employeeHours;
}

/**
 * The shared engine behind every rate in this library.
 *
 * rate = (cases x 200,000) / hours worked
 */
function computeRate(
  cases: number,
  hoursWorked: HoursWorked,
  options: RateOptions,
  extraFlags: DataQualityFlag[] = [],
): RateResult {
  const basis = options.contractorBasis ?? 'employee-only';
  const hours = resolveHours(hoursWorked, basis);

  const flags: DataQualityFlag[] = [
    ...checkPlausibility({
      hours,
      employees: options.employees,
      totalCases: cases,
    }),
    ...extraFlags,
  ];

  const months = options.monthsCovered ?? 12;
  if (months < 12) {
    flags.push({
      code: 'PARTIAL_PERIOD',
      severity: 'warn',
      message:
        `Period covers ${months} of 12 months. The 200,000-hour basis already normalizes for ` +
        `time — do NOT multiply this rate by ${(12 / months).toFixed(2)} to annualize it.`,
    });
  }

  if (cases < 0) {
    throw new RangeError(`Case count cannot be negative (received ${cases}).`);
  }

  const computable = Number.isFinite(hours) && hours > 0;
  return {
    value: computable ? (cases * OSHA_HOURS_BASIS) / hours : null,
    cases,
    hours: computable ? hours : 0,
    flags,
  };
}

/**
 * Total Recordable Incident Rate.
 *
 * The headline OSHA metric: recordable cases per 100 full-time-equivalent
 * employees per year.
 */
export function trir(c: CaseCounts, h: HoursWorked, options: RateOptions = {}): RateResult {
  return computeRate(totalRecordableCases(c), h, options);
}

/**
 * DART rate — Days Away, Restricted, or Transferred.
 *
 * Narrower than TRIR: counts only cases severe enough to change what the
 * worker could do. Less gameable than TRIR, which is why regulators watch it.
 */
export function dart(c: CaseCounts, h: HoursWorked, options: RateOptions = {}): RateResult {
  return computeRate(dartCases(c), h, options);
}

/**
 * Lost Time Incident Rate (OSHA's DAFWII — days away from work injury/illness).
 *
 * Counts only cases with days away from work. Note that "LTIR" is used
 * inconsistently across industry: some organizations include restricted-duty
 * cases, which makes their number a DART rate by another name. This function
 * implements the days-away-only definition.
 */
export function ltir(c: CaseCounts, h: HoursWorked, options: RateOptions = {}): RateResult {
  return computeRate(c.daysAwayCases, h, options);
}

/** Fatality rate per 100 FTE per year. Usually reported per 100,000 workers instead. */
export function fatalityRate(c: CaseCounts, h: HoursWorked, options: RateOptions = {}): RateResult {
  return computeRate(c.deaths, h, options);
}

/**
 * Severity rate: lost DAYS per 100 FTE per year, not cases.
 *
 * Answers "how bad were the injuries" rather than "how many". Requires the
 * optional day-count fields; returns a MISSING_DAY_COUNTS flag if absent.
 */
export function severityRate(c: CaseCounts, h: HoursWorked, options: RateOptions = {}): RateResult {
  const flags: DataQualityFlag[] = [];
  if (c.daysAway === undefined && c.daysRestricted === undefined) {
    flags.push({
      code: 'MISSING_DAY_COUNTS',
      severity: 'error',
      message: 'Severity rate needs daysAway and/or daysRestricted; neither was supplied.',
    });
  }
  const days = (c.daysAway ?? 0) + (c.daysRestricted ?? 0);
  return computeRate(days, h, options, flags);
}

/**
 * Near-miss ratio: near misses reported per recordable case.
 *
 * A LEADING indicator, and the one most often misread. A high ratio is
 * generally good — it means people are reporting. A ratio that falls while
 * TRIR is flat usually signals reporting fatigue, not improving safety.
 * Returns null when there are no recordables (division by zero), which is
 * itself the best possible outcome and must not be rendered as 0.
 */
export function nearMissRatio(nearMisses: number, recordables: number): number | null {
  if (nearMisses < 0 || recordables < 0) {
    throw new RangeError('Near-miss and recordable counts cannot be negative.');
  }
  return recordables === 0 ? null : nearMisses / recordables;
}

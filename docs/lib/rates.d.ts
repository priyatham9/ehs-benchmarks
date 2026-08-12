import { type CaseCounts, type ContractorBasis, type HoursWorked, type RateResult } from './types.js';
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
export declare function totalRecordableCases(c: CaseCounts): number;
/** DART cases: those with days away, job transfer, or restriction (H + I). */
export declare function dartCases(c: CaseCounts): number;
/**
 * Total Recordable Incident Rate.
 *
 * The headline OSHA metric: recordable cases per 100 full-time-equivalent
 * employees per year.
 */
export declare function trir(c: CaseCounts, h: HoursWorked, options?: RateOptions): RateResult;
/**
 * DART rate — Days Away, Restricted, or Transferred.
 *
 * Narrower than TRIR: counts only cases severe enough to change what the
 * worker could do. Less gameable than TRIR, which is why regulators watch it.
 */
export declare function dart(c: CaseCounts, h: HoursWorked, options?: RateOptions): RateResult;
/**
 * Lost Time Incident Rate (OSHA's DAFWII — days away from work injury/illness).
 *
 * Counts only cases with days away from work. Note that "LTIR" is used
 * inconsistently across industry: some organizations include restricted-duty
 * cases, which makes their number a DART rate by another name. This function
 * implements the days-away-only definition.
 */
export declare function ltir(c: CaseCounts, h: HoursWorked, options?: RateOptions): RateResult;
/** Fatality rate per 100 FTE per year. Usually reported per 100,000 workers instead. */
export declare function fatalityRate(c: CaseCounts, h: HoursWorked, options?: RateOptions): RateResult;
/**
 * Severity rate: lost DAYS per 100 FTE per year, not cases.
 *
 * Answers "how bad were the injuries" rather than "how many". Requires the
 * optional day-count fields; returns a MISSING_DAY_COUNTS flag if absent.
 */
export declare function severityRate(c: CaseCounts, h: HoursWorked, options?: RateOptions): RateResult;
/**
 * Near-miss ratio: near misses reported per recordable case.
 *
 * A LEADING indicator, and the one most often misread. A high ratio is
 * generally good — it means people are reporting. A ratio that falls while
 * TRIR is flat usually signals reporting fatigue, not improving safety.
 * Returns null when there are no recordables (division by zero), which is
 * itself the best possible outcome and must not be rendered as 0.
 */
export declare function nearMissRatio(nearMisses: number, recordables: number): number | null;

import type { DataQualityFlag } from './types.js';
/**
 * Plausibility bounds for hours worked per employee per year.
 *
 * These are not arbitrary. They were derived from the full CY2025 OSHA ITA
 * 300A file (383,283 establishment records). In that file:
 *
 *   p1  =   163 hours/employee
 *   p25 = 1,415
 *   p50 = 1,794
 *   p75 = 2,051
 *   p95 = 2,483
 *   p99 = 3,716
 *   max = 2,171,072,857   <-- 2.17 billion hours for one employee
 *
 * 1.53% of records fall outside 100-4,000 hours/employee, but those records
 * account for 88.4% of all hours reported in the file. Summing the raw column
 * therefore yields a national TRIR of 0.42; excluding implausible records
 * yields 3.49. Anyone benchmarking against the raw file is off by ~8x.
 *
 * The upper bound of 4,000 allows for heavy overtime (roughly two full-time
 * schedules) before a record is considered a data-entry error. The lower bound
 * of 100 excludes records where hours were evidently reported in the wrong
 * unit (e.g. FTE count or thousands of hours) rather than as raw hours.
 */
export declare const MIN_HOURS_PER_EMPLOYEE = 100;
export declare const MAX_HOURS_PER_EMPLOYEE = 4000;
/**
 * Minimum hours for a rate to be statistically meaningful.
 *
 * At 10,000 hours a single recordable case produces a TRIR of 20.0. Rates
 * computed on small hour bases are dominated by whether one person got hurt,
 * which is why establishment-level benchmarking below this threshold is noise.
 */
export declare const MIN_MEANINGFUL_HOURS = 10000;
export interface PlausibilityInput {
    hours: number;
    employees?: number | undefined;
    totalCases?: number | undefined;
}
/**
 * Screen a set of inputs for the data-quality problems that actually occur in
 * self-reported OSHA data.
 *
 * Returns flags rather than throwing: a caller aggregating 380,000 records
 * needs to filter, not crash. Any flag with severity `error` means the derived
 * rate should be excluded from a benchmark distribution.
 */
export declare function checkPlausibility(input: PlausibilityInput): DataQualityFlag[];
/** True if no flag has severity `error`. */
export declare function isPublishable(flags: DataQualityFlag[]): boolean;

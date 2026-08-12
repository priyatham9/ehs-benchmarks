/**
 * Core types for OSHA recordkeeping metrics.
 *
 * Terminology follows 29 CFR 1904. Where this library uses a shorter name than
 * the regulation (e.g. `daysAwayCases` for "cases with days away from work"),
 * the regulatory term is given in the doc comment.
 */
/**
 * The OSHA incident-rate basis: 100 full-time equivalent employees working
 * 40 hours/week for 50 weeks = 200,000 hours.
 *
 * Every rate in this library is "per 100 FTE per year" because of this constant.
 * It is exported so callers can see it rather than find it hard-coded.
 */
export declare const OSHA_HOURS_BASIS: 200000;
/**
 * A single establishment's recordable case counts for one reporting period.
 *
 * These map 1:1 onto the OSHA Form 300A summary fields, which is what makes
 * this library directly usable against the public ITA dataset.
 */
export interface CaseCounts {
    /** 300A column G — deaths. */
    deaths: number;
    /** 300A column H — cases with days away from work (DAFW). */
    daysAwayCases: number;
    /** 300A column I — cases with job transfer or restriction (DJTR). */
    jobTransferCases: number;
    /** 300A column J — other recordable cases (no days away, no restriction). */
    otherRecordableCases: number;
    /** 300A column K — total days away from work. Optional; needed for severity rate. */
    daysAway?: number;
    /** 300A column L — total days of job transfer or restriction. Optional. */
    daysRestricted?: number;
}
/** Hours actually worked by employees during the period. Never scheduled hours. */
export interface HoursWorked {
    /** Hours worked by the employer's own employees. */
    employeeHours: number;
    /**
     * Hours worked by contractors the employer supervises day-to-day.
     *
     * OSHA requires these on the host's log when the host supervises the work
     * (29 CFR 1904.31). They are kept separate here so callers can compute both
     * employee-only and combined rates — the single most common source of
     * non-comparable TRIR between two organizations.
     */
    contractorHours?: number;
}
/** How contractor hours are treated when computing a rate. */
export type ContractorBasis = 
/** Employee hours only. Contractor hours and cases excluded. */
'employee-only'
/** Employee + contractor hours. Use when the log includes supervised contractors. */
 | 'combined';
/**
 * The result of a rate calculation.
 *
 * `value` is `null` rather than 0 or Infinity when the rate is undefined
 * (zero hours worked). A safety rate of "0" and "not computable" are very
 * different claims, and collapsing them is how spreadsheets end up reporting
 * a perfect record for a site that simply did not report.
 */
export interface RateResult {
    /** The computed rate per 100 FTE per year, or null if not computable. */
    value: number | null;
    /** Numerator actually used (case count or day count). */
    cases: number;
    /** Denominator actually used, in hours. */
    hours: number;
    /** Non-fatal notes about the inputs — see `DataQualityFlag`. */
    flags: DataQualityFlag[];
}
/** A machine-readable warning about input plausibility. */
export interface DataQualityFlag {
    code: DataQualityCode;
    message: string;
    /** `error` means the rate should not be published; `warn` means interpret with care. */
    severity: 'warn' | 'error';
}
export type DataQualityCode = 'ZERO_HOURS' | 'IMPLAUSIBLE_HOURS_PER_EMPLOYEE' | 'LOW_HOUR_BASE' | 'CASES_EXCEED_EMPLOYEES' | 'MISSING_DAY_COUNTS' | 'PARTIAL_PERIOD';
/** A percentile distribution for a peer group. */
export interface BenchmarkDistribution {
    /** NAICS code the distribution is keyed on (2-, 3-, or 6-digit). */
    naics: string;
    /** Establishment size band, or 'all'. */
    sizeBand: SizeBand | 'all';
    /** Number of establishments in the peer group. */
    n: number;
    /** Percentile breakpoints, ascending. */
    percentiles: Record<PercentileKey, number>;
    /** Share of establishments in the group reporting zero recordables, 0-1. */
    zeroRate: number;
    /**
     * Hours-weighted aggregate rate for the group. Differs from p50 whenever
     * large and small establishments have different safety performance.
     */
    aggregate: number;
}
export type PercentileKey = 'p10' | 'p25' | 'p50' | 'p75' | 'p90' | 'p95' | 'p99';
/** OSHA ITA establishment size bands, by annual average employees. */
export type SizeBand = '20-49' | '50-99' | '100-249' | '250-499' | '500-999' | '1000+';
/** Where an establishment falls within its peer group. */
export interface BenchmarkResult {
    /** The rate that was looked up. */
    rate: number;
    /**
     * Percentile rank 0-100. LOWER IS BETTER for injury rates: a rank of 25 means
     * 75% of peers had a higher (worse) rate.
     */
    percentileRank: number;
    /** The distribution the rank was computed against. */
    distribution: BenchmarkDistribution;
    /** Plain-language reading of the rank, safe to show a non-analyst. */
    interpretation: string;
}

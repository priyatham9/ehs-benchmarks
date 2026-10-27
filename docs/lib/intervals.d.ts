import { type CaseCounts, type ContractorBasis, type HoursWorked } from './types.js';
/** Exact (Garwood) confidence interval for a rate, scaled to the OSHA 200,000-hour basis. */
export interface RateInterval {
    /** Observed rate, cases x 200,000 / hours. */
    rate: number;
    /** Lower confidence limit (0 when there are no cases). */
    lower: number;
    /** Upper confidence limit. */
    upper: number;
    confidence: number;
    cases: number;
    hours: number;
}
/**
 * Exact two-sided confidence interval for a Poisson mean given an observed
 * count k (Garwood, 1936). The lower limit solves P(X >= k | mu) = alpha/2
 * (0 when k = 0); the upper limit solves P(X <= k | mu) = alpha/2. Equivalent
 * to chi-square quantiles: lower = chi2(alpha/2; 2k)/2, upper = chi2(1-alpha/2; 2k+2)/2.
 * Guaranteed coverage of at least `confidence`, unlike the normal approximation,
 * which is badly wrong for the small counts typical of one site-year.
 */
export declare function poissonExactInterval(count: number, confidence?: number): [number, number];
/**
 * Exact confidence interval for an incident rate (per 200,000 hours).
 * Treats cases as Poisson over fixed exposure. Real establishments are
 * overdispersed, so this is a best case: true uncertainty is at least this wide.
 */
export declare function rateInterval(cases: number, hours: number, confidence?: number): RateInterval;
export interface IntervalOptions {
    /** Confidence level, default 0.95. */
    confidence?: number;
    /** Same meaning as in RateOptions; default 'employee-only'. */
    contractorBasis?: ContractorBasis;
}
/** Exact confidence interval for TRIR. */
export declare function trirInterval(c: CaseCounts, h: HoursWorked, o?: IntervalOptions): RateInterval;
/** Exact confidence interval for the DART rate. */
export declare function dartInterval(c: CaseCounts, h: HoursWorked, o?: IntervalOptions): RateInterval;
/** Smallest case count k >= 1 whose exact interval has upper/lower <= maxRatio. */
export declare function casesForPrecision(maxRatio: number, confidence?: number): number;
export declare function logGamma(x: number): number;
/**
 * Exact power of the two-sided conditional test of equal rates, with both
 * rates observed over the same `hours`. Given the total count n, one arm's
 * count is Binomial(n, 1/2) under the null; the test rejects when the exact
 * two-sided binomial p-value is <= alpha. Power sums exactly over n.
 */
export declare function powerTwoRates(rate1: number, rate2: number, hours: number, alpha?: number): number;
export interface DistinguishOptions {
    /** Target power, default 0.8. */
    power?: number;
    /** Two-sided significance level, default 0.05. */
    alpha?: number;
}
/**
 * Minimum hours, PER SIDE, needed to tell two true incident rates apart.
 *
 * Both rates are observed over the same hours; the exact conditional test of
 * equal Poisson rates must reach the target power (default 80% at alpha 0.05).
 * Exact power is not monotone in hours (counts are discrete), so the search
 * steps up 1% at a time and returns the first hours value reaching the target;
 * the answer is therefore accurate to about 1%. Poisson is a best case: because
 * real establishments are overdispersed, the true requirement is larger.
 */
export declare function minHoursToDistinguish(rate1: number, rate2: number, options?: DistinguishOptions): number;

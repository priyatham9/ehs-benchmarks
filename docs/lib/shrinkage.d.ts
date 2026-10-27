import { type CaseCounts, type ContractorBasis, type HoursWorked } from './types.js';
/**
 * Empirical-Bayes shrinkage of incident rates (Gamma-Poisson model).
 *
 * Model. Establishment i has a true rate lambda_i per 200,000 hours, drawn from
 * a peer-group Gamma(shape a, rate b) prior (mean mu = a / b). It is observed
 * as y_i cases over exposure e_i = hours_i / 200,000, with y_i ~ Poisson(lambda_i e_i).
 * The posterior is Gamma(a + y_i, b + e_i) with mean (a + y_i) / (b + e_i), which
 * equals w * mu + (1 - w) * (y_i / e_i) for w = b / (b + e_i): a precision-weighted
 * average of the peer-group rate and the establishment's own raw rate. The
 * smaller the exposure, the more weight goes to the peer group.
 *
 * The prior (mu, a) is estimated from the peer group itself (empirical Bayes)
 * with `fitGammaPoissonPrior`. Neither the prior fit nor the model is a
 * substitute for the exact interval in intervals.ts: they answer different
 * questions (best estimate of the true rate versus what the raw count alone can rule out).
 */
/** Gamma prior on true rates per 200,000 hours: lambda ~ Gamma(shape, rate), mean = shape / rate. */
export interface GammaPoissonPrior {
    /** Peer-group mean rate per 200,000 hours (pooled cases x 200,000 / pooled hours). */
    mean: number;
    /** Gamma shape a. `Infinity` when the data show no more variation than Poisson (complete pooling). */
    shape: number;
    /** Gamma rate b, in units of 200,000-hour exposure; b x 200,000 is the prior's weight in hours. `Infinity` for complete pooling. */
    rate: number;
    /** Extra-Poisson variance of true rates: Var(lambda) = dispersion x mean^2, i.e. 1 / shape (0 for complete pooling). */
    dispersion: number;
    /** Number of establishments used in the fit. */
    sites: number;
    totalCases: number;
    totalHours: number;
}
export interface SiteCounts {
    cases: number;
    hours: number;
}
/**
 * Fit the Gamma prior from peer-group establishments by the method of moments.
 *
 * mean = sum(cases) x 200,000 / sum(hours). For the extra-Poisson variance of
 * true rates, the marginal count has Var(y_i) = mu e_i + phi mu^2 e_i^2, so
 *   phi = sum[(y_i - mu e_i)^2 - mu e_i] / (mu^2 sum e_i^2),
 * floored at 0; shape = 1 / phi. Consistent for many establishments; with few
 * it is noisy and slightly biased (mu is itself estimated), so use peer groups
 * with at least several hundred establishments.
 */
export declare function fitGammaPoissonPrior(sites: readonly SiteCounts[]): GammaPoissonPrior;
/** Quantile of Gamma(shape, rate = 1) at probability p, by bisection on the exact CDF. */
export declare function gammaQuantile(p: number, shape: number): number;
/** Result of shrinking one establishment's rate toward its peer group. */
export interface ShrunkRate {
    /** Raw rate, cases x 200,000 / hours. */
    raw: number;
    /** Posterior mean rate per 200,000 hours: the shrunken estimate. */
    shrunk: number;
    /** Weight on the peer-group mean, b / (b + e), in [0, 1]. Near 1 means the raw rate carries almost no information. */
    weight: number;
    /** Equal-tailed posterior (credible) interval. Narrower than the exact interval because it borrows the prior. */
    lower: number;
    upper: number;
    confidence: number;
    cases: number;
    hours: number;
    priorMean: number;
}
/**
 * Shrink an establishment rate toward its peer group.
 * `confidence` sets the credible interval (default 0.95).
 */
export declare function shrinkRate(cases: number, hours: number, prior: GammaPoissonPrior, confidence?: number): ShrunkRate;
export interface ShrinkOptions {
    /** Credible level, default 0.95. */
    confidence?: number;
    /** Same meaning as in RateOptions; default 'employee-only'. */
    contractorBasis?: ContractorBasis;
}
/** Shrunken TRIR. The prior must have been fitted on TRIR case counts. */
export declare function shrinkTrir(c: CaseCounts, h: HoursWorked, prior: GammaPoissonPrior, o?: ShrinkOptions): ShrunkRate;
/** Shrunken DART rate. The prior must have been fitted on DART case counts. */
export declare function shrinkDart(c: CaseCounts, h: HoursWorked, prior: GammaPoissonPrior, o?: ShrinkOptions): ShrunkRate;

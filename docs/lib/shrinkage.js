import { OSHA_HOURS_BASIS } from './types.js';
import { dartCases, totalRecordableCases } from './rates.js';
import { logGamma } from './intervals.js';
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
export function fitGammaPoissonPrior(sites) {
    if (sites.length < 2)
        throw new RangeError('At least 2 establishments are needed to fit a prior.');
    let sy = 0;
    let se = 0;
    for (const s of sites) {
        if (!Number.isInteger(s.cases) || s.cases < 0) {
            throw new RangeError(`cases must be a non-negative integer (received ${s.cases}).`);
        }
        if (!Number.isFinite(s.hours) || s.hours <= 0) {
            throw new RangeError(`hours must be a positive finite number (received ${s.hours}).`);
        }
        sy += s.cases;
        se += s.hours / OSHA_HOURS_BASIS;
    }
    if (sy === 0)
        throw new RangeError('Peer group has no cases; the prior mean would be 0.');
    const mu = sy / se;
    let num = 0;
    let den = 0;
    for (const s of sites) {
        const e = s.hours / OSHA_HOURS_BASIS;
        num += (s.cases - mu * e) ** 2 - mu * e;
        den += e * e;
    }
    const phi = num / (mu * mu * den);
    const base = { mean: mu, sites: sites.length, totalCases: sy, totalHours: se * OSHA_HOURS_BASIS };
    if (!(phi > 0))
        return { ...base, shape: Infinity, rate: Infinity, dispersion: 0 };
    const shape = 1 / phi;
    return { ...base, shape, rate: shape / mu, dispersion: phi };
}
/** Regularized lower incomplete gamma P(a, x) (series for x < a + 1, continued fraction otherwise). */
function gammaP(a, x) {
    if (x <= 0)
        return 0;
    const lg = logGamma(a);
    if (x < a + 1) {
        let term = 1 / a;
        let sum = term;
        for (let n = 1; n < 10_000; n++) {
            term *= x / (a + n);
            sum += term;
            if (Math.abs(term) < Math.abs(sum) * 1e-16)
                break;
        }
        return Math.min(1, sum * Math.exp(-x + a * Math.log(x) - lg));
    }
    const tiny = 1e-300;
    let b = x + 1 - a;
    let c = 1 / tiny;
    let d = 1 / b;
    let h = d;
    for (let i = 1; i < 10_000; i++) {
        const an = -i * (i - a);
        b += 2;
        d = an * d + b;
        if (Math.abs(d) < tiny)
            d = tiny;
        c = b + an / c;
        if (Math.abs(c) < tiny)
            c = tiny;
        d = 1 / d;
        const del = d * c;
        h *= del;
        if (Math.abs(del - 1) < 1e-16)
            break;
    }
    return Math.max(0, 1 - Math.exp(-x + a * Math.log(x) - lg) * h);
}
/** Quantile of Gamma(shape, rate = 1) at probability p, by bisection on the exact CDF. */
export function gammaQuantile(p, shape) {
    if (!(p > 0 && p < 1))
        throw new RangeError(`p must be strictly between 0 and 1 (received ${p}).`);
    if (!(shape > 0))
        throw new RangeError(`shape must be positive (received ${shape}).`);
    let lo = 0;
    let hi = shape + 10 * Math.sqrt(shape) + 20;
    while (gammaP(shape, hi) < p)
        hi *= 2;
    for (let i = 0; i < 200; i++) {
        const mid = 0.5 * (lo + hi);
        if (gammaP(shape, mid) < p)
            lo = mid;
        else
            hi = mid;
    }
    return 0.5 * (lo + hi);
}
/**
 * Shrink an establishment rate toward its peer group.
 * `confidence` sets the credible interval (default 0.95).
 */
export function shrinkRate(cases, hours, prior, confidence = 0.95) {
    if (!Number.isInteger(cases) || cases < 0) {
        throw new RangeError(`cases must be a non-negative integer (received ${cases}).`);
    }
    if (!Number.isFinite(hours) || hours <= 0) {
        throw new RangeError(`hours must be a positive finite number (received ${hours}).`);
    }
    if (!(confidence > 0 && confidence < 1)) {
        throw new RangeError(`confidence must be strictly between 0 and 1 (received ${confidence}).`);
    }
    const e = hours / OSHA_HOURS_BASIS;
    const raw = cases / e;
    const base = { raw, confidence, cases, hours, priorMean: prior.mean };
    if (prior.shape === Infinity) {
        return { ...base, shrunk: prior.mean, weight: 1, lower: prior.mean, upper: prior.mean };
    }
    const postShape = prior.shape + cases;
    const postRate = prior.rate + e;
    const a = (1 - confidence) / 2;
    return {
        ...base,
        shrunk: postShape / postRate,
        weight: prior.rate / postRate,
        lower: gammaQuantile(a, postShape) / postRate,
        upper: gammaQuantile(1 - a, postShape) / postRate,
    };
}
function hoursFor(h, basis) {
    return basis === 'combined' ? h.employeeHours + (h.contractorHours ?? 0) : h.employeeHours;
}
/** Shrunken TRIR. The prior must have been fitted on TRIR case counts. */
export function shrinkTrir(c, h, prior, o = {}) {
    return shrinkRate(totalRecordableCases(c), hoursFor(h, o.contractorBasis ?? 'employee-only'), prior, o.confidence);
}
/** Shrunken DART rate. The prior must have been fitted on DART case counts. */
export function shrinkDart(c, h, prior, o = {}) {
    return shrinkRate(dartCases(c), hoursFor(h, o.contractorBasis ?? 'employee-only'), prior, o.confidence);
}
//# sourceMappingURL=shrinkage.js.map
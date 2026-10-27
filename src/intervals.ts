import { OSHA_HOURS_BASIS, type CaseCounts, type ContractorBasis, type HoursWorked } from './types.js';
import { dartCases, totalRecordableCases } from './rates.js';

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

/** P(X <= k) for X ~ Poisson(mu), summed in log space. */
function poissonCdf(k: number, mu: number): number {
  if (mu <= 0) return 1;
  const logMu = Math.log(mu);
  let total = 0;
  let logFact = 0;
  for (let i = 0; i <= k; i++) {
    if (i > 1) logFact += Math.log(i);
    total += Math.exp(-mu + i * logMu - logFact);
  }
  return Math.min(total, 1);
}

function bisect(f: (x: number) => number, lo: number, hi: number): number {
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi);
    if (f(mid) > 0) hi = mid;
    else lo = mid;
  }
  return 0.5 * (lo + hi);
}

function checkConfidence(confidence: number): void {
  if (!(confidence > 0 && confidence < 1)) {
    throw new RangeError(`confidence must be strictly between 0 and 1 (received ${confidence}).`);
  }
}

/**
 * Exact two-sided confidence interval for a Poisson mean given an observed
 * count k (Garwood, 1936). The lower limit solves P(X >= k | mu) = alpha/2
 * (0 when k = 0); the upper limit solves P(X <= k | mu) = alpha/2. Equivalent
 * to chi-square quantiles: lower = chi2(alpha/2; 2k)/2, upper = chi2(1-alpha/2; 2k+2)/2.
 * Guaranteed coverage of at least `confidence`, unlike the normal approximation,
 * which is badly wrong for the small counts typical of one site-year.
 */
export function poissonExactInterval(count: number, confidence = 0.95): [number, number] {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError(`count must be a non-negative integer (received ${count}).`);
  }
  checkConfidence(confidence);
  const a = (1 - confidence) / 2;
  const upper = bisect((mu) => a - poissonCdf(count, mu), 0, count + 10 * Math.sqrt(count + 1) + 20);
  if (count === 0) return [0, upper];
  const lower = bisect((mu) => 1 - poissonCdf(count - 1, mu) - a, 0, count);
  return [lower, upper];
}

/**
 * Exact confidence interval for an incident rate (per 200,000 hours).
 * Treats cases as Poisson over fixed exposure. Real establishments are
 * overdispersed, so this is a best case: true uncertainty is at least this wide.
 */
export function rateInterval(cases: number, hours: number, confidence = 0.95): RateInterval {
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new RangeError(`hours must be a positive finite number (received ${hours}).`);
  }
  const [lo, hi] = poissonExactInterval(cases, confidence);
  return {
    rate: (cases * OSHA_HOURS_BASIS) / hours,
    lower: (lo * OSHA_HOURS_BASIS) / hours,
    upper: (hi * OSHA_HOURS_BASIS) / hours,
    confidence,
    cases,
    hours,
  };
}

export interface IntervalOptions {
  /** Confidence level, default 0.95. */
  confidence?: number;
  /** Same meaning as in RateOptions; default 'employee-only'. */
  contractorBasis?: ContractorBasis;
}

function hoursFor(h: HoursWorked, basis: ContractorBasis): number {
  return basis === 'combined' ? h.employeeHours + (h.contractorHours ?? 0) : h.employeeHours;
}

/** Exact confidence interval for TRIR. */
export function trirInterval(c: CaseCounts, h: HoursWorked, o: IntervalOptions = {}): RateInterval {
  return rateInterval(totalRecordableCases(c), hoursFor(h, o.contractorBasis ?? 'employee-only'), o.confidence);
}

/** Exact confidence interval for the DART rate. */
export function dartInterval(c: CaseCounts, h: HoursWorked, o: IntervalOptions = {}): RateInterval {
  return rateInterval(dartCases(c), hoursFor(h, o.contractorBasis ?? 'employee-only'), o.confidence);
}

/** Smallest case count k >= 1 whose exact interval has upper/lower <= maxRatio. */
export function casesForPrecision(maxRatio: number, confidence = 0.95): number {
  if (!(maxRatio > 1)) throw new RangeError('maxRatio must be greater than 1.');
  for (let k = 1; ; k++) {
    const [lo, hi] = poissonExactInterval(k, confidence);
    if (hi / lo <= maxRatio) return k;
  }
}

function logBinomPmf(n: number, p: number): Float64Array {
  const out = new Float64Array(n + 1);
  const l1p = Math.log1p(-p);
  const step = Math.log(p) - l1p;
  let acc = n * l1p;
  out[0] = acc;
  for (let k = 1; k <= n; k++) {
    acc += Math.log((n - k + 1) / k) + step;
    out[k] = acc;
  }
  return out;
}

function logGamma(x: number): number {
  // Lanczos approximation (g=7, n=9); only used for log(n!) at moderate n.
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  let a = c[0]!;
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i]! / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Largest c with 2 P(Bin(n, 1/2) <= c) <= alpha; -1 if none. */
function criticalValue(n: number, alpha: number): number {
  const lp = logBinomPmf(n, 0.5);
  let cdf = 0;
  let crit = -1;
  for (let k = 0; k <= n; k++) {
    cdf += Math.exp(lp[k]!);
    if (2 * cdf <= alpha) crit = k;
    else break;
  }
  return crit;
}

/**
 * Exact power of the two-sided conditional test of equal rates, with both
 * rates observed over the same `hours`. Given the total count n, one arm's
 * count is Binomial(n, 1/2) under the null; the test rejects when the exact
 * two-sided binomial p-value is <= alpha. Power sums exactly over n.
 */
export function powerTwoRates(rate1: number, rate2: number, hours: number, alpha = 0.05): number {
  if (!(rate1 > 0 && rate2 > 0 && hours > 0)) {
    throw new RangeError('rates and hours must be positive.');
  }
  const m1 = (rate1 * hours) / OSHA_HOURS_BASIS;
  const m2 = (rate2 * hours) / OSHA_HOURS_BASIS;
  const mt = m1 + m2;
  const p = m2 / mt;
  const sd = Math.sqrt(mt);
  const nLo = Math.max(1, Math.trunc(mt - 10 * sd - 5));
  const nHi = Math.trunc(mt + 10 * sd + 5);
  let power = 0;
  for (let n = nLo; n <= nHi; n++) {
    const c = criticalValue(n, alpha);
    if (c < 0) continue;
    const pn = Math.exp(-mt + n * Math.log(mt) - logGamma(n + 1));
    const lp = logBinomPmf(n, p);
    let reject = 0;
    for (let k = 0; k <= c; k++) reject += Math.exp(lp[k]!);
    for (let k = n - c; k <= n; k++) reject += Math.exp(lp[k]!);
    power += pn * reject;
  }
  return Math.min(power, 1);
}

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
export function minHoursToDistinguish(
  rate1: number,
  rate2: number,
  options: DistinguishOptions = {},
): number {
  const target = options.power ?? 0.8;
  const alpha = options.alpha ?? 0.05;
  if (!(rate1 > 0 && rate2 > 0) || rate1 === rate2) {
    throw new RangeError('rates must be positive and different.');
  }
  if (!(target > 0 && target < 1) || !(alpha > 0 && alpha < 1)) {
    throw new RangeError('power and alpha must be strictly between 0 and 1.');
  }
  // Start the search below the answer. For the defaults, the normal-approximation
  // hours halved; otherwise the hours at which about one case is expected, which
  // is always below the answer. The returned value always comes from the exact calculation.
  const isDefault = target === 0.8 && alpha === 0.05;
  const z = 1.959964 + 0.841621;
  const approx = ((z * z * (rate1 + rate2)) / (rate1 - rate2) ** 2) * OSHA_HOURS_BASIS;
  let hours = isDefault ? Math.max(1, 0.5 * approx) : OSHA_HOURS_BASIS / (rate1 + rate2);
  while (powerTwoRates(rate1, rate2, hours, alpha) < target) hours *= 1.01;
  return hours;
}

"""Exact (Garwood) Poisson confidence intervals for incident rates. Port of src/intervals.ts."""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Callable, Optional, Tuple

from .rates import OSHA_HOURS_BASIS, CaseCounts, HoursWorked, dart_cases, total_recordable_cases


@dataclass
class RateInterval:
    """Observed rate (cases x 200,000 / hours) with exact confidence limits on the same scale."""
    rate: float
    lower: float
    upper: float
    confidence: float
    cases: float
    hours: float


def _is_int(x) -> bool:
    return isinstance(x, (int, float)) and math.isfinite(x) and x == math.floor(x)


def _poisson_cdf(k: int, mu: float) -> float:
    """P(X <= k) for X ~ Poisson(mu), summed in log space."""
    if mu <= 0:
        return 1.0
    log_mu = math.log(mu)
    total = 0.0
    log_fact = 0.0
    for i in range(int(k) + 1):
        if i > 1:
            log_fact += math.log(i)
        total += math.exp(-mu + i * log_mu - log_fact)
    return min(total, 1.0)


def _bisect(f: Callable[[float], float], lo: float, hi: float) -> float:
    for _ in range(200):
        mid = 0.5 * (lo + hi)
        if f(mid) > 0:
            hi = mid
        else:
            lo = mid
    return 0.5 * (lo + hi)


def _check_confidence(confidence: float) -> None:
    if not (0 < confidence < 1):
        raise ValueError(f"confidence must be strictly between 0 and 1 (received {confidence}).")


def poisson_exact_interval(count: float, confidence: float = 0.95) -> Tuple[float, float]:
    """Exact two-sided confidence interval for a Poisson mean given an observed count (Garwood, 1936).

    Lower limit is 0 when count == 0.
    """
    if not _is_int(count) or count < 0:
        raise ValueError(f"count must be a non-negative integer (received {count}).")
    _check_confidence(confidence)
    count = int(count)
    a = (1 - confidence) / 2
    upper = _bisect(lambda mu: a - _poisson_cdf(count, mu), 0.0, count + 10 * math.sqrt(count + 1) + 20)
    if count == 0:
        return (0.0, upper)
    lower = _bisect(lambda mu: 1 - _poisson_cdf(count - 1, mu) - a, 0.0, float(count))
    return (lower, upper)


def rate_interval(cases: float, hours: float, confidence: float = 0.95) -> RateInterval:
    """Exact confidence interval for an incident rate (per 200,000 hours)."""
    if not math.isfinite(hours) or hours <= 0:
        raise ValueError(f"hours must be a positive finite number (received {hours}).")
    lo, hi = poisson_exact_interval(cases, confidence)
    return RateInterval(
        rate=(cases * OSHA_HOURS_BASIS) / hours,
        lower=(lo * OSHA_HOURS_BASIS) / hours,
        upper=(hi * OSHA_HOURS_BASIS) / hours,
        confidence=confidence,
        cases=cases,
        hours=hours,
    )


def _hours_for(h: HoursWorked, basis: str) -> float:
    if basis == "combined":
        return h.employee_hours + (h.contractor_hours or 0)
    return h.employee_hours


def trir_interval(c: CaseCounts, h: HoursWorked, confidence: float = 0.95,
                  contractor_basis: str = "employee-only") -> RateInterval:
    """Exact confidence interval for TRIR."""
    return rate_interval(total_recordable_cases(c), _hours_for(h, contractor_basis), confidence)


def dart_interval(c: CaseCounts, h: HoursWorked, confidence: float = 0.95,
                  contractor_basis: str = "employee-only") -> RateInterval:
    """Exact confidence interval for the DART rate."""
    return rate_interval(dart_cases(c), _hours_for(h, contractor_basis), confidence)


def cases_for_precision(max_ratio: float, confidence: float = 0.95) -> int:
    """Smallest case count k >= 1 whose exact interval has upper/lower <= max_ratio."""
    if not (max_ratio > 1):
        raise ValueError("max_ratio must be greater than 1.")
    k = 1
    while True:
        lo, hi = poisson_exact_interval(k, confidence)
        if hi / lo <= max_ratio:
            return k
        k += 1


def log_gamma(x: float) -> float:
    """Lanczos approximation (g=7, n=9), identical to the TypeScript logGamma."""
    g = 7
    c = [
        0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
        -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
        1.5056327351493116e-7,
    ]
    if x < 0.5:
        return math.log(math.pi / math.sin(math.pi * x)) - log_gamma(1 - x)
    x -= 1
    a = c[0]
    t = x + g + 0.5
    for i in range(1, g + 2):
        a += c[i] / (x + i)
    return 0.5 * math.log(2 * math.pi) + (x + 0.5) * math.log(t) - t + math.log(a)


def _log_binom_pmf(n: int, p: float) -> list:
    """log P(Bin(n, p) = k) for k = 0..n, by the same recurrence as the TypeScript logBinomPmf."""
    l1p = math.log1p(-p)
    step = math.log(p) - l1p
    acc = n * l1p
    out = [acc]
    for k in range(1, n + 1):
        acc += math.log((n - k + 1) / k) + step
        out.append(acc)
    return out


def _critical_value(n: int, alpha: float) -> int:
    """Largest c with 2 P(Bin(n, 1/2) <= c) <= alpha; -1 if none."""
    lp = _log_binom_pmf(n, 0.5)
    cdf = 0.0
    crit = -1
    for k in range(n + 1):
        cdf += math.exp(lp[k])
        if 2 * cdf <= alpha:
            crit = k
        else:
            break
    return crit


def power_two_rates(rate1: float, rate2: float, hours: float, alpha: float = 0.05) -> float:
    """Exact power of the two-sided conditional test of equal rates over the same `hours`.

    Given the total count n, one arm's count is Binomial(n, 1/2) under the null; the test
    rejects when the exact two-sided binomial p-value is <= alpha. Power sums exactly over n.
    """
    if not (rate1 > 0 and rate2 > 0 and hours > 0):
        raise ValueError("rates and hours must be positive.")
    m1 = rate1 * hours / OSHA_HOURS_BASIS
    m2 = rate2 * hours / OSHA_HOURS_BASIS
    mt = m1 + m2
    p = m2 / mt
    sd = math.sqrt(mt)
    n_lo = max(1, int(mt - 10 * sd - 5))
    n_hi = int(mt + 10 * sd + 5)
    power = 0.0
    for n in range(n_lo, n_hi + 1):
        c = _critical_value(n, alpha)
        if c < 0:
            continue
        pn = math.exp(-mt + n * math.log(mt) - log_gamma(n + 1))
        lp = _log_binom_pmf(n, p)
        reject = 0.0
        for k in range(c + 1):
            reject += math.exp(lp[k])
        for k in range(n - c, n + 1):
            reject += math.exp(lp[k])
        power += pn * reject
    return min(power, 1.0)


def min_hours_to_distinguish(rate1: float, rate2: float, power: float = 0.8, alpha: float = 0.05) -> float:
    """Minimum hours, PER SIDE, needed to tell two true incident rates apart.

    Both rates are observed over the same hours; the exact conditional test of equal Poisson
    rates must reach the target power. Exact power is not monotone in hours, so the search steps
    up 1% at a time and returns the first hours value reaching the target (accurate to about 1%).
    """
    if not (rate1 > 0 and rate2 > 0) or rate1 == rate2:
        raise ValueError("rates must be positive and different.")
    if not (0 < power < 1) or not (0 < alpha < 1):
        raise ValueError("power and alpha must be strictly between 0 and 1.")
    is_default = power == 0.8 and alpha == 0.05
    z = 1.959964 + 0.841621
    approx = (z * z * (rate1 + rate2)) / (rate1 - rate2) ** 2 * OSHA_HOURS_BASIS
    hours = max(1.0, 0.5 * approx) if is_default else OSHA_HOURS_BASIS / (rate1 + rate2)
    while power_two_rates(rate1, rate2, hours, alpha) < power:
        hours *= 1.01
    return hours

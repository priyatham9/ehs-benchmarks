"""Empirical-Bayes (Gamma-Poisson) shrinkage of incident rates. Port of src/shrinkage.ts.

Model: true rate lambda ~ Gamma(shape, rate) per 200,000 hours; cases ~ Poisson(lambda x hours / 200,000).
Posterior mean is (shape + cases) / (rate + exposure).
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional, Sequence

from .intervals import _hours_for, _is_int, log_gamma
from .rates import OSHA_HOURS_BASIS, CaseCounts, HoursWorked, dart_cases, total_recordable_cases

INF = math.inf


@dataclass
class GammaPoissonPrior:
    mean: float
    shape: float  # inf when the data show no more variation than Poisson (complete pooling)
    rate: float   # inf for complete pooling
    dispersion: float
    sites: int
    total_cases: float
    total_hours: float


@dataclass
class SiteCounts:
    cases: float
    hours: float


@dataclass
class ShrunkRate:
    raw: float
    shrunk: float
    weight: float
    lower: float
    upper: float
    confidence: float
    cases: float
    hours: float
    prior_mean: float


def fit_gamma_poisson_prior(sites: Sequence[SiteCounts]) -> GammaPoissonPrior:
    """Fit the Gamma prior from peer-group establishments by the method of moments."""
    if len(sites) < 2:
        raise ValueError("At least 2 establishments are needed to fit a prior.")
    sy = 0.0
    se = 0.0
    for s in sites:
        if not _is_int(s.cases) or s.cases < 0:
            raise ValueError(f"cases must be a non-negative integer (received {s.cases}).")
        if not math.isfinite(s.hours) or s.hours <= 0:
            raise ValueError(f"hours must be a positive finite number (received {s.hours}).")
        sy += s.cases
        se += s.hours / OSHA_HOURS_BASIS
    if sy == 0:
        raise ValueError("Peer group has no cases; the prior mean would be 0.")
    mu = sy / se
    num = 0.0
    den = 0.0
    for s in sites:
        e = s.hours / OSHA_HOURS_BASIS
        num += (s.cases - mu * e) ** 2 - mu * e
        den += e * e
    phi = num / (mu * mu * den)
    base = dict(mean=mu, sites=len(sites), total_cases=sy, total_hours=se * OSHA_HOURS_BASIS)
    if not (phi > 0):
        return GammaPoissonPrior(shape=INF, rate=INF, dispersion=0.0, **base)
    shape = 1 / phi
    return GammaPoissonPrior(shape=shape, rate=shape / mu, dispersion=phi, **base)


def _gamma_p(a: float, x: float) -> float:
    """Regularized lower incomplete gamma P(a, x)."""
    if x <= 0:
        return 0.0
    lg = log_gamma(a)
    if x < a + 1:
        term = 1 / a
        total = term
        for n in range(1, 10_000):
            term *= x / (a + n)
            total += term
            if abs(term) < abs(total) * 1e-16:
                break
        return min(1.0, total * math.exp(-x + a * math.log(x) - lg))
    tiny = 1e-300
    b = x + 1 - a
    c = 1 / tiny
    d = 1 / b
    h = d
    for i in range(1, 10_000):
        an = -i * (i - a)
        b += 2
        d = an * d + b
        if abs(d) < tiny:
            d = tiny
        c = b + an / c
        if abs(c) < tiny:
            c = tiny
        d = 1 / d
        delta = d * c
        h *= delta
        if abs(delta - 1) < 1e-16:
            break
    return max(0.0, 1 - math.exp(-x + a * math.log(x) - lg) * h)


def gamma_quantile(p: float, shape: float) -> float:
    """Quantile of Gamma(shape, rate = 1) at probability p, by bisection on the exact CDF."""
    if not (0 < p < 1):
        raise ValueError(f"p must be strictly between 0 and 1 (received {p}).")
    if not (shape > 0):
        raise ValueError(f"shape must be positive (received {shape}).")
    lo = 0.0
    hi = shape + 10 * math.sqrt(shape) + 20
    while _gamma_p(shape, hi) < p:
        hi *= 2
    for _ in range(200):
        mid = 0.5 * (lo + hi)
        if _gamma_p(shape, mid) < p:
            lo = mid
        else:
            hi = mid
    return 0.5 * (lo + hi)


def shrink_rate(cases: float, hours: float, prior: GammaPoissonPrior, confidence: float = 0.95) -> ShrunkRate:
    """Shrink an establishment rate toward its peer group; confidence sets the credible interval."""
    if not _is_int(cases) or cases < 0:
        raise ValueError(f"cases must be a non-negative integer (received {cases}).")
    if not math.isfinite(hours) or hours <= 0:
        raise ValueError(f"hours must be a positive finite number (received {hours}).")
    if not (0 < confidence < 1):
        raise ValueError(f"confidence must be strictly between 0 and 1 (received {confidence}).")
    e = hours / OSHA_HOURS_BASIS
    raw = cases / e
    base = dict(raw=raw, confidence=confidence, cases=cases, hours=hours, prior_mean=prior.mean)
    if prior.shape == INF:
        return ShrunkRate(shrunk=prior.mean, weight=1.0, lower=prior.mean, upper=prior.mean, **base)
    post_shape = prior.shape + cases
    post_rate = prior.rate + e
    a = (1 - confidence) / 2
    return ShrunkRate(
        shrunk=post_shape / post_rate,
        weight=prior.rate / post_rate,
        lower=gamma_quantile(a, post_shape) / post_rate,
        upper=gamma_quantile(1 - a, post_shape) / post_rate,
        **base,
    )


def shrink_trir(c: CaseCounts, h: HoursWorked, prior: GammaPoissonPrior, confidence: float = 0.95,
                contractor_basis: str = "employee-only") -> ShrunkRate:
    """Shrunken TRIR. The prior must have been fitted on TRIR case counts."""
    return shrink_rate(total_recordable_cases(c), _hours_for(h, contractor_basis), prior, confidence)


def shrink_dart(c: CaseCounts, h: HoursWorked, prior: GammaPoissonPrior, confidence: float = 0.95,
                contractor_basis: str = "employee-only") -> ShrunkRate:
    """Shrunken DART rate. The prior must have been fitted on DART case counts."""
    return shrink_rate(dart_cases(c), _hours_for(h, contractor_basis), prior, confidence)

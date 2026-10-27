"""OSHA incident rates. Port of src/rates.ts.

rate = (cases x 200,000) / hours worked
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import List, Optional

from .quality import DataQualityFlag, check_plausibility

OSHA_HOURS_BASIS = 200_000  # 100 FTE x 40 hrs x 50 weeks


@dataclass
class CaseCounts:
    """Counts from OSHA 300A columns G-J, plus optional day counts."""
    deaths: float = 0
    days_away_cases: float = 0
    job_transfer_cases: float = 0
    other_recordable_cases: float = 0
    days_away: Optional[float] = None
    days_restricted: Optional[float] = None


@dataclass
class HoursWorked:
    employee_hours: float
    contractor_hours: Optional[float] = None


@dataclass
class RateOptions:
    contractor_basis: str = "employee-only"  # or 'combined'
    employees: Optional[float] = None
    months_covered: float = 12


@dataclass
class RateResult:
    value: Optional[float]
    cases: float
    hours: float
    flags: List[DataQualityFlag] = field(default_factory=list)


def total_recordable_cases(c: CaseCounts) -> float:
    """Columns G + H + I + J."""
    return c.deaths + c.days_away_cases + c.job_transfer_cases + c.other_recordable_cases


def dart_cases(c: CaseCounts) -> float:
    """Days away, job transfer or restriction (H + I)."""
    return c.days_away_cases + c.job_transfer_cases


def _resolve_hours(h: HoursWorked, basis: str) -> float:
    if basis == "combined":
        return h.employee_hours + (h.contractor_hours or 0)
    return h.employee_hours


def _compute_rate(cases, hours_worked, options, extra_flags=None) -> RateResult:
    options = options or RateOptions()
    hours = _resolve_hours(hours_worked, options.contractor_basis)

    flags = check_plausibility(hours, options.employees, cases)
    flags.extend(extra_flags or [])

    months = options.months_covered
    if months < 12:
        flags.append(DataQualityFlag(
            "PARTIAL_PERIOD", "warn",
            f"Period covers {months} of 12 months. The 200,000-hour basis already normalizes for "
            f"time — do NOT multiply this rate by {12 / months:.2f} to annualize it.",
        ))

    if not math.isfinite(cases) or cases < 0:
        raise ValueError(f"Case count must be a non-negative finite number (received {cases}).")

    computable = math.isfinite(hours) and hours > 0
    return RateResult(
        value=(cases * OSHA_HOURS_BASIS) / hours if computable else None,
        cases=cases,
        hours=hours if computable else 0,
        flags=flags,
    )


def trir(c: CaseCounts, h: HoursWorked, options: Optional[RateOptions] = None) -> RateResult:
    """Total Recordable Incident Rate."""
    return _compute_rate(total_recordable_cases(c), h, options)


def dart(c: CaseCounts, h: HoursWorked, options: Optional[RateOptions] = None) -> RateResult:
    """Days Away, Restricted, or Transferred rate."""
    return _compute_rate(dart_cases(c), h, options)


def ltir(c: CaseCounts, h: HoursWorked, options: Optional[RateOptions] = None) -> RateResult:
    """Days-away-only rate (DAFWII)."""
    return _compute_rate(c.days_away_cases, h, options)


def fatality_rate(c: CaseCounts, h: HoursWorked, options: Optional[RateOptions] = None) -> RateResult:
    return _compute_rate(c.deaths, h, options)


def severity_rate(c: CaseCounts, h: HoursWorked, options: Optional[RateOptions] = None) -> RateResult:
    """Lost days (not cases) per 100 FTE per year."""
    flags: List[DataQualityFlag] = []
    if c.days_away is None and c.days_restricted is None:
        flags.append(DataQualityFlag(
            "MISSING_DAY_COUNTS", "error",
            "Severity rate needs daysAway and/or daysRestricted; neither was supplied.",
        ))
    days = (c.days_away or 0) + (c.days_restricted or 0)
    return _compute_rate(days, h, options, flags)


def near_miss_ratio(near_misses: float, recordables: float) -> Optional[float]:
    """Near misses per recordable case; None when there are no recordables."""
    if near_misses < 0 or recordables < 0:
        raise ValueError("Near-miss and recordable counts cannot be negative.")
    return None if recordables == 0 else near_misses / recordables

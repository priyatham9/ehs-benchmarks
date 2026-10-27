"""Data-quality screening. Port of src/quality.ts."""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import List, Optional

# Bounds derived from the CY2025 OSHA ITA 300A file (see src/quality.ts for the derivation).
MIN_HOURS_PER_EMPLOYEE = 100
MAX_HOURS_PER_EMPLOYEE = 4_000
MIN_MEANINGFUL_HOURS = 10_000


@dataclass
class DataQualityFlag:
    code: str
    severity: str  # 'warn' | 'error'
    message: str


def _round(x: float) -> int:
    # JS Math.round rounds half up.
    return int(math.floor(x + 0.5))


def check_plausibility(
    hours: float,
    employees: Optional[float] = None,
    total_cases: Optional[float] = None,
) -> List[DataQualityFlag]:
    flags: List[DataQualityFlag] = []

    if not math.isfinite(hours) or hours <= 0:
        flags.append(DataQualityFlag(
            "ZERO_HOURS", "error",
            "Hours worked is zero, negative, or not a number; no rate is computable.",
        ))
        return flags

    if hours < MIN_MEANINGFUL_HOURS:
        flags.append(DataQualityFlag(
            "LOW_HOUR_BASE", "warn",
            f"Only {_round(hours):,} hours worked. A single recordable case would "
            f"produce a rate of {(1 * 200_000) / hours:.1f}; treat this rate as unstable.",
        ))

    if employees is not None and math.isfinite(employees) and employees > 0:
        per_employee = hours / employees
        if per_employee < MIN_HOURS_PER_EMPLOYEE or per_employee > MAX_HOURS_PER_EMPLOYEE:
            flags.append(DataQualityFlag(
                "IMPLAUSIBLE_HOURS_PER_EMPLOYEE", "error",
                f"{_round(per_employee):,} hours per employee per year is outside the "
                f"plausible range {MIN_HOURS_PER_EMPLOYEE}-{MAX_HOURS_PER_EMPLOYEE:,}. "
                "This is the dominant error mode in self-reported OSHA data.",
            ))
        if total_cases is not None and math.isfinite(total_cases) and total_cases > employees:
            flags.append(DataQualityFlag(
                "CASES_EXCEED_EMPLOYEES", "warn",
                f"{total_cases} recordable cases reported for {employees} average employees. "
                "Possible, but verify: it implies most of the workforce was injured.",
            ))

    return flags


def is_publishable(flags: List[DataQualityFlag]) -> bool:
    """True if no flag has severity 'error'."""
    return not any(f.severity == "error" for f in flags)

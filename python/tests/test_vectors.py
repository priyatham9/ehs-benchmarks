import json
import re
from pathlib import Path

import pytest

import ehs_metrics as m

FIXTURES = json.loads(
    (Path(__file__).resolve().parents[2] / "test" / "fixtures" / "rate-vectors.json").read_text()
)

FNS = {
    "trir": m.trir, "dart": m.dart, "ltir": m.ltir,
    "fatalityRate": m.fatality_rate, "severityRate": m.severity_rate,
}


def snake(s):
    return re.sub(r"([A-Z])", lambda x: "_" + x.group(1).lower(), s)


def to_cases(raw):
    kw = {snake(k): (float("nan") if v == "NaN" else v) for k, v in raw.items()}
    return m.CaseCounts(**kw)


def to_hours(raw):
    return m.HoursWorked(**{snake(k): v for k, v in raw.items()})


def to_opts(raw):
    return m.RateOptions(**{snake(k): v for k, v in raw.items()})


def test_basis():
    assert m.OSHA_HOURS_BASIS == FIXTURES["basis"] == 100 * 40 * 50


@pytest.mark.parametrize("v", FIXTURES["rates"], ids=lambda v: v["name"])
def test_rate_vector(v):
    run = lambda: FNS[v["fn"]](to_cases(v["cases"]), to_hours(v["hours"]), to_opts(v.get("options", {})))
    if v.get("throws"):
        with pytest.raises(ValueError):
            run()
        return
    r = run()
    codes = [f.code for f in r.flags]
    if "value" in v:
        if v["value"] is None:
            assert r.value is None
        else:
            assert r.value == pytest.approx(v["value"], abs=1e-10)
    if "casesUsed" in v:
        assert r.cases == v["casesUsed"]
    if "hoursUsed" in v:
        assert r.hours == v["hoursUsed"]
    for c in v.get("flagsInclude", []):
        assert c in codes
    for c in v.get("flagsExclude", []):
        assert c not in codes


@pytest.mark.parametrize("v", FIXTURES["aggregation"])
def test_aggregation(v):
    c = to_cases(v["cases"])
    assert m.total_recordable_cases(c) == v["totalRecordable"]
    assert m.dart_cases(c) == v["dart"]


@pytest.mark.parametrize("v", FIXTURES["nearMiss"])
def test_near_miss(v):
    if v.get("throws"):
        with pytest.raises(ValueError):
            m.near_miss_ratio(v["nearMisses"], v["recordables"])
    else:
        assert m.near_miss_ratio(v["nearMisses"], v["recordables"]) == v["value"]


def test_publishable_and_ordering():
    c = m.CaseCounts(days_away_cases=3, job_transfer_cases=2, other_recordable_cases=5)
    h = m.HoursWorked(employee_hours=200_000)
    assert m.ltir(c, h).value <= m.dart(c, h).value <= m.trir(c, h).value
    assert not m.is_publishable(m.check_plausibility(0))
    assert m.is_publishable(m.check_plausibility(200_000, 100, 1))

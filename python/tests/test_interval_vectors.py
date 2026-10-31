import json
import re
from pathlib import Path

import pytest

import ehs_metrics as m

FX = json.loads(
    (Path(__file__).resolve().parents[2] / "test" / "fixtures" / "interval-vectors.json").read_text()
)
TOL = 1e-9


def snake(s):
    return re.sub(r"([A-Z])", lambda x: "_" + x.group(1).lower(), s)


def num(x):
    return float("inf") if x == "Infinity" else x


def near(a, b):
    assert abs(a - b) < TOL, (a, b)


def to_cases(raw):
    return m.CaseCounts(**{snake(k): v for k, v in raw.items()})


def to_hours(raw):
    return m.HoursWorked(**{snake(k): v for k, v in raw.items()})


def kw(opts):
    return {snake(k): v for k, v in opts.items()}


def fit(sites):
    return m.fit_gamma_poisson_prior([m.SiteCounts(cases=c, hours=h) for c, h in sites])


@pytest.mark.parametrize("v", FX["poissonExact"], ids=lambda v: f"{v['count']}-{v['confidence']}")
def test_poisson_exact(v):
    lo, hi = m.poisson_exact_interval(v["count"], v["confidence"])
    near(lo, v["lower"])
    near(hi, v["upper"])


@pytest.mark.parametrize("v", FX["poissonExactThrows"], ids=str)
def test_poisson_exact_throws(v):
    with pytest.raises(ValueError):
        m.poisson_exact_interval(v["count"], v.get("confidence", 0.95))


@pytest.mark.parametrize("v", FX["rateInterval"], ids=lambda v: f"{v['cases']}-{v['hours']}-{v['confidence']}")
def test_rate_interval(v):
    r = m.rate_interval(v["cases"], v["hours"], v["confidence"])
    near(r.rate, v["rate"])
    near(r.lower, v["lower"])
    near(r.upper, v["upper"])


@pytest.mark.parametrize("v", FX["rateIntervalThrows"], ids=str)
def test_rate_interval_throws(v):
    with pytest.raises(ValueError):
        m.rate_interval(v["cases"], v["hours"])


@pytest.mark.parametrize("v", FX["trirDart"], ids=lambda v: json.dumps([v["hours"], v["options"]]))
def test_trir_dart_interval(v):
    for name, fn in (("trir", m.trir_interval), ("dart", m.dart_interval)):
        r = fn(to_cases(v["cases"]), to_hours(v["hours"]), **kw(v["options"]))
        e = v[name]
        near(r.rate, e["rate"])
        near(r.lower, e["lower"])
        near(r.upper, e["upper"])
        assert r.hours == e["hours"]


@pytest.mark.parametrize("v", FX["casesForPrecision"], ids=lambda v: f"{v['maxRatio']}-{v['confidence']}")
def test_cases_for_precision(v):
    assert m.cases_for_precision(v["maxRatio"], v["confidence"]) == v["value"]


@pytest.mark.parametrize("v", FX["gammaQuantile"], ids=lambda v: f"{v['p']}-{v['shape']}")
def test_gamma_quantile(v):
    near(m.gamma_quantile(v["p"], v["shape"]), v["value"])


@pytest.mark.parametrize("v", FX["gammaQuantileThrows"], ids=str)
def test_gamma_quantile_throws(v):
    with pytest.raises(ValueError):
        m.gamma_quantile(v["p"], v["shape"])


@pytest.mark.parametrize("name", list(FX["prior"]))
def test_fit_prior(name):
    e = FX["prior"][name]
    p = fit(e["sites"])
    near(p.mean, e["mean"])
    assert p.shape == num(e["shape"])
    assert p.rate == num(e["rate"])
    near(p.dispersion, e["dispersion"])
    assert p.sites == e["nSites"]
    assert p.total_cases == e["totalCases"]
    near(p.total_hours, e["totalHours"])


@pytest.mark.parametrize("sites", FX["priorThrows"], ids=str)
def test_fit_prior_throws(sites):
    with pytest.raises(ValueError):
        fit(sites)


@pytest.mark.parametrize("v", FX["shrink"], ids=lambda v: f"{v['prior']}-{v['cases']}-{v['hours']}-{v['confidence']}")
def test_shrink_rate(v):
    s = m.shrink_rate(v["cases"], v["hours"], fit(FX["prior"][v["prior"]]["sites"]), v["confidence"])
    for k in ("raw", "shrunk", "weight", "lower", "upper"):
        near(getattr(s, k), v[k])
    near(s.prior_mean, v["priorMean"])


@pytest.mark.parametrize("v", FX["shrinkThrows"], ids=str)
def test_shrink_rate_throws(v):
    with pytest.raises(ValueError):
        m.shrink_rate(v["cases"], v["hours"], fit(FX["prior"]["mixed"]["sites"]), v.get("confidence", 0.95))


@pytest.mark.parametrize("v", FX["shrinkTrirDart"], ids=lambda v: json.dumps([v["hours"], v["options"]]))
def test_shrink_trir_dart(v):
    p = fit(FX["prior"][v["prior"]]["sites"])
    for name, fn in (("trir", m.shrink_trir), ("dart", m.shrink_dart)):
        s = fn(to_cases(v["cases"]), to_hours(v["hours"]), p, **kw(v["options"]))
        for k in ("raw", "shrunk", "weight", "lower", "upper"):
            near(getattr(s, k), v[name][k])
        assert s.hours == v[name]["hours"]
        assert s.cases == v[name]["cases"]

import json
import re
from pathlib import Path

import pytest

import ehs_metrics as m

FX = json.loads(
    (Path(__file__).resolve().parents[2] / "test" / "fixtures" / "power-vectors.json").read_text()
)


def snake(s):
    return re.sub(r"([A-Z])", lambda x: "_" + x.group(1).lower(), s)


def near(a, b):
    assert abs(a - b) < 1e-9 * max(1.0, abs(b)), (a, b)


@pytest.mark.parametrize("v", FX["powerTwoRates"], ids=lambda v: f"{v['rate1']}-{v['rate2']}-{v['hours']}-{v.get('alpha', 0.05)}")
def test_power_two_rates(v):
    near(m.power_two_rates(v["rate1"], v["rate2"], v["hours"], v.get("alpha", 0.05)), v["value"])


@pytest.mark.parametrize("v", FX["powerTwoRatesThrows"], ids=str)
def test_power_two_rates_throws(v):
    with pytest.raises(ValueError):
        m.power_two_rates(v["rate1"], v["rate2"], v["hours"])


@pytest.mark.parametrize("v", FX["minHoursToDistinguish"], ids=lambda v: f"{v['rate1']}-{v['rate2']}-{json.dumps(v['options'])}")
def test_min_hours_to_distinguish(v):
    kw = {snake(k): x for k, x in v["options"].items()}
    near(m.min_hours_to_distinguish(v["rate1"], v["rate2"], **kw), v["value"])


@pytest.mark.parametrize("v", FX["minHoursToDistinguishThrows"], ids=str)
def test_min_hours_to_distinguish_throws(v):
    kw = {snake(k): x for k, x in v["options"].items()}
    with pytest.raises(ValueError):
        m.min_hours_to_distinguish(v["rate1"], v["rate2"], **kw)

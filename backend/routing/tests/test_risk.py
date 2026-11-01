"""Tests for services.risk."""
import pytest

from routing.services.risk import (
    RiskLevel as L,
    apply_load_rules,
    assess_checkpoint,
    classify_rain,
    classify_snow,
    classify_wind,
)


@pytest.mark.parametrize(
    "mph,expected",
    [
        (0, L.LOW), (24.9, L.LOW), (25, L.MODERATE), (34.9, L.MODERATE),
        (35, L.HIGH), (44.9, L.HIGH), (45, L.SEVERE), (54.9, L.SEVERE),
        (55, L.NO_TRAVEL), (80, L.NO_TRAVEL),
    ],
)
def test_classify_wind(mph, expected):
    assert classify_wind(mph) == expected


@pytest.mark.parametrize(
    "rain,expected",
    [
        (0, L.LOW), (0.09, L.LOW), (0.10, L.MODERATE), (0.25, L.MODERATE),
        (0.26, L.HIGH), (0.50, L.HIGH), (0.51, L.SEVERE), (1.00, L.SEVERE),
        (1.01, L.NO_TRAVEL),
    ],
)
def test_classify_rain(rain, expected):
    assert classify_rain(rain) == expected


@pytest.mark.parametrize(
    "snow,expected",
    [
        (0, L.LOW), (0.4, L.LOW), (0.5, L.MODERATE), (1.0, L.MODERATE),
        (1.1, L.HIGH), (2.0, L.HIGH), (2.1, L.SEVERE), (3.0, L.SEVERE),
        (3.1, L.NO_TRAVEL),
    ],
)
def test_classify_snow(snow, expected):
    assert classify_snow(snow) == expected


@pytest.mark.parametrize(
    "wind,load,expected",
    [
        (45, 30000, L.SEVERE),
        (45, 30001, L.NO_TRAVEL),
        (40, 40000, L.HIGH),
        (40, 40001, L.SEVERE),
        (55, 0, L.NO_TRAVEL),
        (60, 100000, L.NO_TRAVEL),
        (54.9, 30001, L.NO_TRAVEL),
    ],
)
def test_load_rules_via_assess(wind, load, expected):
    assert assess_checkpoint(wind, 0, 0, load).level == expected


@pytest.mark.parametrize("wind", [0, 10, 24.9, 25, 34.9])
def test_light_wind_never_raised_by_heavy_load(wind):
    base = classify_wind(wind)
    assert apply_load_rules(base, wind, 200000) == base
    assert assess_checkpoint(wind, 0, 0, 200000).level == base


def test_combined_takes_worst_of_three():
    a = assess_checkpoint(30, 0.30, 0, 10000)  # wind MODERATE, rain HIGH, snow LOW
    assert (a.wind_level, a.rain_level, a.snow_level) == (L.MODERATE, L.HIGH, L.LOW)
    assert a.level == L.HIGH


@pytest.mark.parametrize("level", list(L))
@pytest.mark.parametrize("wind", [0, 30, 40, 50, 60])
@pytest.mark.parametrize("load", [0, 30000, 40001, 80000])
def test_load_rules_never_lower(level, wind, load):
    assert apply_load_rules(level, wind, load) >= level


def test_severe_rain_with_heavy_load_stays_at_least_severe():
    a = assess_checkpoint(40, 0.75, 0, 45000)
    assert a.rain_level == L.SEVERE
    assert a.level >= L.SEVERE


def test_reasons_explain_load_escalation():
    a = assess_checkpoint(40, 0, 0, 45000)
    assert a.level == L.SEVERE
    text = " ".join(a.reasons)
    assert "Wind 40 mph is High" in text
    assert "45,000 lb" in text and "Severe" in text


def test_reasons_for_calm_weather():
    a = assess_checkpoint(5, 0, 0, 20000)
    assert a.level == L.LOW and a.reasons


@pytest.mark.parametrize(
    "args",
    [
        (-1, 0, 0, 0), (0, -0.1, 0, 0), (0, 0, -1, 0), (0, 0, 0, -1),
        (None, 0, 0, 0), (0, None, 0, 0), (0, 0, None, 0), (0, 0, 0, None),
        (float("nan"), 0, 0, 0), ("5", 0, 0, 0),
    ],
)
def test_invalid_input_raises(args):
    with pytest.raises(ValueError):
        assess_checkpoint(*args)


@pytest.mark.parametrize("fn", [classify_wind, classify_rain, classify_snow])
@pytest.mark.parametrize("bad", [-1, None])
def test_classifiers_reject_invalid(fn, bad):
    with pytest.raises(ValueError):
        fn(bad)

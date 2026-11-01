"""Tests for AnalyzeRequestSerializer validation."""
from datetime import timedelta

import pytest
from django.utils import timezone

from routing.serializers import AnalyzeRequestSerializer


def payload(**over):
    base = {
        "origin": {"lat": 40.0, "lng": -100.0, "label": "A"},
        "destination": {"lat": 41.5, "lng": -100.0, "label": "B"},
        "departure_time": (timezone.now() + timedelta(hours=2)).isoformat(),
        "load_weight_lb": 40000,
        "interval_miles": 25,
    }
    base.update(over)
    return base


def errors(data):
    s = AnalyzeRequestSerializer(data=data)
    assert not s.is_valid()
    return s.errors


def test_valid_payload():
    s = AnalyzeRequestSerializer(data=payload())
    assert s.is_valid(), s.errors
    v = s.validated_data
    assert v["interval_miles"] == 25 and v["departure_time"].utcoffset() is not None


def test_interval_defaults_to_25():
    data = payload()
    del data["interval_miles"]
    s = AnalyzeRequestSerializer(data=data)
    assert s.is_valid() and s.validated_data["interval_miles"] == 25


@pytest.mark.parametrize("interval", [0, 5, 20, 100, -10])
def test_bad_interval(interval):
    assert "interval_miles" in errors(payload(interval_miles=interval))


@pytest.mark.parametrize("load", [0, 1, 120000])
def test_load_bounds_ok(load):
    assert AnalyzeRequestSerializer(data=payload(load_weight_lb=load)).is_valid()


@pytest.mark.parametrize("load", [-1, 120001, "heavy", None])
def test_load_bounds_bad(load):
    assert "load_weight_lb" in errors(payload(load_weight_lb=load))


def test_departure_naive_rejected():
    naive = (timezone.now() + timedelta(hours=2)).replace(tzinfo=None).isoformat()
    assert "departure_time" in errors(payload(departure_time=naive))


@pytest.mark.parametrize("bad", ["tomorrow", "", 12345, None])
def test_departure_garbage_rejected(bad):
    assert "departure_time" in errors(payload(departure_time=bad))


def test_departure_past_limit():
    ok = (timezone.now() - timedelta(minutes=30)).isoformat()
    assert AnalyzeRequestSerializer(data=payload(departure_time=ok)).is_valid()
    too_old = (timezone.now() - timedelta(hours=2)).isoformat()
    assert "departure_time" in errors(payload(departure_time=too_old))


def test_departure_future_limit():
    ok = (timezone.now() + timedelta(days=6, hours=23)).isoformat()
    assert AnalyzeRequestSerializer(data=payload(departure_time=ok)).is_valid()
    too_far = (timezone.now() + timedelta(days=7, hours=1)).isoformat()
    assert "departure_time" in errors(payload(departure_time=too_far))


def test_z_suffix_accepted():
    z = (timezone.now() + timedelta(hours=3)).strftime("%Y-%m-%dT%H:%M:%SZ")
    assert AnalyzeRequestSerializer(data=payload(departure_time=z)).is_valid()


def test_same_origin_destination_rejected():
    same = {"lat": 40.0, "lng": -100.0, "label": "X"}
    errs = errors(payload(origin=same, destination=dict(same)))
    assert "non_field_errors" in errs


@pytest.mark.parametrize(
    "loc",
    [{"lat": 91, "lng": 0}, {"lat": 0, "lng": 181}, {"lat": "x", "lng": 0}, {"lng": 0}],
)
def test_bad_coordinates(loc):
    assert "origin" in errors(payload(origin=loc))

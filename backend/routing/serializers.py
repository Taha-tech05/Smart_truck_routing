"""DRF serializers (request validation) for the routing API."""
from __future__ import annotations

from datetime import timedelta

from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework import serializers

from .constants import ALLOWED_INTERVALS, DEFAULT_INTERVAL_MILES, MAX_LOAD_LB

MAX_PAST = timedelta(hours=1)
MAX_FUTURE = timedelta(days=7)


class AwareDateTimeField(serializers.Field):
    """ISO 8601 datetime that MUST include a timezone offset."""

    default_error_messages = {
        "invalid": "Enter a valid ISO 8601 datetime.",
        "naive": "Datetime must include a timezone (e.g. 2026-11-02T08:00:00-05:00 or ...Z).",
    }

    def to_internal_value(self, data):
        if not isinstance(data, str):
            self.fail("invalid")
        try:
            value = parse_datetime(data.strip())
        except ValueError:
            value = None
        if value is None:
            self.fail("invalid")
        if value.tzinfo is None or value.utcoffset() is None:
            self.fail("naive")
        return value

    def to_representation(self, value):
        return value.isoformat()


class LocationSerializer(serializers.Serializer):
    lat = serializers.FloatField(min_value=-90, max_value=90)
    lng = serializers.FloatField(min_value=-180, max_value=180)
    label = serializers.CharField(required=False, allow_blank=True, max_length=300, default="")


class AnalyzeRequestSerializer(serializers.Serializer):
    origin = LocationSerializer()
    destination = LocationSerializer()
    departure_time = AwareDateTimeField()
    load_weight_lb = serializers.FloatField(min_value=0, max_value=MAX_LOAD_LB)
    interval_miles = serializers.IntegerField(default=DEFAULT_INTERVAL_MILES)

    def validate_interval_miles(self, value):
        if value not in ALLOWED_INTERVALS:
            raise serializers.ValidationError(
                f"interval_miles must be one of {list(ALLOWED_INTERVALS)}"
            )
        return value

    def validate_departure_time(self, value):
        now = timezone.now()
        if value < now - MAX_PAST:
            raise serializers.ValidationError("Departure time is more than 1 hour in the past.")
        if value > now + MAX_FUTURE:
            raise serializers.ValidationError(
                "Departure time is more than 7 days ahead (beyond forecast limits)."
            )
        return value

    def validate(self, attrs):
        o, d = attrs["origin"], attrs["destination"]
        if round(o["lat"], 4) == round(d["lat"], 4) and round(o["lng"], 4) == round(d["lng"], 4):
            raise serializers.ValidationError("Origin and destination must be different places.")
        return attrs

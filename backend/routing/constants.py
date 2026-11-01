"""Shared constants for the routing app (single source of truth)."""

MILES_PER_METER = 0.000621371192
METERS_PER_MILE = 1609.344
EARTH_RADIUS_MILES = 3958.7613

ALLOWED_INTERVALS = (10, 25, 50)
DEFAULT_INTERVAL_MILES = 25

HTTP_TIMEOUT_S = 10.0

ORS_BASE_URL = "https://api.openrouteservice.org"
OPEN_METEO_BASE_URL = "https://api.open-meteo.com/v1/forecast"

MAX_LOAD_LB = 120_000

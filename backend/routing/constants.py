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

# Heatmap (corridor risk grid)
HEATMAP_HOURS = 48                 # hour 0 .. hour 48 -> 49 slots
MAX_GRID_POINTS = 150
DEFAULT_CORRIDOR_MILES = 30
MIN_CORRIDOR_MILES = 10
MAX_CORRIDOR_MILES = 60
GRID_DEDUPE_MILES = 7              # weather cache cells are 0.1 degrees (~7 mi)
MAX_ROUTE_VERTICES = 5000          # longer geometries are simplified server-side
MAX_REQUEST_VERTICES = 50_000      # hard request limit (abuse guard)

# Weather cache key precision (decimal places of lat/lng).
WEATHER_PRECISION_DEFAULT = 1      # 0.1 degree (~7 mi): fine for the smoothed heatmap
WEATHER_PRECISION_ANALYZE = 2      # 0.01 degree (~0.7 mi): a checkpoint never gets another place's weather

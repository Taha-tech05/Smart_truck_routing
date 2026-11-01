"""Routing app views."""
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .serializers import AnalyzeRequestSerializer
from .services import geocoding
from .services.analysis import analyze_trip


@api_view(["GET"])
def health(request):
    """Liveness check."""
    return Response({"status": "ok"})


@api_view(["GET"])
def geocode_view(request):
    """GET /api/geocode?q=... -> [{label, lat, lng}] (as-you-type suggestions)."""
    return Response(geocoding.autocomplete(request.query_params.get("q", "")))


@api_view(["POST"])
def analyze_view(request):
    """POST /api/analyze -> ranked routes with per-checkpoint weather risk."""
    ser = AnalyzeRequestSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    v = ser.validated_data
    result = analyze_trip(
        origin=dict(v["origin"]),
        destination=dict(v["destination"]),
        departure=v["departure_time"],
        load_lb=v["load_weight_lb"],
        interval_miles=v["interval_miles"],
    )
    return Response(result)

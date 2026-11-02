"""Consistent API error format: ``{"error": {"code", "message"}}``."""
from __future__ import annotations

import logging

from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler

from .services.geocoding import EmptyQueryError, NoResultsError
from .services.routing_client import (
    NoRouteFoundError,
    RoutingAuthError,
    RoutingRateLimitError,
    RoutingTimeoutError,
    RoutingUpstreamError,
)
from .services.weather_client import WeatherError


log = logging.getLogger(__name__)


def _redact(text: str) -> str:
    """Never let the ORS key reach a response body, even by accident."""
    from django.conf import settings

    key = getattr(settings, "ORS_API_KEY", "")
    return text.replace(key, "[redacted]") if key else text


def _body(code: str, message: str, details=None, service: str | None = None) -> dict:
    err = {"code": code, "message": message}
    if service:
        err["service"] = service
    if details is not None:
        err["details"] = details
    return {"error": err}


def _first_message(detail) -> str:
    """Flatten DRF validation detail into one readable sentence."""
    parts: list[str] = []

    def walk(d, prefix=""):
        if isinstance(d, dict):
            for k, v in d.items():
                walk(v, f"{prefix}{k}: " if not prefix else f"{prefix}{k}.")
        elif isinstance(d, list):
            for v in d:
                walk(v, prefix)
        else:
            parts.append(f"{prefix}{d}")

    walk(detail)
    return "; ".join(parts) or "Invalid request"


def api_exception_handler(exc, context):
    """DRF exception handler producing the unified error envelope."""
    mapping = [
        (EmptyQueryError, status.HTTP_400_BAD_REQUEST, "empty_query"),
        (NoResultsError, status.HTTP_404_NOT_FOUND, "no_results"),
        (NoRouteFoundError, status.HTTP_400_BAD_REQUEST, "no_route"),
        (RoutingRateLimitError, status.HTTP_429_TOO_MANY_REQUESTS, "rate_limited"),
        (RoutingAuthError, status.HTTP_502_BAD_GATEWAY, "routing_auth_failed"),
        (RoutingTimeoutError, status.HTTP_502_BAD_GATEWAY, "routing_timeout"),
        (RoutingUpstreamError, status.HTTP_502_BAD_GATEWAY, "routing_unavailable"),
        (WeatherError, status.HTTP_502_BAD_GATEWAY, "weather_unavailable"),
    ]
    for cls, http_status, code in mapping:
        if isinstance(exc, cls):
            service = getattr(exc, "service", None)
            message = _redact(str(exc))
            if http_status >= 500 and service:
                message = f"{service} failed: {message}"
                log.error("analyze upstream error service=%r code=%s type=%s", service, code, type(exc).__name__)
            return Response(_body(code, message, service=service), status=http_status)

    response = drf_exception_handler(exc, context)
    if response is None:
        log.exception("unhandled error in %s", getattr(context.get("view"), "__class__", type(None)).__name__)
        return None  # unexpected error -> normal 500 handling
    if isinstance(exc, ValidationError):
        response.data = _body("validation_error", _first_message(exc.detail), exc.detail)
    else:
        detail = response.data.get("detail", "Request failed") if isinstance(response.data, dict) else "Request failed"
        code = getattr(getattr(exc, "detail", None), "code", None) or "error"
        response.data = _body(str(code), str(detail))
    return response

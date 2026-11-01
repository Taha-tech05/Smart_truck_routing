"""Weather risk scoring. Pure functions, no I/O, no Django imports.

Units: wind in mph, rain in inches/hour, snow in inches/hour, load in pounds.

Boundary convention
-------------------
Wind (lower bound inclusive):
    <25 LOW | 25<=w<35 MODERATE | 35<=w<45 HIGH | 45<=w<55 SEVERE | >=55 NO_TRAVEL
Rain (upper bound inclusive):
    <0.10 LOW | 0.10<=r<=0.25 MODERATE | 0.25<r<=0.50 HIGH
    | 0.50<r<=1.00 SEVERE | >1.00 NO_TRAVEL
Snow (upper bound inclusive):
    <0.5 LOW | 0.5<=s<=1.0 MODERATE | 1.0<s<=2.0 HIGH
    | 2.0<s<=3.0 SEVERE | >3.0 NO_TRAVEL

Load overrides only ever escalate a level, never lower it. Load limits are
strict ``>`` (a load exactly at the limit is not penalised):
    wind >= 55                      -> NO_TRAVEL (any load)
    45 <= wind < 55 and load > 30000 -> NO_TRAVEL
    35 <= wind < 45 and load > 40000 -> at least SEVERE

Inputs that are None, non-numeric, negative or NaN raise ValueError.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from enum import IntEnum


class RiskLevel(IntEnum):
    LOW = 0
    MODERATE = 1
    HIGH = 2
    SEVERE = 3
    NO_TRAVEL = 4

    @property
    def label(self) -> str:
        return {
            RiskLevel.NO_TRAVEL: "No Travel",
        }.get(self, self.name.capitalize())


@dataclass(frozen=True)
class RiskAssessment:
    level: RiskLevel
    wind_level: RiskLevel
    rain_level: RiskLevel
    snow_level: RiskLevel
    reasons: list[str] = field(default_factory=list)


def _validate(name: str, value: float) -> float:
    if value is None:
        raise ValueError(f"{name} is required (got None)")
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be a number (got {value!r})")
    if math.isnan(value):
        raise ValueError(f"{name} must not be NaN")
    if value < 0:
        raise ValueError(f"{name} must not be negative (got {value})")
    return float(value)


def classify_wind(mph: float) -> RiskLevel:
    w = _validate("wind_mph", mph)
    if w >= 55:
        return RiskLevel.NO_TRAVEL
    if w >= 45:
        return RiskLevel.SEVERE
    if w >= 35:
        return RiskLevel.HIGH
    if w >= 25:
        return RiskLevel.MODERATE
    return RiskLevel.LOW


def classify_rain(in_per_hr: float) -> RiskLevel:
    r = _validate("rain_in_hr", in_per_hr)
    if r > 1.00:
        return RiskLevel.NO_TRAVEL
    if r > 0.50:
        return RiskLevel.SEVERE
    if r > 0.25:
        return RiskLevel.HIGH
    if r >= 0.10:
        return RiskLevel.MODERATE
    return RiskLevel.LOW


def classify_snow(in_per_hr: float) -> RiskLevel:
    s = _validate("snow_in_hr", in_per_hr)
    if s > 3.0:
        return RiskLevel.NO_TRAVEL
    if s > 2.0:
        return RiskLevel.SEVERE
    if s > 1.0:
        return RiskLevel.HIGH
    if s >= 0.5:
        return RiskLevel.MODERATE
    return RiskLevel.LOW


def apply_load_rules(level: RiskLevel, wind_mph: float, load_lb: float) -> RiskLevel:
    """Escalate ``level`` based on wind and load. Never returns a lower level."""
    wind = _validate("wind_mph", wind_mph)
    load = _validate("load_lb", load_lb)
    level = RiskLevel(level)

    if wind >= 55:
        floor = RiskLevel.NO_TRAVEL
    elif wind >= 45 and load > 30000:
        floor = RiskLevel.NO_TRAVEL
    elif wind >= 35 and load > 40000:
        floor = RiskLevel.SEVERE
    else:
        return level
    return max(level, floor)


def assess_checkpoint(
    wind_mph: float, rain_in_hr: float, snow_in_hr: float, load_lb: float
) -> RiskAssessment:
    wind_level = classify_wind(wind_mph)
    rain_level = classify_rain(rain_in_hr)
    snow_level = classify_snow(snow_in_hr)
    load = _validate("load_lb", load_lb)

    base = max(wind_level, rain_level, snow_level)
    final = apply_load_rules(base, wind_mph, load)

    reasons: list[str] = []
    if base == RiskLevel.LOW:
        reasons.append("Wind, rain and snow are all within low-risk limits")
    else:
        for name, value, unit, lvl in (
            ("Wind", wind_mph, "mph", wind_level),
            ("Rain", rain_in_hr, "in/hr", rain_level),
            ("Snow", snow_in_hr, "in/hr", snow_level),
        ):
            if lvl > RiskLevel.LOW:
                driver = " (driving the overall level)" if lvl == base else ""
                reasons.append(f"{name} {value:g} {unit} is {lvl.label}{driver}")

    if final > base:
        reasons.append(
            f"Load {load:,.0f} lb with wind {wind_mph:g} mph raises the level "
            f"from {base.label} to {final.label}"
        )
    return RiskAssessment(final, wind_level, rain_level, snow_level, reasons)

import type { RiskLevelValue } from '../types'

export const LEVEL_NAMES = ['Low', 'Moderate', 'High', 'Severe', 'No Travel'] as const

/** CSS variable (from tokens.css) for each risk level. */
export const RISK_VARS = [
  '--risk-low',
  '--risk-moderate',
  '--risk-high',
  '--risk-severe',
  '--risk-notravel',
] as const

export const MILES_KEYS = ['low', 'moderate', 'high', 'severe', 'no_travel'] as const

export function levelName(level: number): string {
  return LEVEL_NAMES[level] ?? 'Unknown'
}

/** `var(--risk-x)` string for use in inline styles. */
export function riskCssVar(level: number): string {
  return `var(${RISK_VARS[level] ?? RISK_VARS[0]})`
}

/** Resolved colour (hex) of a risk level in the current theme, for MapLibre paint properties. */
export function riskColor(level: number): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(RISK_VARS[level]).trim()
  return v || '#888888'
}

export function tokenColor(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888888'
}

export function isLevel(n: number): n is RiskLevelValue {
  return n >= 0 && n <= 4
}

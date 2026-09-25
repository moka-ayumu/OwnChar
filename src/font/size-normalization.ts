export const DEFAULT_HANGUL_HEIGHT = 760

export function medianHeight(values: number[], fallback: number) {
  const sorted = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b)
  if (!sorted.length) return fallback
  return sorted[Math.floor(sorted.length / 2)]
}

export function normalizationFactor(height: number, target: number, strength: number, minimum = 0.75) {
  if (height <= 0 || !Number.isFinite(height)) return 1
  const bounded = Math.max(minimum, Math.min(1.25, target / height))
  return 1 + Math.max(0, Math.min(1, strength)) * (bounded - 1)
}

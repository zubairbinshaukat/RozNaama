/** Compact axis ticks: 1500 → "1.5k", 2_000_000 → "2M". */
export function compactTick(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 1_000_000) return `${+(v / 1_000_000).toFixed(1)}M`
  if (abs >= 1000) return `${+(v / 1000).toFixed(1)}k`
  return String(v)
}

/** Axis ticks while amounts are hidden. */
export function hiddenTick(): string {
  return '•••'
}


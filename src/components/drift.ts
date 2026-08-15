import type { Drift } from '../lib/semver'

export const DRIFT_SWATCH: Record<Drift, string> = {
  major: 'var(--d-major)',
  minor: 'var(--d-minor)',
  patch: 'var(--d-patch)',
  current: 'var(--d-current)',
  ahead: 'var(--d-ahead)',
  unknown: 'var(--d-unknown)',
}

/** Short forms for the table badge; the legend carries the long forms. */
export const DRIFT_BADGE: Record<Drift, string> = {
  major: 'Major',
  minor: 'Minor',
  patch: 'Patch',
  current: 'Current',
  ahead: 'Ahead',
  unknown: '—',
}

export function formatDate(iso?: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' })
}

export interface SemVer {
  major: number
  minor: number
  patch: number
  pre: string[]
  tag: string
}

export type Drift = 'current' | 'patch' | 'minor' | 'major' | 'ahead' | 'unknown'

const CORE = /^[vV]?(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

/** Accepts `1.2.3`, `v1.2`, `1.2.3-beta.1`, and prefixed tags like `Alamofire-5.0.0`. */
export function parseSemver(tag: string): SemVer | null {
  const raw = tag.trim()
  const attempts = [raw]

  // Tags occasionally carry a product prefix: `Alamofire-5.0.0`, `release/2.1.0`.
  const stripped = raw.replace(/^.*?[/_-](?=\d)/, '')
  if (stripped !== raw) attempts.push(stripped)

  for (const candidate of attempts) {
    const m = CORE.exec(candidate)
    if (!m) continue
    return {
      major: Number(m[1]),
      minor: Number(m[2]),
      patch: m[3] ? Number(m[3]) : 0,
      pre: m[4] ? m[4].split('.') : [],
      tag: raw,
    }
  }
  return null
}

function comparePre(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0
  if (a.length === 0) return 1
  if (b.length === 0) return -1
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i]
    const y = b[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const nx = /^\d+$/.test(x)
    const ny = /^\d+$/.test(y)
    if (nx && ny) {
      if (Number(x) !== Number(y)) return Number(x) - Number(y)
    } else if (nx !== ny) {
      return nx ? -1 : 1
    } else if (x !== y) {
      return x < y ? -1 : 1
    }
  }
  return 0
}

export function compareSemver(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  if (a.patch !== b.patch) return a.patch - b.patch
  return comparePre(a.pre, b.pre)
}

export function driftLevel(pinned: SemVer | null, latest: SemVer | null): Drift {
  if (!pinned || !latest) return 'unknown'
  const cmp = compareSemver(pinned, latest)
  if (cmp > 0) return 'ahead'
  if (cmp === 0) return 'current'
  if (latest.major !== pinned.major) return 'major'
  if (latest.minor !== pinned.minor) return 'minor'
  return 'patch'
}

export interface Segment {
  text: string
  changed: boolean
}

/**
 * Splits `latest` into segments, marking everything from the first segment that
 * differs from `pinned` onward as changed. This is the read-at-a-glance signal:
 * what actually moved.
 */
export function diffSegments(latest: SemVer, pinned: SemVer | null): Segment[] {
  const nums: Array<[keyof SemVer, number]> = [
    ['major', latest.major],
    ['minor', latest.minor],
    ['patch', latest.patch],
  ]
  const pinnedNums = pinned ? [pinned.major, pinned.minor, pinned.patch] : null

  let firstChanged = pinnedNums ? nums.findIndex(([, v], i) => v !== pinnedNums[i]) : 0
  if (!pinned) firstChanged = -1
  if (pinnedNums && firstChanged === -1) firstChanged = Number.POSITIVE_INFINITY

  const out: Segment[] = []
  nums.forEach(([, value], i) => {
    const changed = pinnedNums ? i >= firstChanged : false
    if (i > 0) out.push({ text: '.', changed })
    out.push({ text: String(value), changed })
  })
  if (latest.pre.length) out.push({ text: `-${latest.pre.join('.')}`, changed: true })
  return out
}

export const DRIFT_LABEL: Record<Drift, string> = {
  current: 'Current',
  patch: 'Patch behind',
  minor: 'Minor behind',
  major: 'Major behind',
  ahead: 'Ahead of tags',
  unknown: 'Unknown',
}

export const DRIFT_ORDER: Drift[] = ['major', 'minor', 'patch', 'current', 'ahead', 'unknown']

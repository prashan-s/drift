import { driftLevel, parseSemver, type Drift } from '../lib/semver'
import type { LatestState } from '../lib/session'
import type { PinState } from './core/types'

export interface VersionView {
  /** The version the manifest or lockfile states, when it states one. */
  pinned?: string
  /** The newest release GitHub knows about. */
  latest?: string
  drift: Drift
  /** Why there is no comparison, when there is none. */
  note?: string
}

/**
 * Compares what a package resolved to against what it could have resolved to.
 *
 * A branch or bare-revision pin has no semantic version, so there is nothing to
 * compare and the result says so rather than reporting a misleading `unknown`
 * that reads like a failure.
 */
export function versionView(
  state: PinState | undefined,
  latest: LatestState | undefined,
): VersionView {
  const pinned = state?.kind === 'version' ? state.version : undefined

  // Never asked and asked-but-waiting are different facts. Reporting the first
  // as "Checking…" promises a result that is not coming.
  if (!latest) return { pinned, drift: 'unknown', note: 'unchecked' }
  if (latest.status === 'loading') return { pinned, drift: 'unknown', note: 'Checking…' }
  if (latest.status === 'error' || latest.status === 'empty') {
    return { pinned, drift: 'unknown', note: latest.message }
  }

  const newest = latest.release.tag

  if (!state) return { latest: newest, drift: 'unknown', note: 'no pin to compare' }
  if (state.kind === 'branch') {
    return { latest: newest, drift: 'unknown', note: `Tracks ${state.branch}` }
  }
  if (state.kind === 'revision') {
    return { latest: newest, drift: 'unknown', note: 'Pinned to a commit' }
  }
  if (!pinned) return { latest: newest, drift: 'unknown', note: 'Unpinned' }

  return { pinned, latest: newest, drift: driftLevel(parseSemver(pinned), parseSemver(newest)) }
}

/** True when the pin is behind the newest release by any segment. */
export function isBehind(drift: Drift): boolean {
  return drift === 'major' || drift === 'minor' || drift === 'patch'
}

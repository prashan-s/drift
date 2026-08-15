import { identityFor, normalizeRepository } from './repository'
import type { PackageIdentity, PinState, ResolvedFile, ResolvedPackage } from './types'

/** 4 MB. A `Package.resolved` for a very large app is a few hundred KB. */
export const MAX_INPUT_BYTES = 4 * 1024 * 1024

export class ResolvedParseError extends Error {
  /** What the developer should do about it. Rendered under the message. */
  readonly remedy?: string
  constructor(message: string, remedy?: string) {
    super(message)
    this.name = 'ResolvedParseError'
    this.remedy = remedy
  }
}

interface RawState {
  version?: unknown
  branch?: unknown
  revision?: unknown
}

interface RawPin {
  identity?: unknown
  package?: unknown
  location?: unknown
  repositoryURL?: unknown
  kind?: unknown
  state?: unknown
}

/**
 * Parses `Package.resolved` schema versions 1, 2 and 3.
 *
 * v1 nests pins under `object.pins` and names fields `package` /
 * `repositoryURL`; v2 and v3 hoist `pins` to the top level and use `identity` /
 * `location`. v3 adds `originHash`, which changes nothing we read. Rather than
 * switching on the declared version we accept either shape, so a schema v4 that
 * keeps the same pin fields keeps working.
 */
export function parseResolved(text: string): ResolvedFile {
  if (byteLength(text) > MAX_INPUT_BYTES) {
    throw new ResolvedParseError(
      `That file is larger than the ${Math.round(MAX_INPUT_BYTES / 1024 / 1024)} MB limit.`,
      'A Package.resolved is normally well under 1 MB. Check you picked the right file.',
    )
  }

  const trimmed = text.trim()
  if (!trimmed) {
    throw new ResolvedParseError(
      'Nothing to parse — the input is empty.',
      'Drop a Package.resolved file here, or paste its JSON.',
    )
  }

  let json: unknown
  try {
    json = JSON.parse(trimmed)
  } catch (error) {
    throw new ResolvedParseError(
      `That is not valid JSON: ${(error as Error).message}`,
      trimmed.startsWith('//') || trimmed.startsWith('import ')
        ? 'This looks like a Package.swift. This tool needs Package.resolved, which sits beside it (or in xcshareddata/swiftpm/).'
        : 'Check for a truncated copy-paste — the file must start with { and end with }.',
    )
  }

  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    throw new ResolvedParseError(
      'That JSON is not a Package.resolved object.',
      'The file should be a JSON object with a "pins" array.',
    )
  }

  const root = json as Record<string, unknown>
  const nested = root.object as Record<string, unknown> | undefined
  const rawPins = Array.isArray(root.pins)
    ? root.pins
    : Array.isArray(nested?.pins)
      ? (nested.pins as unknown[])
      : undefined

  if (!rawPins) {
    throw new ResolvedParseError(
      'No "pins" array found.',
      'Schema v1 keeps pins under "object.pins"; v2 and v3 keep them at the top level. Neither was present.',
    )
  }

  const schemaVersion = Number(root.version)
  const packages: ResolvedPackage[] = []

  rawPins.forEach((entry, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return
    const pin = entry as RawPin

    const location = str(pin.location) ?? str(pin.repositoryURL) ?? ''
    const repository = normalizeRepository(location)
    const explicitIdentity = str(pin.identity)
    const v1Name = str(pin.package)

    // v2/v3 state `identity` outright. v1 does not, but SwiftPM derives identity
    // from the repository name lowercased, so we do the same.
    const identity = (explicitIdentity ?? identityFor(repository) ?? v1Name ?? `pin-${index + 1}`)
      .toLowerCase()

    packages.push({
      order: index,
      identity,
      displayName: v1Name ?? undefined,
      repository,
      state: readState(pin.state),
      kind: str(pin.kind) ?? undefined,
    })
  })

  return {
    schemaVersion: Number.isFinite(schemaVersion) ? schemaVersion : 0,
    packages,
    duplicateIdentities: findDuplicates(packages),
  }
}

function readState(value: unknown): PinState {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { kind: 'unpinned' }
  }
  const state = value as RawState
  const version = str(state.version)
  const branch = str(state.branch)
  const revision = str(state.revision)

  // A pin carries at most one of version/branch; revision accompanies either.
  if (version) return { kind: 'version', version, revision: revision ?? undefined }
  if (branch) return { kind: 'branch', branch, revision: revision ?? undefined }
  if (revision) return { kind: 'revision', revision }
  return { kind: 'unpinned' }
}

/** Non-empty strings only. JSON nulls and numbers become `undefined`. */
function str(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function findDuplicates(packages: ResolvedPackage[]): PackageIdentity[] {
  const seen = new Map<PackageIdentity, number>()
  packages.forEach((pkg) => seen.set(pkg.identity, (seen.get(pkg.identity) ?? 0) + 1))
  return [...seen.entries()]
    .filter(([, count]) => count > 1)
    .map(([identity]) => identity)
    .sort()
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

/** Human label for a pin, e.g. `1.4.0`, `branch main`, `rev 12d6f02`. */
export function pinLabel(state: PinState): string {
  switch (state.kind) {
    case 'version':
      return state.version
    case 'branch':
      return `branch ${state.branch}`
    case 'revision':
      return `rev ${state.revision.slice(0, 7)}`
    default:
      return 'unpinned'
  }
}

/** The git ref to read a manifest at: the exact revision when we have one. */
export function pinnedRef(state: PinState): { ref: string; exact: boolean } | undefined {
  switch (state.kind) {
    case 'revision':
      return { ref: state.revision, exact: true }
    case 'version':
      return state.revision
        ? { ref: state.revision, exact: true }
        : { ref: state.version, exact: false }
    case 'branch':
      return state.revision
        ? { ref: state.revision, exact: true }
        : { ref: state.branch, exact: false }
    default:
      return undefined
  }
}

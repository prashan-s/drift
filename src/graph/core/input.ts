import { parseManifestDependencies } from './manifest'
import { identityFor } from './repository'
import { MAX_INPUT_BYTES, parseResolved, ResolvedParseError } from './resolved'
import type { PackageIdentity, ResolvedFile, ResolvedPackage } from './types'

export { ResolvedParseError as InputParseError } from './resolved'

/**
 * Accepts either file a Swift package repository keeps at its root.
 *
 * `Package.resolved` is the richer input: it carries resolved versions and the
 * exact revisions that make an edge verifiable. `Package.swift` carries only
 * requirements, so every package taken from one is unpinned — the analysis then
 * reads manifests at the default branch and marks the resulting edges unknown,
 * which is exactly what is true of them.
 */
export function parseInput(text: string): ResolvedFile {
  const trimmed = text.trim()

  if (!trimmed) {
    throw new ResolvedParseError(
      'Nothing to analyse.',
      'Drop a Package.resolved or Package.swift, or paste its contents.',
    )
  }

  if (new TextEncoder().encode(trimmed).length > MAX_INPUT_BYTES) {
    throw new ResolvedParseError(
      `Larger than the ${MAX_INPUT_BYTES / 1024 / 1024} MB limit.`,
      'Neither of these files is normally anywhere near that size.',
    )
  }

  if (trimmed.startsWith('{')) return parseResolved(trimmed)
  if (trimmed.includes('.package(')) return fromManifest(trimmed)

  throw new ResolvedParseError(
    'Unrecognised input.',
    'A Package.resolved starts with "{". A Package.swift contains at least one .package( declaration.',
  )
}

function fromManifest(source: string): ResolvedFile {
  const dependencies = parseManifestDependencies(source)

  if (!dependencies.length) {
    throw new ResolvedParseError(
      'That Package.swift declares no package dependencies.',
      'Only .package(url:) declarations can be followed; path and registry dependencies name no repository.',
    )
  }

  const packages: ResolvedPackage[] = dependencies.map((dependency, order) => ({
    order,
    identity: identityFor(dependency.repository) ?? `dependency-${order + 1}`,
    repository: dependency.repository,
    // A manifest states a requirement, not a resolution. Calling that a pin
    // would invent a version the file does not contain.
    state: { kind: 'unpinned' },
    kind: 'manifestDeclaration',
  }))

  const seen = new Map<PackageIdentity, number>()
  for (const pkg of packages) seen.set(pkg.identity, (seen.get(pkg.identity) ?? 0) + 1)

  return {
    schemaVersion: 0,
    packages,
    duplicateIdentities: [...seen.entries()]
      .filter(([, count]) => count > 1)
      .map(([identity]) => identity)
      .sort(),
  }
}

import type { PackageIdentity, PackageRepository } from './types'

/**
 * A set of organisations whose packages become graph nodes.
 *
 * Membership is compared case-insensitively but only ever as a whole path
 * segment — `bhashacodex` and `bhasha-code` are different organisations and
 * must not match.
 */
export type OrgSet = ReadonlySet<string>

/**
 * Normalises a list of organisation names into a comparable set.
 *
 * There is deliberately no fallback. Which organisations are yours is stored
 * configuration, and a function that quietly substitutes a built-in name when
 * handed nothing would make an unconfigured app indistinguishable from a
 * configured one.
 */
export function orgSet(orgs: Iterable<string>): OrgSet {
  const set = new Set<string>()
  for (const org of orgs) {
    const trimmed = org.trim().toLowerCase()
    if (trimmed) set.add(trimmed)
  }
  return set
}

const NOT_GITHUB: PackageRepository = { raw: '', host: 'other' }

/**
 * Matches the forms SwiftPM actually writes into `Package.resolved` and the
 * forms developers paste by hand:
 *
 *   https://github.com/owner/repo.git
 *   https://github.com/owner/repo
 *   http://github.com/owner/repo/
 *   github.com/owner/repo
 *   www.github.com/owner/repo
 *   git@github.com:owner/repo.git
 *   ssh://git@github.com/owner/repo.git
 *   git+https://github.com/owner/repo.git
 */
const SCP_SSH = /^(?:ssh:\/\/)?git@github\.com:(?<owner>[^/\s]+)\/(?<repo>[^/\s]+?)\/*$/i
const URL_LIKE =
  /^(?:git\+)?(?:https?|ssh|git):\/\/(?:[^@/\s]+@)?(?:www\.)?github\.com\/(?<owner>[^/\s]+)\/(?<repo>[^/\s?#]+)/i
const BARE = /^(?:www\.)?github\.com\/(?<owner>[^/\s]+)\/(?<repo>[^/\s?#]+)/i

/**
 * Normalises a package location into comparable parts.
 *
 * Never throws: anything unrecognised comes back as `host: 'other'`, which the
 * caller treats as "not an internal package" rather than as an error.
 */
export function normalizeRepository(location: string): PackageRepository {
  const raw = location ?? ''
  const trimmed = raw.trim()
  if (!trimmed) return { ...NOT_GITHUB, raw }

  const match =
    SCP_SSH.exec(trimmed) ?? URL_LIKE.exec(trimmed) ?? BARE.exec(trimmed)
  if (!match?.groups) return { ...NOT_GITHUB, raw }

  const owner = match.groups.owner
  const name = stripGitSuffix(match.groups.repo)
  // `https://github.com/owner/` has an owner but no repository.
  if (!owner || !name || name === '.' || name === '..') return { ...NOT_GITHUB, raw }

  return {
    raw,
    host: 'github',
    owner,
    name,
    ownerKey: owner.toLowerCase(),
    url: `https://github.com/${owner}/${name}`,
  }
}

function stripGitSuffix(segment: string): string {
  return segment.replace(/\.git$/i, '').replace(/\/+$/, '')
}

/**
 * True only for `github.com/<org>/<repo>` where `org` is one of `orgs`.
 *
 * Required, not defaulted: which organisations count is user configuration, so
 * every caller has to say which set it means. A default here is a hardcoded
 * answer hiding inside a signature.
 */
export function isInternal(repository: PackageRepository, orgs: OrgSet): boolean {
  return (
    repository.host === 'github' &&
    repository.ownerKey !== undefined &&
    orgs.has(repository.ownerKey)
  )
}

/**
 * The key two locations are considered the same package under.
 *
 * SwiftPM's own `identity` is the repository name lowercased, so deriving the
 * key from the URL keeps a `Package.swift` declaration and a `Package.resolved`
 * pin pointing at the same node even though only one of them carries an
 * explicit identity field.
 */
export function identityFor(repository: PackageRepository): PackageIdentity | undefined {
  return repository.name?.toLowerCase()
}

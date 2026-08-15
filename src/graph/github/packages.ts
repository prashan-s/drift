import { parseManifestDependencies } from '../core/manifest'
import { pinnedRef } from '../core/resolved'
import type { ManifestStatus, PackageRepository, PinState } from '../core/types'
import { GitHubClient, GitHubError } from './client'

/**
 * Reads a package's `Package.swift` so its outgoing edges can be drawn.
 *
 * Reads at the exact pinned revision when `Package.resolved` recorded one —
 * that is the only case whose edges are `verified`. A read at a tag or the
 * default branch still produces real declarations, but for a different commit,
 * so those edges are labelled `unknown` rather than promoted.
 */
export async function fetchManifest(
  client: GitHubClient,
  repository: PackageRepository,
  state: PinState,
): Promise<ManifestStatus> {
  const base = repoPath(repository)
  const pinned = pinnedRef(state)

  if (pinned) {
    try {
      const source = await client.raw(
        `${base}/contents/Package.swift?ref=${encode(pinned.ref)}`,
      )
      const dependencies = parseManifestDependencies(source)
      return pinned.exact
        ? { kind: 'exact', ref: pinned.ref, dependencies }
        : {
            kind: 'fallback',
            ref: pinned.ref,
            reason: `Package.resolved recorded no revision for this pin, so the manifest was read at ${pinned.ref}.`,
            dependencies,
          }
    } catch (error) {
      const failure = asGitHubError(error)
      if (failure.status === 403) return unavailable(failure)
      // 404 here means the ref exists but has no manifest, or the ref is gone.
      // Fall through to the default branch rather than reporting nothing.
    }
  }

  try {
    const source = await client.raw(`${base}/contents/Package.swift`)
    return {
      kind: 'fallback',
      ref: 'default branch',
      reason: pinned
        ? `Package.swift was not readable at ${pinned.ref}, so the default branch was used. Its dependencies may differ from the pinned commit.`
        : 'This package has no version, branch or revision pin, so the default branch was used.',
      dependencies: parseManifestDependencies(source),
    }
  } catch (error) {
    return unavailable(asGitHubError(error))
  }
}

function unavailable(error: GitHubError): ManifestStatus {
  return { kind: 'unavailable', reason: error.message, remedy: error.remedy }
}

function asGitHubError(error: unknown): GitHubError {
  return error instanceof GitHubError ? error : new GitHubError(String(error), 0)
}

function repoPath(repository: PackageRepository): string {
  return `/repos/${encode(repository.owner ?? '')}/${encode(repository.name ?? '')}`
}

function encode(value: string): string {
  return encodeURIComponent(value)
}


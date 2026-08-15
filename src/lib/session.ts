import { createContext, useContext } from 'react'
import type { RateLimit, Release } from './github'

/**
 * What is known about a repository's newest release.
 *
 * `fromCache` and `previous` are what make the local-first flow legible: a
 * value read from IndexedDB says so, and when the network later disagrees with
 * it, the old tag is kept so the UI can show what moved rather than silently
 * swapping the number.
 */
export type LatestState =
  | { status: 'loading'; release?: Release; fromCache?: true }
  | {
      status: 'ok'
      release: Release
      origin: 'releases' | 'tags'
      /** True until the network confirms it. */
      fromCache?: boolean
      fetchedAt?: number
      /** The tag this replaced, set only when a refresh changed it. */
      previous?: string
    }
  | { status: 'empty'; message: string }
  | { status: 'error'; message: string }

/** Cache key for the shared release store. */
export function repoKey(owner: string, repo: string): string {
  return `${owner}/${repo}`.toLowerCase()
}

export interface Session {
  token: string
  setToken: (token: string) => void
  rate: RateLimit | null
  setRate: (rate: RateLimit) => void

  /** The Package.resolved or Package.swift both views work from. */
  manifest: string
  /** Where it came from, for display. Undefined once hand-edited. */
  manifestSource?: string
  setManifest: (text: string, source?: string) => void

  latest: Record<string, LatestState>
  /** Publishes a result both views can read, and persists it locally. */
  publishLatest: (key: string, state: LatestState) => void
  /** Fetches `owner/repo` unless it is already known or in flight. */
  requestLatest: (owner: string, repo: string) => void
  /** True until the local copy has been read back from IndexedDB. */
  hydrating: boolean

  /** Organisations whose packages count as internal. Lowercased. */
  orgs: string[]
  setOrgs: (orgs: string[]) => void
}

export const SessionContext = createContext<Session | null>(null)

export function useSession(): Session {
  const session = useContext(SessionContext)
  if (!session) throw new Error('useSession must be used inside the app shell')
  return session
}

export const TOKEN_KEY = 'drift.token'

/** Set VITE_GITHUB_TOKEN in .env.local to skip pasting a token every session. */
export const ENV_TOKEN: string = import.meta.env.VITE_GITHUB_TOKEN ?? ''

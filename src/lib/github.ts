import { compareSemver, parseSemver, type SemVer } from './semver'

export interface Release {
  tag: string
  semver: SemVer
  date?: string
  url: string
  prerelease: boolean
}

export interface RateLimit {
  remaining: number
  limit: number
  resetAt?: number
}

export type LookupResult =
  | { status: 'ok'; releases: Release[]; origin: 'releases' | 'tags' }
  | { status: 'empty'; message: string }
  | { status: 'error'; message: string; rateLimited?: boolean }

/**
 * How much release history to ask GitHub for.
 *
 * `latest` is what a scan needs: drift is measured against the newest release
 * alone, so the earlier two are dead weight on every row of a large manifest.
 * `history` is fetched per package, only when someone opens that row.
 */
export type Depth = 'latest' | 'history'

/**
 * Page size per depth. `latest` deliberately asks for more than the one release
 * it keeps: GitHub returns releases newest-first *by date*, and a patch
 * backported onto an older major would otherwise be reported as the latest
 * version. Ten is enough to rank honestly and still a third of the old payload.
 */
const PAGE_SIZE: Record<Depth, number> = { latest: 10, history: 100 }
const KEEP: Record<Depth, number> = { latest: 1, history: 3 }

const API = 'https://api.github.com'

interface FetchOptions {
  token?: string
  includePrerelease: boolean
  /** Defaults to `latest`. */
  depth?: Depth
  onRateLimit?: (rate: RateLimit) => void
  signal?: AbortSignal
}

interface ReleaseJSON {
  tag_name?: string
  draft?: boolean
  prerelease?: boolean
  published_at?: string
  created_at?: string
  html_url?: string
}

interface TagJSON {
  name?: string
}

async function call<T>(path: string, options: FetchOptions): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' }
  if (options.token) headers.Authorization = `Bearer ${options.token}`

  const response = await fetch(`${API}${path}`, { headers, signal: options.signal })

  const remaining = response.headers.get('x-ratelimit-remaining')
  if (remaining !== null && options.onRateLimit) {
    options.onRateLimit({
      remaining: Number(remaining),
      limit: Number(response.headers.get('x-ratelimit-limit') ?? 0),
      resetAt: Number(response.headers.get('x-ratelimit-reset') ?? 0) * 1000 || undefined,
    })
  }

  if (!response.ok) {
    const error = new Error(String(response.status)) as Error & {
      status: number
      remaining?: number
      detail?: string
    }
    error.status = response.status
    // Carried so `describe` can tell an exhausted quota apart from a token that
    // simply is not allowed to read this endpoint. They need opposite advice.
    error.remaining = remaining === null ? undefined : Number(remaining)
    error.detail = await readMessage(response)
    throw error
  }
  return (await response.json()) as T
}

/** GitHub's own error text, stripped of control characters and truncated. */
async function readMessage(response: Response): Promise<string | undefined> {
  try {
    const parsed = (await response.json()) as { message?: unknown }
    if (typeof parsed.message !== 'string') return undefined
    // oxlint-disable-next-line no-control-regex
    return parsed.message.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 160)
  } catch {
    return undefined
  }
}

export async function lookupReleases(
  owner: string,
  repo: string,
  options: FetchOptions,
): Promise<LookupResult> {
  const depth = options.depth ?? 'latest'
  const keep = KEEP[depth]

  try {
    const raw = await call<ReleaseJSON[]>(
      `/repos/${owner}/${repo}/releases?per_page=${PAGE_SIZE[depth]}`,
      options,
    )

    const releases = rank(
      raw
        .filter((entry) => !entry.draft && entry.tag_name)
        .map((entry) => ({
          tag: entry.tag_name as string,
          semver: parseSemver(entry.tag_name as string),
          date: entry.published_at ?? entry.created_at ?? undefined,
          url: entry.html_url ?? `https://github.com/${owner}/${repo}/releases`,
          prerelease: Boolean(entry.prerelease),
        })),
      options.includePrerelease,
      keep,
    )

    if (releases.length) return { status: 'ok', releases, origin: 'releases' }
  } catch (error) {
    const status = (error as { status?: number }).status
    // A repository can forbid Releases while still exposing Tags — the exact
    // shape of a fine-grained token holding Metadata but not Contents. Falling
    // through means those repos still report versions instead of an error.
    if (status !== 403 && status !== 404) return { status: 'error', ...describe(error, owner, repo) }
  }

  try {
    // Plenty of Swift packages ship tags without cutting GitHub Releases.
    // Tag objects are tiny, so a full page costs little and ranks accurately.
    const tags = await call<TagJSON[]>(`/repos/${owner}/${repo}/tags?per_page=100`, options)
    const fromTags = rank(
      tags
        .filter((tag) => tag.name)
        .map((tag) => ({
          tag: tag.name as string,
          semver: parseSemver(tag.name as string),
          date: undefined,
          url: `https://github.com/${owner}/${repo}/releases/tag/${encodeURIComponent(tag.name as string)}`,
          prerelease: Boolean(parseSemver(tag.name as string)?.pre.length),
        })),
      options.includePrerelease,
      keep,
    )

    if (fromTags.length) return { status: 'ok', releases: fromTags, origin: 'tags' }
    return { status: 'empty', message: 'No versioned releases or tags' }
  } catch (error) {
    return { status: 'error', ...describe(error, owner, repo) }
  }
}

interface Candidate {
  tag: string
  semver: SemVer | null
  date?: string
  url: string
  prerelease: boolean
}

function rank(candidates: Candidate[], includePrerelease: boolean, keep: number): Release[] {
  return candidates
    .filter((c): c is Release => c.semver !== null)
    .filter((c) => includePrerelease || (!c.prerelease && c.semver.pre.length === 0))
    .sort((a, b) => compareSemver(b.semver, a.semver))
    .filter((release, i, all) => i === 0 || release.tag !== all[i - 1].tag)
    .slice(0, keep)
}

function describe(
  error: unknown,
  owner: string,
  repo: string,
): { message: string; rateLimited?: boolean } {
  const { status, remaining, detail } = error as {
    status?: number
    remaining?: number
    detail?: string
  }

  if (status === 404) return { message: `${owner}/${repo} not found or private` }
  if (status === 401) return { message: 'Token rejected by GitHub' }

  if (status === 403 || status === 429) {
    // Only an exhausted quota is a rate limit. Telling someone who already has
    // a token and 4,900 calls left to "add a token" sends them the wrong way.
    if (remaining === 0) return { message: 'GitHub rate limit reached — add a token', rateLimited: true }
    if (detail && /not accessible by personal access token/i.test(detail)) {
      return { message: 'Token lacks permission — grant Contents: read' }
    }
    return { message: detail ?? 'GitHub refused the request' }
  }

  if (status) return { message: `GitHub returned ${status}` }
  if ((error as Error).name === 'AbortError') return { message: 'Cancelled' }
  return { message: 'Network request failed' }
}

/** Runs `worker` over every item, `limit` at a time, reporting each as it lands. */
export async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      await worker(items[index])
    }
  })
  await Promise.all(runners)
}

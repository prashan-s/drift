import type { OrgSet } from '../core/repository'

const API_ORIGIN = 'https://api.github.com'

/** 1 MB. Guards against a hostile or accidental giant blob in a repository. */
const MAX_BODY_BYTES = 1024 * 1024

export interface RateLimit {
  limit: number
  remaining: number
  /** Epoch milliseconds. */
  resetAt?: number
}

export class GitHubError extends Error {
  readonly status: number
  /** What the developer can do about it, in one sentence. */
  readonly remedy?: string
  readonly rateLimited: boolean

  constructor(message: string, status: number, remedy?: string, rateLimited = false) {
    super(message)
    this.name = 'GitHubError'
    this.status = status
    this.remedy = remedy
    this.rateLimited = rateLimited
  }
}

export interface ClientOptions {
  token?: string
  onRateLimit?: (rate: RateLimit) => void
  signal?: AbortSignal
  /** Organisations this client may read. Nothing is allowed without it. */
  orgs?: OrgSet
}

/**
 * A thin GitHub REST client with an in-memory response cache.
 *
 * Every request is built from an owner and repository this tool has already
 * validated, never from a URL found inside user input — a `Package.resolved`
 * that names `https://internal.example/admin` can therefore never cause a
 * request to that host. `assertAllowed` enforces that invariant at the last
 * moment before `fetch`.
 */
export class GitHubClient {
  private readonly cache = new Map<string, Promise<unknown>>()
  private options: ClientOptions

  constructor(options: ClientOptions = {}) {
    this.options = options
  }

  /** Swapping the token invalidates the cache: access differs per token. */
  configure(options: ClientOptions): void {
    if (options.token !== this.options.token) this.cache.clear()
    this.options = options
  }

  get rateLimitedByAnonymousQuota(): boolean {
    return !this.options.token
  }

  async json<T>(path: string): Promise<T> {
    return this.cached(`json:${path}`, () => this.request<T>(path, 'application/vnd.github+json'))
  }

  async raw(path: string): Promise<string> {
    return this.cached(`raw:${path}`, () => this.request<string>(path, 'application/vnd.github.raw'))
  }

  private cached<T>(key: string, run: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key)
    if (hit) return hit as Promise<T>
    // Failures are not cached: a 403 that a new token would fix must be retryable.
    const pending = run().catch((error) => {
      this.cache.delete(key)
      throw error
    })
    this.cache.set(key, pending)
    return pending
  }

  private async request<T>(path: string, accept: string): Promise<T> {
    // No configured set means no permitted repository — deny by default.
    const url = assertAllowed(path, this.options.orgs ?? new Set())
    const headers: Record<string, string> = {
      Accept: accept,
      'X-GitHub-Api-Version': '2022-11-28',
    }
    if (this.options.token) headers.Authorization = `Bearer ${this.options.token}`

    let response: Response
    try {
      response = await fetch(url, { headers, signal: this.options.signal, redirect: 'follow' })
    } catch (error) {
      if ((error as Error).name === 'AbortError') throw new GitHubError('Cancelled', 0)
      throw new GitHubError(
        'Could not reach api.github.com.',
        0,
        'Check your network connection and try again.',
      )
    }

    this.reportRate(response)
    if (!response.ok) throw await describe(response, Boolean(this.options.token))

    const length = Number(response.headers.get('content-length') ?? 0)
    if (length > MAX_BODY_BYTES) {
      throw new GitHubError(`Response larger than ${MAX_BODY_BYTES / 1024} KB — skipped.`, 0)
    }

    if (accept === 'application/vnd.github.raw') {
      const text = await response.text()
      if (text.length > MAX_BODY_BYTES) {
        throw new GitHubError(`File larger than ${MAX_BODY_BYTES / 1024} KB — skipped.`, 0)
      }
      return text as T
    }
    return (await response.json()) as T
  }

  private reportRate(response: Response): void {
    const remaining = response.headers.get('x-ratelimit-remaining')
    if (remaining === null || !this.options.onRateLimit) return
    this.options.onRateLimit({
      remaining: Number(remaining),
      limit: Number(response.headers.get('x-ratelimit-limit') ?? 0),
      resetAt: Number(response.headers.get('x-ratelimit-reset') ?? 0) * 1000 || undefined,
    })
  }
}

/**
 * Rejects anything that is not a read of a repository under the internal
 * organisation on api.github.com. Exported so the guarantee is directly
 * testable rather than merely asserted in a comment.
 */
export function assertAllowed(path: string, orgs: OrgSet = new Set()): string {
  if (!path.startsWith('/repos/')) {
    throw new GitHubError(`Refusing to request "${path}" — not a repository read.`, 0)
  }
  const url = new URL(path, API_ORIGIN)
  if (url.origin !== API_ORIGIN) {
    throw new GitHubError(`Refusing to request "${path}" — off-origin.`, 0)
  }
  // Re-check after normalisation: `/repos/../orgs/...` starts with `/repos/`
  // as written but resolves somewhere else entirely.
  if (!url.pathname.startsWith('/repos/')) {
    throw new GitHubError(`Refusing to request "${url.pathname}" — not a repository read.`, 0)
  }
  const [, , owner] = url.pathname.split('/')
  if (!orgs.has((owner ?? '').toLowerCase())) {
    throw new GitHubError(
      `Refusing to request "${url.pathname}" — outside ${[...orgs].join(', ') || 'any configured organisation'}.`,
      0,
    )
  }
  return url.toString()
}

async function describe(response: Response, authenticated: boolean): Promise<GitHubError> {
  const status = response.status
  const body = await response.text().catch(() => '')
  const message = safeMessage(body)

  if (status === 404) {
    return new GitHubError(
      'Not found, or not visible to this token.',
      404,
      authenticated
        ? 'The repository may be private and outside the token’s repository access list.'
        : 'Private repositories need a token. Add one below.',
    )
  }

  if (status === 401) {
    return new GitHubError('GitHub rejected the token.', 401, 'Check it has not expired.')
  }

  if (status === 403 || status === 429) {
    const exhausted = response.headers.get('x-ratelimit-remaining') === '0'
    if (exhausted) {
      const resetAt = Number(response.headers.get('x-ratelimit-reset') ?? 0) * 1000
      return new GitHubError(
        'GitHub rate limit reached.',
        status,
        resetAt
          ? `Quota resets at ${new Date(resetAt).toLocaleTimeString()}. A token raises the limit from 60 to 5,000 requests an hour.`
          : 'A token raises the limit from 60 to 5,000 requests an hour.',
        true,
      )
    }
    if (/not accessible by personal access token/i.test(message)) {
      return new GitHubError(
        'This token lacks permission for that endpoint.',
        status,
        'A fine-grained token needs read access to Contents (for Package.swift) and to Contents or a classic "repo" scope for Releases. Metadata alone is not enough.',
      )
    }
    return new GitHubError(message || 'GitHub refused the request.', status)
  }

  return new GitHubError(message || `GitHub returned ${status}.`, status)
}

/** Pulls `message` out of an error body without trusting its contents. */
function safeMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: unknown }
    if (typeof parsed.message !== 'string') return ''
    // Stripping control characters is the point: this string is rendered in the UI.
    // oxlint-disable-next-line no-control-regex
    return parsed.message.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 200)
  } catch {
    return ''
  }
}

/** Runs `worker` over `items`, at most `limit` in flight. Order-independent. */
export async function pool<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      await worker(items[cursor++])
    }
  })
  await Promise.all(runners)
}

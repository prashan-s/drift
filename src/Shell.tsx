import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowTrendUp,
  faCircleCheck,
  faDiagramProject,
  faKey,
  faXmark,
} from '@fortawesome/free-solid-svg-icons'
import Audit from './tools/Audit'
import Graph from './graph/Graph'
import {
  clearReleases,
  readAllReleases,
  readSetting,
  SEED_ORGS,
  SETTING_MANIFEST,
  SETTING_ORGS,
  writeRelease,
  writeSetting,
} from './lib/db'
import { lookupReleases, type RateLimit } from './lib/github'
import { parseSemver } from './lib/semver'
import { useRoute, type Route } from './lib/route'
import {
  ENV_TOKEN,
  repoKey,
  SessionContext,
  TOKEN_KEY,
  type LatestState,
  type Session,
} from './lib/session'

const TABS: Array<{ id: Route; label: string; icon: typeof faArrowTrendUp }> = [
  { id: 'audit', label: 'Version audit', icon: faArrowTrendUp },
  { id: 'graph', label: 'Dependency graph', icon: faDiagramProject },
]

/**
 * One application, two views.
 *
 * Both views are mounted at all times and the inactive one is hidden with
 * `hidden` + `inert`: a scan costs dozens of API calls, and losing it because
 * someone glanced at the graph would be the worst kind of avoidable.
 *
 * The shell also owns the local copy. Release lookups are answered from
 * IndexedDB first and revalidated against GitHub afterwards, so a reload shows
 * last session's answer immediately and then corrects it. Which of those you
 * are looking at is never hidden: cached values are marked, and a refresh that
 * changes a tag keeps the old one so the difference can be shown.
 */
export default function Shell() {
  const [route, go] = useRoute()
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) ?? ENV_TOKEN)
  const [rate, setRate] = useState<RateLimit | null>(null)
  const [tokenOpen, setTokenOpen] = useState(false)
  const tokenId = useId()

  const [manifest, setManifestText] = useState('')
  const [manifestSource, setManifestSource] = useState<string | undefined>()
  const [latest, setLatest] = useState<Record<string, LatestState>>({})
  const [hydrating, setHydrating] = useState(true)
  // Empty until IndexedDB answers; nothing is assumed in the meantime.
  const [orgs, setOrgsState] = useState<string[]>([])

  useEffect(() => {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  }, [token])

  // Local first: paint last session's answers, then let the network correct them.
  useEffect(() => {
    let cancelled = false

    void Promise.all([
      readAllReleases(),
      readSetting<string[]>(SETTING_ORGS),
      readSetting<{ text: string; source?: string }>(SETTING_MANIFEST),
    ]).then(([rows, savedOrgs, savedManifest]) => {
      {
        if (cancelled) return
        if (savedOrgs) {
          setOrgsState(savedOrgs)
        } else {
          // First run: seed the store, then read from it like any other run.
          setOrgsState(SEED_ORGS)
          void writeSetting(SETTING_ORGS, SEED_ORGS)
        }
        if (savedManifest?.text) {
          setManifestText(savedManifest.text)
          setManifestSource(savedManifest.source)
        }
        // A cached tag that no longer parses as semver cannot be compared, so
        // it is dropped rather than rehydrated into a Release with a hole in it.
        const restored: Array<[string, LatestState]> = []
        for (const row of rows) {
          const semver = parseSemver(row.tag)
          if (!semver) continue
          restored.push([
            row.key,
            {
              status: 'ok',
              release: {
                tag: row.tag,
                semver,
                date: row.date,
                url: row.url,
                prerelease: row.prerelease,
              },
              origin: row.origin,
              fromCache: true,
              fetchedAt: row.fetchedAt,
            },
          ])
        }
        setLatest(Object.fromEntries(restored))
        setHydrating(false)
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  const setManifest = useCallback((text: string, source?: string) => {
    setManifestText(text)
    setManifestSource(source)
    // Persisted so a reload does not cost you the paste. Debounced, because
    // this fires on every keystroke in the manifest textarea.
    window.clearTimeout(manifestWrite.current)
    manifestWrite.current = window.setTimeout(() => {
      void writeSetting(SETTING_MANIFEST, { text, source })
    }, 400)
  }, [])

  const setOrgs = useCallback((next: string[]) => {
    // An empty selection is a real choice and is stored as one.
    const value = [...new Set(next.map((o) => o.trim().toLowerCase()).filter(Boolean))].sort()
    setOrgsState(value)
    void writeSetting(SETTING_ORGS, value)
  }, [])

  const publishLatest = useCallback((key: string, incoming: LatestState) => {
    setLatest((prev) => {
      const held = prev[key]
      if (incoming.status !== 'ok' || incoming.fromCache) {
        return { ...prev, [key]: incoming }
      }

      const heldTag = held?.status === 'ok' ? held.release.tag : undefined
      const next: LatestState = {
        ...incoming,
        fromCache: false,
        fetchedAt: Date.now(),
        // Only a genuine change is worth pointing at.
        previous: heldTag && heldTag !== incoming.release.tag ? heldTag : undefined,
      }

      void writeRelease({
        key,
        tag: next.release.tag,
        date: next.release.date,
        url: next.release.url,
        prerelease: next.release.prerelease,
        origin: next.origin,
        fetchedAt: next.fetchedAt as number,
      })
      return { ...prev, [key]: next }
    })
  }, [])

  const manifestWrite = useRef<number | undefined>(undefined)
  const inFlight = useRef(new Set<string>())

  const requestLatest = useCallback(
    (owner: string, repo: string) => {
      const key = repoKey(owner, repo)
      if (inFlight.current.has(key)) return
      inFlight.current.add(key)

      // Keep whatever the cache gave us on screen while the request is out.
      setLatest((prev) => {
        const held = prev[key]
        return held?.status === 'ok'
          ? prev
          : { ...prev, [key]: { status: 'loading' as const } }
      })

      void lookupReleases(owner, repo, {
        token: token.trim() || undefined,
        includePrerelease: false,
        depth: 'latest',
        onRateLimit: setRate,
      }).then((result) => {
        inFlight.current.delete(key)
        publishLatest(
          key,
          result.status === 'ok'
            ? { status: 'ok', release: result.releases[0], origin: result.origin }
            : { status: result.status, message: result.message },
        )
      })
    },
    [publishLatest, token],
  )

  // A new token sees different repositories, so cached answers from the old one
  // would be wrong rather than merely stale.
  //
  // Compare the value rather than counting runs: StrictMode invokes effects
  // twice on mount, and a "have I run before" flag reads the second invocation
  // as a token change and wipes the cache on every single load.
  const seenToken = useRef(token)
  useEffect(() => {
    if (seenToken.current === token) return
    seenToken.current = token
    inFlight.current.clear()
    setLatest({})
    void clearReleases()
  }, [token])

  const session = useMemo<Session>(
    () => ({
      token,
      setToken,
      rate,
      setRate,
      manifest,
      manifestSource,
      setManifest,
      latest,
      publishLatest,
      requestLatest,
      hydrating,
      orgs,
      setOrgs,
    }),
    [
      token,
      rate,
      manifest,
      manifestSource,
      setManifest,
      latest,
      publishLatest,
      requestLatest,
      hydrating,
      orgs,
      setOrgs,
    ],
  )

  const tokenActive = token.trim().length > 0
  const rateLow = rate ? rate.remaining < 10 : false
  const cachedCount = Object.values(latest).filter(
    (s) => s.status === 'ok' && s.fromCache,
  ).length
  const updatedCount = Object.values(latest).filter(
    (s) => s.status === 'ok' && s.previous,
  ).length

  return (
    <SessionContext.Provider value={session}>
      <div className="app">
        <a className="skip-link" href="#view">
          Skip to content
        </a>

        <header className="topbar">
          <p className="wordmark">
            Drift <span>Swift package tools</span>
          </p>

          <nav className="tabs" aria-label="Tools">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className="tab"
                aria-current={route === tab.id ? 'page' : undefined}
                onClick={() => go(tab.id)}
              >
                <FontAwesomeIcon icon={tab.icon} aria-hidden="true" fixedWidth />
                {tab.label}
              </button>
            ))}
          </nav>

          <div className="topbar-actions">
            {updatedCount > 0 ? (
              <p className="rate" role="status">
                <strong>{updatedCount}</strong> updated
              </p>
            ) : cachedCount > 0 ? (
              <p className="rate" title="Answers restored from this browser's local copy">
                <strong>{cachedCount}</strong> from cache
              </p>
            ) : null}

            {rate ? (
              <p className="rate" data-low={rateLow}>
                <strong>{rate.remaining}</strong> calls left
              </p>
            ) : null}

            <button
              type="button"
              className="btn btn-quiet btn-token"
              aria-expanded={tokenOpen}
              aria-controls={tokenId}
              onClick={() => setTokenOpen((open) => !open)}
            >
              <FontAwesomeIcon
                icon={tokenActive ? faCircleCheck : faKey}
                aria-hidden="true"
                fixedWidth
                className={tokenActive ? 'icon-ok' : undefined}
              />
              {tokenActive ? 'Token set' : 'No token'}
            </button>
          </div>
        </header>

        <div className="token-strip" id={tokenId} hidden={!tokenOpen}>
          <div className="token-strip-inner">
            <label className="micro" htmlFor={`${tokenId}-input`}>
              GitHub token
            </label>
            <input
              id={`${tokenId}-input`}
              type="password"
              value={token}
              placeholder="ghp_… or github_pat_…"
              autoComplete="off"
              spellCheck={false}
              data-1p-ignore
              data-lpignore="true"
              aria-describedby={`${tokenId}-help`}
              onChange={(event) => setToken(event.target.value)}
            />
            {token ? (
              <button type="button" className="btn btn-quiet" onClick={() => setToken('')}>
                <FontAwesomeIcon icon={faXmark} aria-hidden="true" fixedWidth />
                Clear
              </button>
            ) : null}
            <p className="token-help" id={`${tokenId}-help`}>
              Private repositories need <code>Contents: read</code>, or a classic token with{' '}
              <code>repo</code>. Stored in this browser, sent only to api.github.com. Changing it
              clears the local release cache.
            </p>
          </div>
        </div>

        <main id="view">
          <div className="view-pane" hidden={route !== 'audit'} inert={route !== 'audit'}>
            <Audit />
          </div>
          <div className="view-pane" hidden={route !== 'graph'} inert={route !== 'graph'}>
            <Graph />
          </div>
        </main>
      </div>
    </SessionContext.Provider>
  )
}

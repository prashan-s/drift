import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowTrendUp,
  faArrowsRotate,
  faCheck,
  faCopy,
  faMagnifyingGlass,
  faStop,
} from '@fortawesome/free-solid-svg-icons'
import ResultsTable, {
  type HistoryState,
  type Row,
  type RowState,
} from '../components/ResultsTable'
import { DRIFT_SWATCH } from '../components/drift'
import { lookupReleases, runPool } from '../lib/github'
import { baselineVersion, parseManifest, type Dependency } from '../lib/parse'
import { repoKey, useSession } from '../lib/session'
import { DRIFT_LABEL, DRIFT_ORDER, driftLevel, parseSemver, type Drift } from '../lib/semver'

const PRERELEASE_KEY = 'drift.prerelease'

/**
 * The organisation to focus a fresh scan on.
 *
 * Where several configured organisations appear, the one contributing the most
 * packages wins — manifest order would hand the choice to whichever happened to
 * be listed first, which is not a fact about anything. Name order breaks a tie,
 * so the result does not depend on any built-in name.
 */
function preselectOrg(dependencies: Dependency[], orgs: string[]): string {
  const counts = new Map<string, number>()
  for (const dependency of dependencies) {
    const owner = dependency.owner
    if (owner && orgs.includes(owner.toLowerCase())) {
      counts.set(owner, (counts.get(owner) ?? 0) + 1)
    }
  }
  return (
    [...counts.entries()].sort(
      ([aName, aCount], [bName, bCount]) => bCount - aCount || aName.localeCompare(bName),
    )[0]?.[0] ?? ''
  )
}

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.userAgent)
const SUBMIT_HINT = IS_MAC ? '⌘↵' : 'Ctrl+↵'

export default function Audit() {
  const {
    token,
    setRate,
    manifest,
    manifestSource,
    setManifest,
    publishLatest,
    latest,
    orgs,
    hydrating,
  } = useSession()

  const [scanned, setScanned] = useState<Dependency[] | null>(null)
  const [states, setStates] = useState<Record<number, RowState>>({})
  const [histories, setHistories] = useState<Record<number, HistoryState>>({})
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [scanning, setScanning] = useState(false)
  const [hidden, setHidden] = useState<Set<Drift>>(new Set())
  const [org, setOrg] = useState('')
  const [copied, setCopied] = useState(false)

  const [includePrerelease, setIncludePrerelease] = useState(
    () => localStorage.getItem(PRERELEASE_KEY) === '1',
  )

  const abortRef = useRef<AbortController | null>(null)
  /** Bumped per scan so a late history response cannot land on a fresh table. */
  const scanIdRef = useRef(0)

  const parsed = useMemo(() => parseManifest(manifest), [manifest])

  /**
   * Marks every pin pending. Nothing is fetched here.
   *
   * What actually gets looked up is decided by the organisation filter, below —
   * a manifest of forty packages where you only care about your own five has no
   * business spending forty API calls to answer a question about five.
   */
  const scan = useCallback((dependencies: Dependency[]) => {
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    scanIdRef.current += 1

    setScanned(dependencies)
    // Chosen here, synchronously, so the fetcher below reads the final filter
    // on its first run rather than a tick later — the difference between
    // spending five API calls and forty.
    setOrg(preselectOrg(dependencies, orgs))
    setHistories({})
    setExpanded(new Set())
    setStates(
      Object.fromEntries(
        dependencies.map((dependency) => [
          dependency.order,
          dependency.supported
            ? ({ status: 'idle' } as RowState)
            : ({ status: 'skipped', message: dependency.note ?? 'Skipped' } as RowState),
        ]),
      ),
    )
  }, [orgs])


  /**
   * Fetches the earlier releases for one package.
   *
   * The scan only ever asked GitHub for the newest release, because that is all
   * drift is measured against. Everything older is pulled here, one package at
   * a time, when someone actually opens the row.
   */
  const loadHistory = useCallback(
    async (dependency: Dependency) => {
      const { order } = dependency
      const generation = scanIdRef.current

      setHistories((prev) => ({ ...prev, [order]: { status: 'loading' } }))

      const result = await lookupReleases(dependency.owner as string, dependency.repo as string, {
        token: token.trim() || undefined,
        includePrerelease,
        depth: 'history',
        onRateLimit: setRate,
      })

      // A rescan started while this was in flight — its results are stale.
      if (scanIdRef.current !== generation) return

      setHistories((prev) => ({
        ...prev,
        [order]:
          result.status === 'ok'
            ? { status: 'ok', releases: result.releases }
            : { status: 'error', message: result.message },
      }))
    },
    [includePrerelease, setRate, token],
  )

  const toggleHistory = useCallback(
    (dependency: Dependency) => {
      const { order } = dependency
      const isOpen = expanded.has(order)

      setExpanded((prev) => {
        const next = new Set(prev)
        if (isOpen) next.delete(order)
        else next.add(order)
        return next
      })

      // Fetch once. Reopening a row it has already loaded costs nothing.
      if (!isOpen && !histories[order]) void loadHistory(dependency)
    },
    [expanded, histories, loadHistory],
  )

  const rows = useMemo<Row[]>(() => {
    if (!scanned) return []
    return scanned.map((dependency) => {
      const state = states[dependency.order] ?? { status: 'idle' }
      const baselineRaw = baselineVersion(dependency)
      const baseline = baselineRaw ? parseSemver(baselineRaw) : null
      const latest = state.status === 'ok' ? (state.releases[0]?.semver ?? null) : null
      return { dependency, state, baseline, baselineRaw, drift: driftLevel(baseline, latest) }
    })
  }, [scanned, states])

  /** The owners actually present in this manifest, with how many each brings. */
  const owners = useMemo(() => {
    const counts = new Map<string, number>()
    scanned?.forEach((dependency) => {
      if (dependency.owner) counts.set(dependency.owner, (counts.get(dependency.owner) ?? 0) + 1)
    })
    return [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, count]) => ({ name, count }))
  }, [scanned])

  // A pick left over from an earlier manifest would otherwise hide every row
  // with no way to tell why, so it falls back to showing everything.
  const activeOrg = owners.some((owner) => owner.name === org) ? org : ''

  const pendingRef = useRef(new Set<number>())

  useEffect(() => {
    if (!scanned) return

    const targets = scanned.filter(
      (dependency) =>
        dependency.supported &&
        (!activeOrg || dependency.owner === activeOrg) &&
        states[dependency.order]?.status === 'idle' &&
        !pendingRef.current.has(dependency.order),
    )
    if (!targets.length) return

    const controller = abortRef.current
    targets.forEach((dependency) => pendingRef.current.add(dependency.order))
    setScanning(true)

    void runPool(targets, 6, async (dependency) => {
      if (controller?.signal.aborted) return
      setStates((prev) => ({ ...prev, [dependency.order]: { status: 'loading' } }))

      const result = await lookupReleases(dependency.owner as string, dependency.repo as string, {
        token: token.trim() || undefined,
        includePrerelease,
        depth: 'latest',
        onRateLimit: setRate,
        signal: controller?.signal,
      })

      pendingRef.current.delete(dependency.order)
      if (controller?.signal.aborted) return

      publishLatest(
        repoKey(dependency.owner as string, dependency.repo as string),
        result.status === 'ok'
          ? { status: 'ok', release: result.releases[0], origin: result.origin }
          : { status: result.status, message: result.message },
      )

      setStates((prev) => ({
        ...prev,
        [dependency.order]:
          result.status === 'ok'
            ? { status: 'ok', releases: result.releases, origin: result.origin }
            : { status: result.status, message: result.message },
      }))
    }).then(() => {
      if (!controller?.signal.aborted) setScanning(false)
    })
  }, [activeOrg, includePrerelease, publishLatest, scanned, setRate, states, token])

  const scopedRows = useMemo(
    () => (activeOrg ? rows.filter((row) => row.dependency.owner === activeOrg) : rows),
    [rows, activeOrg],
  )

  const tally = useMemo(() => {
    const counts = new Map<Drift, number>()
    scopedRows.forEach((row) => {
      if (row.state.status !== 'ok') return
      counts.set(row.drift, (counts.get(row.drift) ?? 0) + 1)
    })
    return DRIFT_ORDER.filter((drift) => counts.has(drift)).map((drift) => ({
      drift,
      count: counts.get(drift) as number,
    }))
  }, [scopedRows])

  const visibleRows = useMemo(
    () => scopedRows.filter((row) => row.state.status !== 'ok' || !hidden.has(row.drift)),
    [scopedRows, hidden],
  )

  const done = rows.filter(
    (row) => row.state.status !== 'idle' && row.state.status !== 'loading',
  ).length

  const toggleDrift = (drift: Drift) =>
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(drift)) next.delete(drift)
      else next.add(drift)
      return next
    })

  const copyReport = async () => {
    const header = '| # | Package | In manifest | Latest | Earlier | Drift |'
    const divider = '| --- | --- | --- | --- | --- | --- |'
    const body = visibleRows.map((row) => {
      const releases = row.state.status === 'ok' ? row.state.releases : []
      const history = histories[row.dependency.order]
      // Only rows whose history was actually opened have earlier versions to
      // report. Everything else says so rather than implying there are none.
      const earlier =
        history?.status === 'ok'
          ? history.releases
              .slice(1)
              .map((release) => release.tag)
              .join(', ') || 'none'
          : 'not loaded'

      const cells = [
        String(row.dependency.order).padStart(2, '0'),
        row.dependency.owner
          ? `${row.dependency.owner}/${row.dependency.repo}`
          : row.dependency.identity,
        row.baselineRaw ?? '—',
        releases[0]?.tag ?? '—',
        row.state.status === 'ok' ? earlier : '—',
        row.state.status === 'ok' ? DRIFT_LABEL[row.drift] : '—',
      ]
      return `| ${cells.join(' | ')} |`
    })

    await navigator.clipboard.writeText([header, divider, ...body].join('\n'))
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  const stop = () => {
    abortRef.current?.abort()
    pendingRef.current.clear()
    setScanning(false)
  }

  const submit = () => {
    if (!scanning && !hydrating && parsed.dependencies.length) scan(parsed.dependencies)
  }

  const detected =
    parsed.source === 'none' ? 'Nothing detected yet' : `${parsed.source} · ${parsed.detail}`
  const errorCount = scopedRows.filter((row) => row.state.status === 'error').length
  const tokenActive = token.trim().length > 0

  return (
    <div className="tool audit-tool">
      <aside className="tool-rail" aria-label="Input">
        <form
          className="rail-block rail-grow"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <label className="micro" htmlFor="manifest">
            Package.resolved or Package.swift
          </label>
          <textarea
            id="manifest"
            value={manifest}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-invalid={Boolean(parsed.error)}
            aria-describedby={parsed.error ? 'manifest-error' : undefined}
            placeholder={'{ "pins" : [ … ] }\n\nor\n\n.package(url: "…", from: "1.0.0")'}
            onChange={(event) => setManifest(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.currentTarget.form?.requestSubmit()
              }
            }}
          />
          <p className="rail-meta">{manifestSource ? `${manifestSource} · ${detected}` : detected}</p>

          {parsed.error ? (
            <p className="rail-error" id="manifest-error">
              {parsed.error}
            </p>
          ) : null}

          <div className="button-row">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={scanning || hydrating || !parsed.dependencies.length}
            >
              <FontAwesomeIcon icon={faMagnifyingGlass} aria-hidden="true" fixedWidth />
              {hydrating ? 'Loading…' : 'Scan'} <kbd>{SUBMIT_HINT}</kbd>
            </button>
          </div>

          <label className="toggle">
            <input
              type="checkbox"
              checked={includePrerelease}
              onChange={(event) => {
                setIncludePrerelease(event.target.checked)
                localStorage.setItem(PRERELEASE_KEY, event.target.checked ? '1' : '0')
              }}
            />
            Pre-releases
          </label>
        </form>

      </aside>

      <div className="tool-main">
        {!scanned ? (
          <div className="graph-empty">
            <FontAwesomeIcon icon={faArrowTrendUp} aria-hidden="true" size="2x" />
            <p>
              Every dependency comes back with its latest release, in the order you wrote it. Open a
              row for what came before.
            </p>
          </div>
        ) : (
          <>
            <div className="graph-toolbar">
              <p className="micro" role="status">
                {scanning
                  ? `Scanning ${done} of ${scanned.length}`
                  : activeOrg
                    ? `${scopedRows.length} of ${scanned.length} dependencies · ${activeOrg}`
                    : `${scanned.length} dependencies`}
              </p>

              <div className="toolbar-group">
                {scanning ? (
                  <button type="button" className="btn btn-icon-text btn-steady" onClick={stop}>
                    <FontAwesomeIcon icon={faStop} aria-hidden="true" fixedWidth />
                    Stop
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-icon-text btn-steady"
                    onClick={() => scan(scanned)}
                  >
                    <FontAwesomeIcon icon={faArrowsRotate} aria-hidden="true" fixedWidth />
                    Rescan
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-icon-text btn-steady"
                  onClick={() => void copyReport()}
                  disabled={!rows.length}
                >
                  <FontAwesomeIcon icon={copied ? faCheck : faCopy} aria-hidden="true" fixedWidth />
                  {copied ? 'Copied' : 'Copy report'}
                </button>
                <span className="sr-only" role="status">
                  {copied ? 'Report copied to clipboard' : ''}
                </span>
              </div>
            </div>

            {tally.length ? (
              <div className="tally">
                <div className="spectrum" role="img" aria-label="Share of dependencies by drift level">
                  {tally.map(({ drift, count }) => (
                    <div
                      key={drift}
                      className="spectrum-part"
                      style={{ flexGrow: count, '--swatch': DRIFT_SWATCH[drift] } as CSSProperties}
                    />
                  ))}
                </div>
                <ul className="spectrum-key">
                  {tally.map(({ drift, count }) => (
                    <li key={drift} style={{ '--swatch': DRIFT_SWATCH[drift] } as CSSProperties}>
                      <button
                        type="button"
                        aria-pressed={!hidden.has(drift)}
                        onClick={() => toggleDrift(drift)}
                      >
                        <i aria-hidden="true" />
                        {DRIFT_LABEL[drift]} <b>{count}</b>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {!scanning && errorCount > 0 && !tokenActive ? (
              <p className="notice">
                {errorCount} {errorCount === 1 ? 'repository' : 'repositories'} came back not found
                or private. Add a token in the header and rescan to include them.
              </p>
            ) : null}

            {owners.length > 1 ? (
              <div className="org-bar">
                <label className="micro" htmlFor="org-filter">
                  Organisation
                </label>
                <select
                  id="org-filter"
                  value={activeOrg}
                  onChange={(event) => setOrg(event.target.value)}
                >
                  <option value="">All organisations · {scanned?.length ?? 0}</option>
                  {owners.map((owner) => (
                    <option key={owner.name} value={owner.name}>
                      {owner.name} · {owner.count}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div className="tool-scroll">
              {visibleRows.length ? (
                <ResultsTable
                  rows={visibleRows}
                  expanded={expanded}
                  histories={histories}
                  onToggleHistory={toggleHistory}
                  latest={latest}
                />
              ) : scopedRows.length ? (
                <p className="empty-note">Every drift level is hidden. Turn one back on above.</p>
              ) : (
                <p className="empty-note">Nothing in this manifest comes from {activeOrg}.</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

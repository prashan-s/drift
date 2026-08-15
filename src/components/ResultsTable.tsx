import { Fragment, type CSSProperties } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCheck, faCopy } from '@fortawesome/free-solid-svg-icons'
import type { Release } from '../lib/github'
import { requirementLabel, type Dependency } from '../lib/parse'
import { diffSegments, type Drift, type SemVer } from '../lib/semver'
import { DRIFT_BADGE, DRIFT_SWATCH, formatDate } from './drift'
import { useCopy } from '../lib/clipboard'
import { repoKey, type LatestState } from '../lib/session'

export type RowState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; releases: Release[]; origin: 'releases' | 'tags' }
  | { status: 'empty'; message: string }
  | { status: 'error'; message: string }
  | { status: 'skipped'; message: string }

/** Earlier releases, fetched only when a row is opened. */
export type HistoryState =
  | { status: 'loading' }
  | { status: 'ok'; releases: Release[] }
  | { status: 'error'; message: string }

export interface Row {
  dependency: Dependency
  state: RowState
  baseline: SemVer | null
  baselineRaw?: string
  drift: Drift
}

interface Props {
  rows: Row[]
  expanded: Set<number>
  histories: Record<number, HistoryState>
  onToggleHistory: (dependency: Dependency) => void
  /** Shared release store, for the local-copy markers. */
  latest?: Record<string, LatestState>
}

/**
 * Copies one version, on the version itself.
 *
 * It stays out of the way until the number it belongs to is hovered or the
 * button is focused — a table of forty versions should not read as a table of
 * forty buttons. Touch has no hover to reveal it with, so there it simply
 * stays (see the `hover: none` rule in the stylesheet).
 */
function CopyVersion({ version }: { version: string }) {
  const { copied, copy } = useCopy()

  return (
    <>
      <button
        type="button"
        className="btn-copy-version"
        data-copied={copied || undefined}
        aria-label={`Copy ${version}`}
        onClick={() => copy(version)}
      >
        <FontAwesomeIcon icon={copied ? faCheck : faCopy} aria-hidden="true" fixedWidth />
      </button>
      <span className="sr-only" role="status">
        {copied ? `${version} copied to clipboard` : ''}
      </span>
    </>
  )
}

function VersionCell({ release, baseline, drift }: { release?: Release; baseline: SemVer | null; drift: Drift }) {
  if (!release) return <span className="version-empty">·</span>
  const segments = diffSegments(release.semver, baseline)
  const date = formatDate(release.date)
  // What is copied is what is on screen: the normalised number, not the tag it
  // came from, which may carry a `v` the table never showed.
  const shown = segments.map((segment) => segment.text).join('')

  return (
    <>
      <div className="version">
        <a href={release.url} target="_blank" rel="noreferrer">
          {segments.map((segment, i) => (
            <span key={i} className={segment.changed && drift !== 'ahead' ? 'seg-changed' : undefined}>
              {segment.text}
            </span>
          ))}
        </a>
        <CopyVersion version={shown} />
      </div>
      {date ? <div className="version-date">{date}</div> : null}
    </>
  )
}

function StatusCell({ state }: { state: RowState }) {
  if (state.status === 'loading') return <Pulse label="Loading releases" />
  if (state.status === 'idle') return <span className="version-empty">·</span>
  const tone = state.status === 'error' ? 'error' : undefined
  const message =
    state.status === 'empty' || state.status === 'error' || state.status === 'skipped'
      ? state.message
      : ''
  return (
    <span className="row-status" data-tone={tone}>
      {message}
    </span>
  )
}

/**
 * A bar that breathes rather than a spinner that turns.
 *
 * `role="img"` matters here: an `aria-label` on a bare `<span>` is not reliably
 * announced, so without it the loading state is silent to a screen reader.
 */
function Pulse({ label }: { label: string }) {
  return <span className="pulse" role="img" aria-label={label} />
}

/**
 * Says where this number came from.
 *
 * A value restored from the local copy is labelled as such, and one the network
 * has just corrected shows what it replaced — otherwise a version silently
 * changing between two visits is indistinguishable from one that never moved.
 */
function LocalCopyMark({
  dependency,
  latest,
}: {
  dependency: Dependency
  latest?: Record<string, LatestState>
}) {
  if (!dependency.owner || !dependency.repo) return null
  const entry = latest?.[repoKey(dependency.owner, dependency.repo)]
  if (entry?.status !== 'ok') return null

  if (entry.previous) return <div className="was">was {entry.previous}</div>
  if (entry.fromCache) return <div className="cached-mark muted">cached</div>
  return null
}

/** The earlier-releases drawer for one package. */
function HistoryPanel({
  history,
  baseline,
  drift,
  dependency,
}: {
  history: HistoryState | undefined
  baseline: SemVer | null
  drift: Drift
  dependency: Dependency
}) {
  if (!history || history.status === 'loading') {
    return (
      <p className="history-note">
        <Pulse label="Loading earlier releases" /> Fetching earlier releases…
      </p>
    )
  }

  if (history.status === 'error') {
    return (
      <p className="history-note" data-tone="error">
        {history.message}
      </p>
    )
  }

  // The first entry is the release already shown in the Latest column.
  const earlier = history.releases.slice(1)

  if (!earlier.length) {
    return <p className="history-note">Nothing published before this — it is the only release.</p>
  }

  return (
    <>
      <ol className="history-list">
        {earlier.map((release) => (
          <li key={release.tag}>
            <VersionCell release={release} baseline={baseline} drift={drift} />
          </li>
        ))}
      </ol>
      <p className="history-note">
        <a
          href={`https://github.com/${dependency.owner}/${dependency.repo}/releases`}
          target="_blank"
          rel="noreferrer"
        >
          All releases on GitHub
        </a>
      </p>
    </>
  )
}

export default function ResultsTable({
  rows,
  expanded,
  histories,
  onToggleHistory,
  latest,
}: Props) {
  return (
    <div className="table-frame">
      <table>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Package</th>
            <th scope="col">In manifest</th>
            <th scope="col">Latest</th>
            <th scope="col">Drift</th>
            <th scope="col">
              <span className="sr-only">Earlier releases</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ dependency, state, baseline, baselineRaw, drift }) => {
            const releases = state.status === 'ok' ? state.releases : []
            const swatch = { '--swatch': DRIFT_SWATCH[drift] } as CSSProperties
            const requirement = requirementLabel(dependency.requirement)
            const isOpen = expanded.has(dependency.order)
            const panelId = `history-${dependency.order}`

            return (
              <Fragment key={dependency.order}>
                <tr style={swatch} data-open={isOpen}>
                  <td className="col-order">{String(dependency.order).padStart(2, '0')}</td>

                  <td className="col-package">
                    <div className="pkg-name">
                      {dependency.supported ? (
                        <a
                          href={`https://github.com/${dependency.owner}/${dependency.repo}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {dependency.identity}
                        </a>
                      ) : (
                        dependency.identity
                      )}
                    </div>
                    <div className="pkg-meta">
                      <span>
                        {dependency.owner ? `${dependency.owner}/${dependency.repo}` : dependency.location}
                      </span>
                      {requirement ? <span className="chip">{requirement}</span> : null}
                      {state.status === 'ok' && state.origin === 'tags' ? (
                        <span className="chip">from tags</span>
                      ) : null}
                    </div>
                  </td>

                  <td className="col-version">
                    {baselineRaw ? (
                      <div className="version">
                        <span>{baselineRaw}</span>
                        <CopyVersion version={baselineRaw} />
                      </div>
                    ) : (
                      <span className="version-empty">unpinned</span>
                    )}
                  </td>

                  <td className="col-version">
                    {releases.length ? (
                      <>
                        <VersionCell release={releases[0]} baseline={baseline} drift={drift} />
                        <LocalCopyMark dependency={dependency} latest={latest} />
                      </>
                    ) : (
                      <StatusCell state={state} />
                    )}
                  </td>

                  <td className="col-drift">
                    {state.status === 'ok' ? (
                      <span className="badge">{DRIFT_BADGE[drift]}</span>
                    ) : (
                      <span className="version-empty">·</span>
                    )}
                  </td>

                  <td className="col-history">
                    {state.status === 'ok' ? (
                      <button
                        type="button"
                        className="btn btn-quiet btn-history"
                        aria-expanded={isOpen}
                        aria-controls={panelId}
                        onClick={() => onToggleHistory(dependency)}
                      >
                        {isOpen ? 'Hide' : 'Earlier'}
                        <span className="sr-only"> releases for {dependency.identity}</span>
                      </button>
                    ) : null}
                  </td>
                </tr>

                {isOpen ? (
                  <tr style={swatch} className="history-row">
                    {/* Empty leading cells put the earlier versions directly
                        under Latest, so the column reads as one column. */}
                    <td />
                    <td />
                    <td />
                    <td colSpan={3} id={panelId}>
                      <HistoryPanel
                        history={histories[dependency.order]}
                        baseline={baseline}
                        drift={drift}
                        dependency={dependency}
                      />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

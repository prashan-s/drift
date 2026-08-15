import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCheck, faCopy } from '@fortawesome/free-solid-svg-icons'
import { pinLabel } from '../core/resolved'
import type {
  DependencyGraph,
  GraphNode,
  ManifestStatus,
  PackageIdentity,
  PackageRepository,
  PinState,
  ResolvedPackage,
} from '../core/types'
import { DRIFT_BADGE, DRIFT_SWATCH } from '../../components/drift'
import { repoKey, type LatestState } from '../../lib/session'
import { markdownTable, useCopy } from '../../lib/clipboard'
import { DRIFT_LABEL } from '../../lib/semver'
import { versionView } from '../versions'

export interface ExternalDependency {
  repository: PackageRepository
  requirement?: string
  resolved?: ResolvedPackage
}

interface Props {
  graph: DependencyGraph
  selected?: PackageIdentity
  onSelect: (identity: PackageIdentity) => void
  latest?: Record<string, LatestState>
  /** Third parties the selected package declares. Not graph nodes. */
  externals?: ExternalDependency[]
  /** Fetches the newest release for one repository. */
  onCheck?: (owner: string, repo: string) => void
}

export function PackageDetails({
  graph,
  selected,
  onSelect,
  latest,
  externals = [],
  onCheck,
}: Props) {
  const externalCopy = useCopy()
  const internalCopy = useCopy()

  const node = graph.nodes.find((n) => n.identity === selected) ?? graph.nodes[0]
  if (!node) return null

  const byId = new Map(graph.nodes.map((n) => [n.identity, n]))
  const outgoing = graph.edges.filter((e) => e.from === node.identity)
  // "Nothing depends on it" is only the whole truth when every manifest was read.
  const unreadManifests = graph.nodes.some(
    (n) => n.manifest.kind !== 'exact' && n.manifest.kind !== 'fallback',
  )

  const externalMarkdown = () =>
    `### ${node.label} — external dependencies\n\n` +
    markdownTable(
      ['Package', 'Owner', 'Declared', 'Resolved', 'Latest', 'Drift'],
      externals.map((entry) => {
        const view = describeVersion(entry.repository, entry.resolved?.state, latest)
        return [
          entry.repository.name ?? entry.repository.raw,
          entry.repository.owner ?? '—',
          entry.requirement ?? '—',
          entry.resolved ? pinLabel(entry.resolved.state) : 'not in lockfile',
          view.latest ?? '—',
          view.drift === 'unknown' ? (view.note ?? 'unknown') : DRIFT_LABEL[view.drift],
        ]
      }),
    )

  const internalMarkdown = () =>
    `### ${node.label} — internal dependencies\n\n` +
    markdownTable(
      ['Package', 'Resolved', 'Declared', 'Confidence', 'Read at'],
      outgoing.map((edge) => {
        const target = byId.get(edge.to)
        return [
          target?.label ?? edge.to,
          target?.resolved ? pinLabel(target.resolved.state) : '—',
          edge.requirement ?? '—',
          edge.confidence === 'verified' ? 'Verified' : 'Unknown',
          edge.ref.slice(0, 12),
        ]
      }),
    )

  return (
    <section aria-labelledby="details-heading" className="panel">
      <h2 id="details-heading">
        Package details: <span className="mono">{node.label}</span>
      </h2>

      <dl className="facts">
        <dt>Repository</dt>
        <dd>
          {node.repository.url ? (
            <a href={node.repository.url} rel="noreferrer noopener" target="_blank">
              {node.repository.owner}/{node.repository.name}
            </a>
          ) : (
            node.repository.raw
          )}
        </dd>

        <dt>Identity</dt>
        <dd className="mono">{node.identity}</dd>

        <dt>Resolved version</dt>
        <dd>{node.resolved ? pinLabel(node.resolved.state) : 'Not present in Package.resolved'}</dd>

        <dt>Latest release</dt>
        <dd>
          <VersionStatus
            repository={node.repository}
            state={node.resolved?.state}
            latest={latest}
            onCheck={onCheck}
          />
        </dd>

        {node.resolved?.state.kind !== 'revision' && revisionOf(node) && (
          <>
            <dt>Revision</dt>
            <dd className="mono">{revisionOf(node)}</dd>
          </>
        )}

        <dt>Internal dependencies</dt>
        <dd>{node.dependencies.length}</dd>

        <dt>Internal dependents</dt>
        <dd>{node.dependents.length}</dd>

        <dt>Manifest</dt>
        <dd>{manifestSummary(node.manifest)}</dd>
      </dl>

      <div className="section-head">
        <h3>Internal dependencies</h3>
        {outgoing.length ? (
          <CopyButton
            label="internal dependencies"
            copied={internalCopy.copied}
            onCopy={() => internalCopy.copy(internalMarkdown())}
          />
        ) : null}
      </div>
      {outgoing.length ? (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Package</th>
              <th scope="col">Resolved</th>
              <th scope="col">Declared</th>
              <th scope="col">Confidence</th>
            </tr>
          </thead>
          <tbody>
            {outgoing.map((edge) => {
              const target = byId.get(edge.to)
              return (
                <tr key={edge.to}>
                  <td>
                    <button type="button" className="link" onClick={() => onSelect(edge.to)}>
                      {target?.label ?? edge.to}
                    </button>
                  </td>
                  <td>{target?.resolved ? pinLabel(target.resolved.state) : '—'}</td>
                  <td className="mono">{edge.requirement ?? '—'}</td>
                  <td>
                    <span className={`badge ${edge.confidence}`}>
                      {edge.confidence === 'verified' ? 'Verified' : 'Unknown'}
                    </span>
                    <span className="muted"> at {edge.ref.slice(0, 12)}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      ) : (
        <p className="status">{noDependenciesMessage(node.manifest)}</p>
      )}

      <div className="section-head">
        <h3>External dependencies</h3>
        {externals.length ? (
          <CopyButton
            label="external dependencies"
            copied={externalCopy.copied}
            onCopy={() => externalCopy.copy(externalMarkdown())}
          />
        ) : null}
      </div>
      {externals.length ? (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Package</th>
              <th scope="col">Declared</th>
              <th scope="col">Resolved</th>
              <th scope="col">Latest</th>
            </tr>
          </thead>
          <tbody>
            {externals.map((entry) => (
              <tr key={entry.repository.url ?? entry.repository.raw}>
                <td>
                  {entry.repository.url ? (
                    <a href={entry.repository.url} rel="noreferrer noopener" target="_blank">
                      {entry.repository.name}
                    </a>
                  ) : (
                    entry.repository.raw
                  )}
                  <div className="muted mono">{entry.repository.owner}</div>
                </td>
                <td className="mono">{entry.requirement ?? '—'}</td>
                <td className="mono">
                  {entry.resolved ? pinLabel(entry.resolved.state) : 'not in lockfile'}
                </td>
                <td>
                  <VersionStatus
                    repository={entry.repository}
                    state={entry.resolved?.state}
                    latest={latest}
                    onCheck={onCheck}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="status">{externalsMessage(node.manifest)}</p>
      )}

      <div className="section-head">
        <h3>Depended on by</h3>
      </div>
      {node.dependents.length ? (
        <ul className="inline-list">
          {node.dependents.map((identity) => (
            <li key={identity}>
              <button type="button" className="link" onClick={() => onSelect(identity)}>
                {byId.get(identity)?.label ?? identity}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="status">
          Nothing here depends on it.{unreadManifests ? ' Some manifests are unread, so this may be incomplete.' : ''}
        </p>
      )}
    </section>
  )
}

function CopyButton({
  label,
  copied,
  onCopy,
}: {
  label: string
  copied: boolean
  onCopy: () => void
}) {
  return (
    <button type="button" className="btn btn-icon-text btn-copy" onClick={onCopy}>
      <FontAwesomeIcon icon={copied ? faCheck : faCopy} aria-hidden="true" fixedWidth />
      {copied ? 'Copied' : 'Copy'}
      {/* The visible word is just "Copy"; the accessible name says what of. */}
      <span className="sr-only"> {label}</span>
    </button>
  )
}

function describeVersion(
  repository: PackageRepository,
  state: PinState | undefined,
  latest: Record<string, LatestState> | undefined,
) {
  const key =
    repository.owner && repository.name ? repoKey(repository.owner, repository.name) : ''
  return versionView(state, latest?.[key])
}

/**
 * The version audit, one repository at a time.
 *
 * Same comparison the audit table makes, rendered where you are already
 * standing rather than making you switch views and find the row.
 */
function VersionStatus({
  repository,
  state,
  latest,
  onCheck,
}: {
  repository: PackageRepository
  state?: PinState
  latest?: Record<string, LatestState>
  onCheck?: (owner: string, repo: string) => void
}) {
  const view = describeVersion(repository, state, latest)
  const key =
    repository.owner && repository.name ? repoKey(repository.owner, repository.name) : ''
  const entry = latest?.[key]

  if (!view.latest) {
    return (
      <span className="version-status">
        <span className="muted">{view.note ?? 'Unknown'}</span>
        {onCheck && repository.owner && repository.name && !entry ? (
          <button
            type="button"
            className="link"
            onClick={() => onCheck(repository.owner as string, repository.name as string)}
          >
            check
          </button>
        ) : null}
      </span>
    )
  }

  return (
    <span className="version-status">
      <span className="mono">{view.latest}</span>
      {view.drift === 'unknown' ? (
        <span className="muted"> {view.note}</span>
      ) : (
        <span
          className="badge"
          style={{ '--swatch': DRIFT_SWATCH[view.drift] } as React.CSSProperties}
        >
          {DRIFT_BADGE[view.drift]}
        </span>
      )}
      {entry?.status === 'ok' && entry.previous ? (
        <span className="was" title="Changed since the local copy">
          was {entry.previous}
        </span>
      ) : entry?.status === 'ok' && entry.fromCache ? (
        <span className="muted cached-mark" title="From this browser's local copy">
          cached
        </span>
      ) : null}
    </span>
  )
}

function externalsMessage(manifest: ManifestStatus): string {
  if (manifest.kind === 'exact' || manifest.kind === 'fallback') {
    return 'Declares no third-party dependencies.'
  }
  return 'Unknown — its manifest could not be read.'
}

function revisionOf(node: GraphNode): string | undefined {
  const state = node.resolved?.state
  if (!state) return undefined
  return 'revision' in state ? state.revision : undefined
}

function manifestSummary(manifest: ManifestStatus): string {
  switch (manifest.kind) {
    case 'exact':
      return `Read at the pinned revision ${manifest.ref.slice(0, 12)} — edges are verified.`
    case 'fallback':
      return `${manifest.reason} Edges from this package are unverified.`
    case 'unavailable':
      return `Not readable: ${manifest.reason}${manifest.remedy ? ` ${manifest.remedy}` : ''}`
    case 'loading':
      return 'Loading…'
    default:
      return 'Not fetched.'
  }
}

function noDependenciesMessage(manifest: ManifestStatus): string {
  if (manifest.kind === 'exact' || manifest.kind === 'fallback') {
    return 'Declares no internal dependencies.'
  }
  return 'Unknown — its manifest could not be read, so these are missing rather than absent.'
}

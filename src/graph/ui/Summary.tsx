import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCircleExclamation, faTriangleExclamation, faCircleInfo } from '@fortawesome/free-solid-svg-icons'
import type { Analysis } from '../analysis'
import type { Finding, PackageIdentity } from '../core/types'

interface Props {
  analysis: Analysis
  onSelect: (identity: PackageIdentity) => void
  /** Counts inline, findings folded away — for the toolbar above the diagram. */
  compact?: boolean
}

const SEVERITY_LABEL: Record<Finding['severity'], string> = {
  error: 'Error',
  warning: 'Warning',
  note: 'Note',
}

const SEVERITY_ICON = {
  error: faCircleExclamation,
  warning: faTriangleExclamation,
  note: faCircleInfo,
}

export function Summary({ analysis, onSelect, compact }: Props) {
  const { graph, findings, edgesUnavailable } = analysis
  const verified = graph.edges.filter((e) => e.confidence === 'verified').length
  const unknown = graph.edges.length - verified

  const counts = (
    <dl className="counts">
      <Count label="Packages" value={graph.nodes.length} />
      <Count label="Verified" value={verified} />
      <Count label="Unverified" value={unknown} />
      <Count label="Cycles" value={graph.cycles.length} alert={graph.cycles.length > 0} />
      <Count label="External" value={graph.external.length} />
    </dl>
  )

  const findingsList = findings.length ? (
    <ul className="findings">
      {findings.map((finding) => (
        <li key={finding.id} className={`finding ${finding.severity}`}>
          <span className="finding-severity">
            <FontAwesomeIcon icon={SEVERITY_ICON[finding.severity]} aria-hidden="true" />{' '}
            {SEVERITY_LABEL[finding.severity]}
          </span>
          <div>
            <p className="finding-title">{finding.title}</p>
            <p className="finding-detail">{finding.detail}</p>
            {finding.subjects.length > 0 && (
              <p className="finding-subjects">
                {finding.subjects.map((identity) => (
                  <button
                    key={identity}
                    type="button"
                    className="link"
                    onClick={() => onSelect(identity)}
                  >
                    {identity}
                  </button>
                ))}
              </p>
            )}
          </div>
        </li>
      ))}
    </ul>
  ) : null

  if (compact) {
    return (
      <div className="summary-compact">
        {counts}
        {findings.length ? (
          <details className="findings-drawer">
            <summary>
              {findings.length} {findings.length === 1 ? 'finding' : 'findings'}
            </summary>
            {findingsList}
          </details>
        ) : null}
        {edgesUnavailable ? <EdgeAlert /> : null}
      </div>
    )
  }

  return (
    <section aria-labelledby="summary-heading" className="panel">
      <h2 id="summary-heading">Summary</h2>
      {counts}
      {edgesUnavailable ? <EdgeAlert /> : null}
      {findingsList ? (
        <>
          <h3>Findings</h3>
          {findingsList}
        </>
      ) : (
        !edgesUnavailable && <p className="status">No structural issues found.</p>
      )}
    </section>
  )
}

/**
 * Shown when not one manifest could be read. Without it the diagram would be a
 * scatter of unconnected nodes that looks like an answer.
 */
function EdgeAlert() {
  return (
    <div role="alert" className="notice">
      <p>
        <strong>No edges could be established.</strong> Package.resolved records which packages
        resolved, not which package depends on which.
      </p>
      <p className="notice-remedy">
        No <code>Package.swift</code> was readable, so nothing is drawn rather than guessed. A token
        with <code>Contents: read</code> on the bhashacode repositories fixes this.
      </p>
    </div>
  )
}

function Count({ label, value, alert }: { label: string; value: number; alert?: boolean }) {
  return (
    <div className={`count${alert ? ' alert' : ''}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

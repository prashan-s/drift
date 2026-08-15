import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCheck, faCopy, faRotate } from '@fortawesome/free-solid-svg-icons'
import { pinLabel } from '../core/resolved'
import type { ResolvedPackage } from '../core/types'
import { DRIFT_BADGE, DRIFT_SWATCH } from '../../components/drift'
import { markdownTable, useCopy } from '../../lib/clipboard'
import { DRIFT_LABEL } from '../../lib/semver'
import { repoKey, type LatestState } from '../../lib/session'
import { versionView } from '../versions'

interface Props {
  packages: ResolvedPackage[]
  latest?: Record<string, LatestState>
  /** Fetches the newest release for one repository. */
  onCheck?: (owner: string, repo: string) => void
}

/**
 * Third-party packages, kept out of the graph and listed here instead.
 *
 * They matter — you still want to know that Alamofire resolved to 5.10.2 — but
 * they are not internal structure, and putting them on the diagram would bury
 * the eight nodes you came to look at under sixty you did not.
 *
 * Versions are shown for whatever the session already fetched and filled in for
 * the rest only on request: this list can be sixty repositories long, and
 * spending sixty API calls without being asked would be rude.
 */
export function ExternalTable({ packages, latest, onCheck }: Props) {
  const { copied, copy } = useCopy()

  if (!packages.length) return null

  const view = (pkg: ResolvedPackage) => {
    const { owner, name } = pkg.repository
    const key = owner && name ? repoKey(owner, name) : ''
    return versionView(pkg.state, latest?.[key])
  }

  const unchecked = packages.filter((pkg) => {
    const { owner, name } = pkg.repository
    return owner && name && !latest?.[repoKey(owner, name)]
  })

  const asMarkdown = () =>
    `### External packages (${packages.length})\n\n` +
    markdownTable(
      ['Package', 'Owner', 'Resolved', 'Latest', 'Drift'],
      packages.map((pkg) => {
        const v = view(pkg)
        return [
          pkg.repository.name ?? pkg.identity,
          pkg.repository.owner ?? 'not GitHub',
          pinLabel(pkg.state),
          v.latest ?? '—',
          v.drift === 'unknown' ? (v.note ?? 'unchecked') : DRIFT_LABEL[v.drift],
        ]
      }),
    )

  return (
    <section aria-labelledby="external-heading" className="panel">
      <div className="section-head">
        <h3 id="external-heading">
          External packages <span className="muted">({packages.length}, not in the graph)</span>
        </h3>
        <div className="toolbar-group">
          {onCheck && unchecked.length ? (
            <button
              type="button"
              className="btn btn-icon-text"
              onClick={() =>
                unchecked.forEach((pkg) =>
                  onCheck(pkg.repository.owner as string, pkg.repository.name as string),
                )
              }
            >
              <FontAwesomeIcon icon={faRotate} aria-hidden="true" fixedWidth />
              Check {unchecked.length}
            </button>
          ) : null}
          <button type="button" className="btn btn-icon-text btn-copy" onClick={() => copy(asMarkdown())}>
            <FontAwesomeIcon icon={copied ? faCheck : faCopy} aria-hidden="true" fixedWidth />
            {copied ? 'Copied' : 'Copy'}
            <span className="sr-only"> external packages table</span>
          </button>
        </div>
      </div>

      <div className="table-scroll">
        <table className="table">
          <caption className="sr-only">
            Packages outside the bhashacode organisation, with their resolved versions
          </caption>
          <thead>
            <tr>
              <th scope="col">Package</th>
              <th scope="col">Resolved</th>
              <th scope="col">Latest</th>
            </tr>
          </thead>
          <tbody>
            {packages.map((pkg) => {
              const v = view(pkg)
              return (
                <tr key={`${pkg.identity}-${pkg.order}`}>
                  <td>
                    {pkg.repository.url ? (
                      <a href={pkg.repository.url} rel="noreferrer noopener" target="_blank">
                        {pkg.repository.name}
                      </a>
                    ) : (
                      <span className="mono">{pkg.identity}</span>
                    )}
                    <div className="muted mono">{pkg.repository.owner ?? 'not GitHub'}</div>
                  </td>
                  <td className="mono">{pinLabel(pkg.state)}</td>
                  <td>
                    {v.latest ? (
                      <span className="version-status">
                        <span className="mono">{v.latest}</span>
                        {v.drift === 'unknown' ? null : (
                          <span
                            className="badge"
                            style={{ '--swatch': DRIFT_SWATCH[v.drift] } as React.CSSProperties}
                          >
                            {DRIFT_BADGE[v.drift]}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="muted">{v.note ?? 'unchecked'}</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

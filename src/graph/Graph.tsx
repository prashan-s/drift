import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faCopy,
  faCheck,
  faDiagramProject,
  faListUl,
  faMagnifyingGlass,
  faTableList,
} from '@fortawesome/free-solid-svg-icons'
import { repoKey, useSession } from '../lib/session'
import { runAnalysis, type Analysis } from './analysis'
import { isInternal, orgSet } from './core/repository'
import { parseInput, InputParseError } from './core/input'
import { describeGraph, summarize } from './core/text'
import type { PackageIdentity } from './core/types'
import { GitHubClient, GitHubError } from './github/client'
import { GraphView } from './ui/GraphView'
import { PackageDetails } from './ui/PackageDetails'
import { Summary } from './ui/Summary'
import { OrgFilter } from '../components/OrgFilter'

interface Problem {
  message: string
  remedy?: string
}

export default function Graph() {
  const {
    token,
    setRate,
    manifest,
    manifestSource,
    setManifest,
    latest,
    requestLatest,
    orgs,
    hydrating,
  } = useSession()

  const [analysis, setAnalysis] = useState<Analysis | undefined>()
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | undefined>()
  const [problem, setProblem] = useState<Problem | undefined>()
  const [status, setStatus] = useState('')
  const [copied, setCopied] = useState(false)


  const [view, setView] = useState<'diagram' | 'text'>('diagram')
  const [selected, setSelected] = useState<PackageIdentity | undefined>()
  const [dragging, setDragging] = useState(false)

  const internalOrgs = useMemo(() => orgSet(orgs), [orgs])

  const client = useRef(new GitHubClient()).current
  client.configure({ token: token.trim() || undefined, onRateLimit: setRate, orgs: internalOrgs })


  const analyze = useCallback(async () => {
    setProblem(undefined)

    let parsed
    try {
      parsed = parseInput(manifest)
    } catch (error) {
      const next =
        error instanceof InputParseError
          ? { message: error.message, remedy: error.remedy }
          : { message: String(error) }
      setProblem(next)
      setAnalysis(undefined)
      setStatus(`Could not read that. ${next.message}`)
      return
    }

    setBusy(true)
    setProgress({ done: 0, total: 0 })
    try {
      const result = await runAnalysis(parsed, client, internalOrgs, (done, total) =>
        setProgress({ done, total }),
      )
      setAnalysis(result)
      setSelected(result.graph.nodes[0]?.identity)
      setStatus(summarize(result.graph))
    } catch (error) {
      setProblem(describeProblem(error))
      setStatus('Analysis failed.')
    } finally {
      setBusy(false)
      setProgress(undefined)
    }
  }, [client, internalOrgs, manifest])


  const readFile = async (file: File) => {
    setManifest(await file.text(), file.name)
    setProblem(undefined)
  }

  const textual = useMemo(() => (analysis ? describeGraph(analysis.graph) : ''), [analysis])

  /**
   * The external packages the selected package declares.
   *
   * They are not graph nodes — that is the whole point — but "what third-party
   * versions does *this* package drag in" is a question you can only answer
   * standing on a node, so it is answered here rather than in the flat list.
   */
  const selectedExternals = useMemo(() => {
    const node = analysis?.graph.nodes.find((n) => n.identity === selected)
    if (!node) return []
    const manifestState = node.manifest
    if (manifestState.kind !== 'exact' && manifestState.kind !== 'fallback') return []

    const pinned = new Map(
      (analysis?.graph.external ?? []).map((pkg) => [pkg.identity, pkg]),
    )

    return manifestState.dependencies
      .filter((dependency) => !isInternal(dependency.repository, internalOrgs))
      .map((dependency) => ({
        repository: dependency.repository,
        requirement: dependency.requirement,
        resolved: pinned.get(dependency.repository.name?.toLowerCase() ?? ''),
      }))
      .sort((a, b) => (a.repository.name ?? '').localeCompare(b.repository.name ?? ''))
  }, [analysis, internalOrgs, selected])

  // Internal nodes get their latest release as soon as the graph exists; the
  // selected package's third parties are fetched only when you stand on it.
  useEffect(() => {
    for (const node of analysis?.graph.nodes ?? []) {
      const { owner, name } = node.repository
      if (owner && name && !latest[repoKey(owner, name)]) requestLatest(owner, name)
    }
  }, [analysis, latest, requestLatest])

  useEffect(() => {
    for (const entry of selectedExternals) {
      const { owner, name } = entry.repository
      if (owner && name && !latest[repoKey(owner, name)]) requestLatest(owner, name)
    }
  }, [selectedExternals, latest, requestLatest])

  const switcher = (
    <>
      <div className="toolbar-group" role="group" aria-label="Representation">
        <button
          type="button"
          className="btn btn-icon-text"
          aria-pressed={view === 'diagram'}
          onClick={() => setView('diagram')}
        >
          <FontAwesomeIcon icon={faDiagramProject} aria-hidden="true" fixedWidth />
          Diagram
        </button>
        <button
          type="button"
          className="btn btn-icon-text"
          aria-pressed={view === 'text'}
          onClick={() => setView('text')}
        >
          <FontAwesomeIcon icon={faListUl} aria-hidden="true" fixedWidth />
          Text
        </button>
        <button
          type="button"
          className="btn btn-icon-text btn-steady"
          disabled={!textual}
          onClick={() => {
            void navigator.clipboard.writeText(textual)
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1500)
          }}
        >
          <FontAwesomeIcon icon={copied ? faCheck : faCopy} aria-hidden="true" fixedWidth />
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <span className="sr-only" role="status">
        {copied ? 'Graph copied to clipboard' : ''}
      </span>
    </>
  )

  return (
    <div
      className="tool graph-tool"
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        const file = event.dataTransfer.files[0]
        if (file) void readFile(file)
      }}
    >
      <aside className="tool-rail" aria-label="Input">
        <div className="rail-block">
          <label className="micro" htmlFor="graph-input">
            Package.resolved or Package.swift
          </label>
          <textarea
            id="graph-input"
            value={manifest}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder={'{ "pins" : [ … ] }\n\nor\n\n.package(url: "…", from: "1.0.0")'}
            onChange={(event) => setManifest(event.target.value)}
          />
          <p className="rail-meta">
            {manifestSource ? `Loaded ${manifestSource}` : 'Drop a file anywhere on this panel'}
          </p>

          <div className="button-row">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void analyze()}
              disabled={busy || hydrating || !manifest.trim()}
            >
              <FontAwesomeIcon icon={faMagnifyingGlass} aria-hidden="true" fixedWidth />
              {busy ? 'Analysing…' : hydrating ? 'Loading…' : 'Analyse'}
            </button>
          </div>
        </div>

        {problem ? (
          <div role="alert" className="notice">
            <p>{problem.message}</p>
            {problem.remedy ? <p className="notice-remedy">{problem.remedy}</p> : null}
          </div>
        ) : null}

        {busy ? (
          <p className="rail-meta" role="status">
            Reading manifests{progress?.total ? ` — ${progress.done}/${progress.total}` : '…'}
          </p>
        ) : null}
      </aside>

      <div className="tool-main">
        <p className="sr-only" role="status" aria-live="polite">
          {status}
        </p>

        {dragging ? <div className="drop-veil">Drop to load</div> : null}

        <OrgFilter
          available={
            analysis
              ? ([
                  ...new Set(
                    analysis.resolved.packages
                      .map((pkg) => pkg.repository.ownerKey)
                      .filter(Boolean) as string[],
                  ),
                ] as string[])
              : []
          }
          summary={
            analysis
              ? `${analysis.graph.nodes.length} internal · ${analysis.graph.external.length} external`
              : undefined
          }
          collapsible
        />

        {!analysis && !busy ? (
          <div className="graph-empty">
            <FontAwesomeIcon icon={faDiagramProject} aria-hidden="true" size="2x" />
            <p>
              Verified dependencies between{' '}
              {orgs.map((org, i) => (
                <span key={org}>
                  {i > 0 ? ' and ' : ''}
                  <code>github.com/{org}/*</code>
                </span>
              ))}{' '}
              packages. Edges come from each repository&rsquo;s root <code>Package.swift</code>.
            </p>
          </div>
        ) : null}

        {analysis ? (
          <>
            <Summary analysis={analysis} onSelect={setSelected} compact />

            <div className="graph-stage">
              {analysis.graph.nodes.length === 0 ? (
                <p className="empty-note">
                  No packages under {orgs.join(' or ')} here.{' '}
                  {analysis.graph.external.length} external set aside.
                </p>
              ) : view === 'diagram' ? (
                <GraphView
                  graph={analysis.graph}
                  selected={selected}
                  onSelect={setSelected}
                  toolbar={switcher}
                  latest={latest}
                />
              ) : (
                <>
                  <div className="graph-toolbar">{switcher}</div>
                  <pre className="graph-text">{textual}</pre>
                </>
              )}
            </div>

            <details className="graph-drawer">
              <summary>
                <FontAwesomeIcon icon={faTableList} aria-hidden="true" fixedWidth />
                Package details
              </summary>
              <div className="graph-drawer-body">
                <PackageDetails
                  graph={analysis.graph}
                  selected={selected}
                  onSelect={setSelected}
                  latest={latest}
                  externals={selectedExternals}
                  onCheck={requestLatest}
                />
              </div>
            </details>
          </>
        ) : null}
      </div>
    </div>
  )
}

function describeProblem(error: unknown): Problem {
  if (error instanceof GitHubError) return { message: error.message, remedy: error.remedy }
  return { message: (error as Error)?.message ?? String(error) }
}

import { buildGraph } from './core/graph'
import { analyze } from './core/issues'
import { isInternal, type OrgSet } from './core/repository'
import type {
  DependencyGraph,
  Finding,
  ManifestStatus,
  PackageIdentity,
  ResolvedFile,
} from './core/types'
import { GitHubClient, pool } from './github/client'
import { fetchManifest } from './github/packages'

export interface Analysis {
  resolved: ResolvedFile
  graph: DependencyGraph
  findings: Finding[]
  /** True when no manifest at all could be read — the graph has no edges. */
  edgesUnavailable: boolean
}

/** Concurrent manifest reads. GitHub tolerates this comfortably. */
const CONCURRENCY = 6

/**
 * Turns a parsed `Package.resolved` into a graph.
 *
 * Manifest reads are what produce edges, and they are the only network work
 * here: one request per internal package, run concurrently, deduplicated and
 * cached by the client. External packages are never fetched — the tool has no
 * business making requests to repositories it does not own.
 *
 * `onProgress` fires as each manifest lands so the UI can show the graph filling
 * in rather than a spinner over an empty pane.
 */
export async function runAnalysis(
  resolved: ResolvedFile,
  client: GitHubClient,
  orgs: OrgSet,
  onProgress?: (done: number, total: number) => void,
): Promise<Analysis> {
  const internal = resolved.packages.filter((pkg) => isInternal(pkg.repository, orgs))
  const manifests = new Map<PackageIdentity, ManifestStatus>()
  let done = 0

  await pool(internal, CONCURRENCY, async (pkg) => {
    let status: ManifestStatus
    try {
      status = await fetchManifest(client, pkg.repository, pkg.state)
    } catch (error) {
      status = { kind: 'unavailable', reason: (error as Error).message }
    }
    manifests.set(pkg.identity, status)
    onProgress?.(++done, internal.length)
  })

  return finish(resolved, manifests, orgs)
}

/** The offline path: build the graph with no manifests, hence with no edges. */
export function analyzeWithoutNetwork(resolved: ResolvedFile, orgs: OrgSet): Analysis {
  const manifests = new Map<PackageIdentity, ManifestStatus>()
  for (const pkg of resolved.packages) {
    if (!isInternal(pkg.repository, orgs)) continue
    manifests.set(pkg.identity, {
      kind: 'unavailable',
      reason: 'Manifest lookup is off.',
      remedy:
        'Package.resolved lists the resolved package set but not who depends on whom. Turn on manifest lookup to read each Package.swift and draw verified edges.',
    })
  }
  return finish(resolved, manifests, orgs)
}

function finish(
  resolved: ResolvedFile,
  manifests: ReadonlyMap<PackageIdentity, ManifestStatus>,
  orgs: OrgSet,
): Analysis {
  const graph = buildGraph(resolved, manifests, orgs)
  const readable = graph.nodes.some(
    (node) => node.manifest.kind === 'exact' || node.manifest.kind === 'fallback',
  )
  return {
    resolved,
    graph,
    findings: analyze(graph, resolved),
    edgesUnavailable: graph.nodes.length > 0 && !readable,
  }
}

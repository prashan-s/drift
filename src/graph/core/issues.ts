import type { DependencyGraph, Finding, ResolvedFile } from './types'

/**
 * Structural observations about the graph.
 *
 * Severity is chosen by what the condition actually means, not by how unusual
 * it looks. A dependency cycle is an error because SwiftPM refuses to resolve
 * one. A branch pin is a note because plenty of teams ship that way on purpose.
 */
export function analyze(graph: DependencyGraph, resolved: ResolvedFile): Finding[] {
  const findings: Finding[] = []

  for (const cycle of graph.cycles) {
    findings.push({
      id: `cycle:${cycle.join('>')}`,
      severity: 'error',
      title: cycle.length === 1 ? 'Package depends on itself' : 'Dependency cycle',
      detail: `${cycle.join(' → ')} → ${cycle[0]}. SwiftPM cannot resolve a cycle; one of these edges has to go.`,
      subjects: cycle,
    })
  }

  if (resolved.duplicateIdentities.length) {
    findings.push({
      id: 'duplicate-identity',
      severity: 'error',
      title: `${count(resolved.duplicateIdentities.length, 'duplicate identity', 'duplicate identities')}`,
      detail: `${resolved.duplicateIdentities.join(', ')} appears more than once in Package.resolved. Two repositories resolving to one identity means one of them is being ignored.`,
      subjects: resolved.duplicateIdentities,
    })
  }

  const unresolved = graph.nodes.filter((n) => !n.resolved).map((n) => n.identity)
  if (unresolved.length) {
    findings.push({
      id: 'unresolved',
      severity: 'warning',
      title: `${count(unresolved.length, 'internal package')} not in Package.resolved`,
      detail:
        unresolved.length === 1
          ? `${unresolved[0]} is declared by another package's manifest but has no pin in this Package.resolved, so its resolved version is unknown.`
          : `${unresolved.join(', ')} are declared by other packages' manifests but have no pin in this Package.resolved, so their resolved versions are unknown.`,
      subjects: unresolved,
    })
  }

  const branchPinned = graph.nodes
    .filter((n) => n.resolved?.state.kind === 'branch')
    .map((n) => n.identity)
  if (branchPinned.length) {
    findings.push({
      id: 'branch-pin',
      severity: 'note',
      title: `${count(branchPinned.length, 'package')} pinned to a branch`,
      detail: `${branchPinned.join(', ')} ${branchPinned.length === 1 ? 'tracks' : 'track'} a branch rather than a version, so the resolved code moves whenever that branch does.`,
      subjects: branchPinned,
    })
  }

  const revisionPinned = graph.nodes
    .filter((n) => n.resolved?.state.kind === 'revision')
    .map((n) => n.identity)
  if (revisionPinned.length) {
    findings.push({
      id: 'revision-pin',
      severity: 'note',
      title: `${count(revisionPinned.length, 'package')} pinned to a bare revision`,
      detail: `${revisionPinned.join(', ')} ${revisionPinned.length === 1 ? 'is' : 'are'} pinned to a commit with no semantic version, so version comparison does not apply.`,
      subjects: revisionPinned,
    })
  }

  const noManifest = graph.nodes
    .filter((n) => n.manifest.kind === 'unavailable' || n.manifest.kind === 'not-attempted')
    .map((n) => n.identity)
  if (noManifest.length) {
    findings.push({
      id: 'manifest-missing',
      severity: 'warning',
      title: `No manifest read for ${count(noManifest.length, 'package')}`,
      detail:
        noManifest.length === 1
          ? `${noManifest[0]} has no readable Package.swift, so this tool does not know what it depends on. Edges out of it are missing, not absent.`
          : `${noManifest.join(', ')} have no readable Package.swift, so this tool does not know what they depend on. Edges out of these nodes are missing, not absent.`,
      subjects: noManifest,
    })
  }

  const unknownEdges = graph.edges.filter((e) => e.confidence === 'unknown')
  if (unknownEdges.length) {
    findings.push({
      id: 'unknown-edges',
      severity: 'note',
      title: `${count(unknownEdges.length, 'edge')} read from a different ref`,
      detail:
        'These declarations came from a tag or default branch rather than the exact pinned revision, so they hold for that ref but are not proven for the pinned one.',
      subjects: [...new Set(unknownEdges.map((e) => e.from))].sort(),
    })
  }

  const nonGitHub = resolved.packages.filter(
    (p) => p.repository.host !== 'github' && p.kind !== 'registry',
  )
  if (nonGitHub.length) {
    findings.push({
      id: 'non-github',
      severity: 'note',
      title: `${count(nonGitHub.length, 'package')} not hosted on GitHub`,
      detail: `${nonGitHub.map((p) => p.identity).join(', ')} ${nonGitHub.length === 1 ? 'resolves' : 'resolve'} from somewhere this tool cannot inspect, so ownership could not be determined.`,
      subjects: [],
    })
  }

  const order = { error: 0, warning: 1, note: 2 } as const
  return findings.sort((a, b) => order[a.severity] - order[b.severity] || a.id.localeCompare(b.id))
}

function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

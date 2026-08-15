import { pinLabel } from './resolved'
import type { DependencyGraph, GraphNode } from './types'

/**
 * The graph as text.
 *
 * This is not a fallback bolted on for compliance — it is the representation a
 * screen reader user reads, and the one that goes on the clipboard for a pull
 * request comment. Anything the picture conveys has to be legible here too:
 * every node, its pin, its edges, and the confidence in each of them.
 */
export function describeGraph(graph: DependencyGraph): string {
  if (!graph.nodes.length) return 'No internal packages in this manifest.'

  const byId = new Map(graph.nodes.map((node) => [node.identity, node]))
  const confidence = new Map(graph.edges.map((e) => [`${e.from} ${e.to}`, e.confidence]))

  return graph.nodes
    .map((node) => {
      const lines = [heading(node)]

      if (node.dependencies.length) {
        for (const target of node.dependencies) {
          const label = byId.get(target)?.label ?? target
          const mark = confidence.get(`${node.identity} ${target}`) === 'verified' ? '' : ' (unverified)'
          lines.push(`  depends on ${label}${mark}`)
        }
      } else if (node.manifest.kind === 'exact' || node.manifest.kind === 'fallback') {
        lines.push('  depends on no other internal package')
      } else {
        lines.push('  dependencies are unknown — no manifest was read')
      }

      if (node.dependents.length) {
        const names = node.dependents.map((id) => byId.get(id)?.label ?? id)
        lines.push(`  depended on by ${names.join(', ')}`)
      }
      return lines.join('\n')
    })
    .join('\n\n')
}

function heading(node: GraphNode): string {
  const version = node.resolved ? pinLabel(node.resolved.state) : 'not in Package.resolved'
  return `${node.label} ${version}`
}

/** One-line summary for the status region announced after an analysis run. */
export function summarize(graph: DependencyGraph): string {
  const verified = graph.edges.filter((e) => e.confidence === 'verified').length
  const unknown = graph.edges.length - verified
  const parts = [
    `${plural(graph.nodes.length, 'internal package')}`,
    `${plural(verified, 'verified dependency', 'verified dependencies')}`,
  ]
  if (unknown) parts.push(`${plural(unknown, 'unverified edge')}`)
  if (graph.cycles.length) parts.push(`${plural(graph.cycles.length, 'cycle')}`)
  parts.push(`${plural(graph.external.length, 'external package')}`)
  return `${parts.join(', ')}.`
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

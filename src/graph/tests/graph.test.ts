import { describe, expect, test } from 'bun:test'
import { buildGraph, reachableFrom, roots } from '../core/graph'
import { analyze } from '../core/issues'
import { layoutGraph } from '../core/layout'
import { normalizeRepository, orgSet } from '../core/repository'
import { parseResolved } from '../core/resolved'
import type { ManifestStatus, PackageIdentity, ResolvedFile } from '../core/types'

function resolvedOf(entries: Array<[string, string, Record<string, string>?]>): ResolvedFile {
  return parseResolved(
    JSON.stringify({
      version: 2,
      pins: entries.map(([identity, location, state]) => ({
        identity,
        kind: 'remoteSourceControl',
        location,
        state: state ?? { version: '1.0.0', revision: `rev-${identity}` },
      })),
    }),
  )
}

function manifest(urls: string[], kind: 'exact' | 'fallback' = 'exact'): ManifestStatus {
  const dependencies = urls.map((url) => ({ repository: normalizeRepository(url) }))
  return kind === 'exact'
    ? { kind: 'exact', ref: 'abc123', dependencies }
    : { kind: 'fallback', ref: 'main', reason: 'read at default branch', dependencies }
}

const gh = (name: string) => `https://github.com/bhashacode/${name}.git`
const ORGS = orgSet(['bhashacode'])

/** The worked example from the brief. */
const EXAMPLE = resolvedOf([
  ['bhashaconnectivity', gh('BhashaConnectivity')],
  ['bhashacore', gh('BhashaCore')],
  ['bhashanetworking', gh('BhashaNetworking')],
  ['alamofire', 'https://github.com/Alamofire/Alamofire.git'],
  ['swift-log', 'https://github.com/apple/swift-log.git'],
])

const EXAMPLE_MANIFESTS = new Map<PackageIdentity, ManifestStatus>([
  ['bhashaconnectivity', manifest([gh('BhashaCore'), 'https://github.com/Alamofire/Alamofire.git'])],
  ['bhashacore', manifest([gh('BhashaNetworking'), 'https://github.com/apple/swift-log.git'])],
  ['bhashanetworking', manifest([])],
])

describe('internal-only membership', () => {
  const graph = buildGraph(EXAMPLE, EXAMPLE_MANIFESTS, ORGS)

  test('only bhashacode packages become nodes', () => {
    expect(graph.nodes.map((n) => n.identity)).toEqual([
      'bhashaconnectivity',
      'bhashacore',
      'bhashanetworking',
    ])
  })

  test('third-party packages are set aside, not discarded', () => {
    expect(graph.external.map((p) => p.identity)).toEqual(['alamofire', 'swift-log'])
  })

  test('no edge points at a third-party package', () => {
    const internal = new Set(graph.nodes.map((n) => n.identity))
    for (const edge of graph.edges) {
      expect(internal.has(edge.from)).toBe(true)
      expect(internal.has(edge.to)).toBe(true)
    }
  })

  test('the brief’s expected chain is what gets drawn', () => {
    expect(graph.edges.map((e) => `${e.from}->${e.to}`)).toEqual([
      'bhashaconnectivity->bhashacore',
      'bhashacore->bhashanetworking',
    ])
  })
})

describe('edges come only from manifests', () => {
  test('co-occurrence in Package.resolved creates no edges', () => {
    const graph = buildGraph(EXAMPLE, new Map(), ORGS)
    expect(graph.nodes).toHaveLength(3)
    expect(graph.edges).toEqual([])
  })

  test('a manifest read at the pinned revision is verified', () => {
    const graph = buildGraph(EXAMPLE, EXAMPLE_MANIFESTS, ORGS)
    expect(graph.edges.every((e) => e.confidence === 'verified')).toBe(true)
  })

  test('a manifest read at another ref is unknown, never verified', () => {
    const graph = buildGraph(
      EXAMPLE,
      new Map([['bhashaconnectivity', manifest([gh('BhashaCore')], 'fallback')]]),
      ORGS,
    )
    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0].confidence).toBe('unknown')
    expect(graph.edges[0].ref).toBe('main')
  })

  test('an unavailable manifest contributes nothing at all', () => {
    const graph = buildGraph(
      EXAMPLE,
      new Map([['bhashaconnectivity', { kind: 'unavailable', reason: '403' }]]),
      ORGS,
    )
    expect(graph.edges).toEqual([])
  })

  test('a self-referencing declaration is dropped', () => {
    const graph = buildGraph(
      EXAMPLE,
      new Map([['bhashacore', manifest([gh('BhashaCore')])]]),
      ORGS,
    )
    expect(graph.edges).toEqual([])
  })

  test('the same dependency declared twice yields one edge', () => {
    const graph = buildGraph(
      EXAMPLE,
      new Map([['bhashaconnectivity', manifest([gh('BhashaCore'), gh('bhashacore')])]]),
      ORGS,
    )
    expect(graph.edges).toHaveLength(1)
  })
})

describe('transitive and disconnected shapes', () => {
  test('dependencies and dependents are recorded on both ends', () => {
    const graph = buildGraph(EXAMPLE, EXAMPLE_MANIFESTS, ORGS)
    const core = graph.nodes.find((n) => n.identity === 'bhashacore')!
    expect(core.dependencies).toEqual(['bhashanetworking'])
    expect(core.dependents).toEqual(['bhashaconnectivity'])
  })

  test('transitive reach is computed over edges, not over the pin list', () => {
    const graph = buildGraph(EXAMPLE, EXAMPLE_MANIFESTS, ORGS)
    expect(reachableFrom(graph, ['bhashaconnectivity'])).toEqual([
      'bhashaconnectivity',
      'bhashacore',
      'bhashanetworking',
    ])
  })

  test('a package nothing references is still a node', () => {
    const resolved = resolvedOf([
      ['a', gh('A')],
      ['b', gh('B')],
      ['orphan', gh('Orphan')],
    ])
    const graph = buildGraph(resolved, new Map([['a', manifest([gh('B')])]]), ORGS)
    expect(graph.nodes.map((n) => n.identity)).toEqual(['a', 'b', 'orphan'])
    expect(roots(graph)).toEqual(['a', 'orphan'])
  })

  test('an internal dependency missing from Package.resolved appears, unpinned', () => {
    const resolved = resolvedOf([['a', gh('A')]])
    const graph = buildGraph(resolved, new Map([['a', manifest([gh('Ghost')])]]), ORGS)
    const ghost = graph.nodes.find((n) => n.identity === 'ghost')!
    expect(ghost.resolved).toBeUndefined()
    expect(analyze(graph, resolved).some((f) => f.id === 'unresolved')).toBe(true)
  })
})

describe('cycles', () => {
  test('a two-package cycle is detected', () => {
    const resolved = resolvedOf([
      ['a', gh('A')],
      ['b', gh('B')],
    ])
    const graph = buildGraph(
      resolved,
      new Map([
        ['a', manifest([gh('B')])],
        ['b', manifest([gh('A')])],
      ]),
      ORGS,
    )
    expect(graph.cycles).toEqual([['a', 'b']])
    expect(analyze(graph, resolved)[0].severity).toBe('error')
  })

  test('a three-package cycle is detected', () => {
    const graph = buildGraph(
      resolvedOf([
        ['a', gh('A')],
        ['b', gh('B')],
        ['c', gh('C')],
      ]),
      new Map([
        ['a', manifest([gh('B')])],
        ['b', manifest([gh('C')])],
        ['c', manifest([gh('A')])],
      ]),
      ORGS,
    )
    expect(graph.cycles).toEqual([['a', 'b', 'c']])
  })

  test('a diamond is not a cycle', () => {
    const graph = buildGraph(
      resolvedOf([
        ['a', gh('A')],
        ['b', gh('B')],
        ['c', gh('C')],
        ['d', gh('D')],
      ]),
      new Map([
        ['a', manifest([gh('B'), gh('C')])],
        ['b', manifest([gh('D')])],
        ['c', manifest([gh('D')])],
      ]),
      ORGS,
    )
    expect(graph.cycles).toEqual([])
  })

  test('a long chain does not overflow the stack', () => {
    const size = 3000
    const names = Array.from({ length: size }, (_, i) => `p${String(i).padStart(5, '0')}`)
    const resolved = resolvedOf(names.map((n) => [n, gh(n)] as [string, string]))
    const manifests = new Map(
      names.slice(0, -1).map((n, i) => [n, manifest([gh(names[i + 1])])] as const),
    )
    const graph = buildGraph(resolved, manifests, ORGS)
    expect(graph.edges).toHaveLength(size - 1)
    expect(graph.cycles).toEqual([])
  })
})

describe('determinism', () => {
  const shuffled = resolvedOf([
    ['bhashanetworking', gh('BhashaNetworking')],
    ['alamofire', 'https://github.com/Alamofire/Alamofire.git'],
    ['bhashaconnectivity', gh('BhashaConnectivity')],
    ['swift-log', 'https://github.com/apple/swift-log.git'],
    ['bhashacore', gh('BhashaCore')],
  ])

  test('pin order does not change the graph', () => {
    const a = buildGraph(EXAMPLE, EXAMPLE_MANIFESTS, ORGS)
    const b = buildGraph(shuffled, EXAMPLE_MANIFESTS, ORGS)
    expect(b.nodes.map((n) => n.identity)).toEqual(a.nodes.map((n) => n.identity))
    expect(b.edges).toEqual(a.edges)
  })

  test('pin order does not change the layout', () => {
    const a = layoutGraph(buildGraph(EXAMPLE, EXAMPLE_MANIFESTS, ORGS))
    const b = layoutGraph(buildGraph(shuffled, EXAMPLE_MANIFESTS, ORGS))
    expect(b.nodes).toEqual(a.nodes)
    expect(b.width).toBe(a.width)
    expect(b.height).toBe(a.height)
  })

  test('repeated runs are byte-identical', () => {
    const once = JSON.stringify(layoutGraph(buildGraph(EXAMPLE, EXAMPLE_MANIFESTS, ORGS)))
    const twice = JSON.stringify(layoutGraph(buildGraph(EXAMPLE, EXAMPLE_MANIFESTS, ORGS)))
    expect(twice).toBe(once)
  })
})

describe('layout', () => {
  test('dependers sit above what they depend on', () => {
    const layout = layoutGraph(buildGraph(EXAMPLE, EXAMPLE_MANIFESTS, ORGS))
    const layer = new Map(layout.nodes.map((n) => [n.identity, n.layer]))
    expect(layer.get('bhashaconnectivity')).toBe(0)
    expect(layer.get('bhashacore')).toBe(1)
    expect(layer.get('bhashanetworking')).toBe(2)
  })

  test('a cycle lays out without hanging, with the closing edge marked', () => {
    const graph = buildGraph(
      resolvedOf([
        ['a', gh('A')],
        ['b', gh('B')],
      ]),
      new Map([
        ['a', manifest([gh('B')])],
        ['b', manifest([gh('A')])],
      ]),
      ORGS,
    )
    const layout = layoutGraph(graph)
    expect(layout.nodes).toHaveLength(2)
    expect(layout.edges.filter((e) => e.reversed)).toHaveLength(1)
  })

  test('an empty graph lays out to nothing', () => {
    const layout = layoutGraph(buildGraph(resolvedOf([]), new Map(), ORGS))
    expect(layout).toEqual({ nodes: [], edges: [], width: 0, height: 0 })
  })

  test('no two nodes overlap', () => {
    const layout = layoutGraph(buildGraph(EXAMPLE, EXAMPLE_MANIFESTS, ORGS))
    for (const a of layout.nodes) {
      for (const b of layout.nodes) {
        if (a === b) continue
        const apart =
          a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y
        expect(apart).toBe(true)
      }
    }
  })
})

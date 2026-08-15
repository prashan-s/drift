/**
 * Render smoke tests.
 *
 * These do not assert on styling — they assert that every panel renders, that
 * the accessible structure the brief requires is actually in the markup, and
 * that the textual alternative carries the same facts as the diagram.
 */
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { analyzeWithoutNetwork } from '../analysis'
import { buildGraph } from '../core/graph'
import { normalizeRepository, orgSet } from '../core/repository'
import { parseResolved } from '../core/resolved'
import type { ManifestStatus, PackageIdentity } from '../core/types'
import { SAMPLE_RESOLVED } from '../sample'
import { ExternalTable } from '../ui/ExternalTable'
import { GraphView } from '../ui/GraphView'
import { PackageDetails } from '../ui/PackageDetails'
import { Summary } from '../ui/Summary'

const resolved = parseResolved(SAMPLE_RESOLVED)
const ORGS = orgSet(['bhashacode'])

const manifests = new Map<PackageIdentity, ManifestStatus>([
  [
    'swift-spm-bhasha-connectivity',
    {
      kind: 'exact',
      ref: '0000000000000000000000000000000000000006',
      dependencies: [
        { repository: normalizeRepository('https://github.com/bhashacode/swift-spm-helago-contracts.git'), requirement: 'from 1.2.0' },
        { repository: normalizeRepository('https://github.com/emqx/CocoaMQTT.git'), requirement: 'from 2.1.0' },
      ],
    },
  ],
  [
    'swift-spm-bhasha-callkit-ui',
    {
      kind: 'fallback',
      ref: 'main',
      reason: 'read at the default branch.',
      dependencies: [
        { repository: normalizeRepository('git@github.com:bhashacode/swift-spm-bhasha-callkit-core.git') },
      ],
    },
  ],
])

const graph = buildGraph(resolved, manifests, ORGS)

describe('GraphView', () => {
  test('renders without a DOM — no browser-only global read during render', () => {
    expect(() =>
      renderToStaticMarkup(<GraphView graph={graph} selected={undefined} onSelect={() => {}} />),
    ).not.toThrow()
  })

  const html = renderToStaticMarkup(
    <GraphView graph={graph} selected="swift-spm-bhasha-connectivity" onSelect={() => {}} />,
  )

  test('every node is a real button, so it is focusable and activatable', () => {
    for (const node of graph.nodes) {
      expect(html).toContain(`data-identity="${node.identity}"`)
    }
    expect(html.match(/<button/g)?.length).toBeGreaterThanOrEqual(graph.nodes.length)
  })

  test('exactly one node is in the tab order (roving tabindex)', () => {
    expect(html.match(/data-identity="[^"]+" class="graph-node" aria-pressed="true" tabindex="0"/g)).toHaveLength(1)
  })

  test('the SVG carrying edges is hidden from assistive technology', () => {
    expect(html).toContain('class="graph-edges"')
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"[^>]*class="graph-edges"/)
  })

  test('confidence is encoded in stroke style, not colour alone', () => {
    expect(html).toContain('class="edge verified')
    expect(html).toContain('class="edge unknown')
  })

  test('the toolbar buttons carry visible text labels, not icons alone', () => {
    for (const label of ['Out', 'In', 'Fit', 'Reset']) {
      expect(html).toContain(`${label}</button>`)
    }
  })

  test('the legend states the edge direction convention', () => {
    expect(html).toContain('A depends on B')
  })

  test('the legend is a toggle, closed and hidden from assistive tech by default', () => {
    expect(html).toContain('Legend</button>')
    expect(html).toMatch(/class="graph-legend"[^>]*data-open="false"[^>]*aria-hidden="true"/)
  })

  test('the toggle is wired to the legend it controls', () => {
    const controls = /aria-pressed="false" aria-controls="([^"]+)"/.exec(html)?.[1]
    expect(controls).toBeTruthy()
    expect(html).toContain(`id="${controls}"`)
  })

  test('no organisation name is baked into the graph copy', () => {
    expect(html.toLowerCase()).not.toContain('bhashacode package')
  })
})

describe('Summary', () => {
  test('counts every category the brief asks for', () => {
    const html = renderToStaticMarkup(
      <Summary analysis={analyzeWithoutNetwork(resolved, ORGS)} onSelect={() => {}} />,
    )
    for (const label of ['Packages', 'Verified', 'Unverified', 'Cycles', 'External']) {
      expect(html).toContain(label)
    }
  })

  test('an edgeless graph says so as an alert, not as a silent empty diagram', () => {
    const html = renderToStaticMarkup(
      <Summary analysis={analyzeWithoutNetwork(resolved, ORGS)} onSelect={() => {}} />,
    )
    expect(html).toContain('role="alert"')
    expect(html).toContain('No edges could be established')
  })

  test('findings label severity in words as well as colour', () => {
    const html = renderToStaticMarkup(
      <Summary analysis={analyzeWithoutNetwork(resolved, ORGS)} onSelect={() => {}} />,
    )
    expect(html).toContain('Warning</span>')
  })
})

describe('PackageDetails', () => {
  const html = renderToStaticMarkup(
    <PackageDetails graph={graph} selected="swift-spm-bhasha-connectivity" onSelect={() => {}} />,
  )

  test('shows repository, version, and both edge counts', () => {
    expect(html).toContain('Resolved version')
    expect(html).toContain('1.4.0')
    expect(html).toContain('Internal dependencies')
    expect(html).toContain('Internal dependents')
    expect(html).toContain('github.com/bhashacode/swift-spm-bhasha-connectivity')
  })

  test('marks a verified edge as verified', () => {
    expect(html).toContain('>Verified</span>')
    expect(html).toContain('from 1.2.0')
  })

  test('marks an edge read from another ref as unknown', () => {
    const fallback = renderToStaticMarkup(
      <PackageDetails graph={graph} selected="swift-spm-bhasha-callkit-ui" onSelect={() => {}} />,
    )
    expect(fallback).toContain('>Unknown</span>')
  })

  test('distinguishes “no dependencies” from “dependencies unknown”', () => {
    const unknown = renderToStaticMarkup(
      <PackageDetails graph={graph} selected="swift-spm-webrtckit-core" onSelect={() => {}} />,
    )
    expect(unknown).toContain('missing rather than absent')
  })
})

describe('ExternalTable', () => {
  const html = renderToStaticMarkup(<ExternalTable packages={graph.external} />)

  test('lists third-party packages with their versions', () => {
    expect(html).toContain('Alamofire')
    expect(html).toContain('5.10.2')
    expect(html).toContain('swift-log')
  })

  test('offers the table as copyable text', () => {
    expect(html).toContain('Copy<span class="sr-only"> external packages table</span>')
  })

  test('says a version is unchecked rather than implying it is current', () => {
    expect(html).toContain('unchecked')
  })

  test('says plainly that they are not in the graph', () => {
    expect(html).toContain('not in the graph')
  })

  test('none of them is a graph node', () => {
    const diagram = renderToStaticMarkup(
      <GraphView graph={graph} selected={undefined} onSelect={() => {}} />,
    )
    for (const name of ['Alamofire', 'CocoaMQTT', 'swift-log']) {
      expect(diagram).not.toContain(`>${name}<`)
    }
  })
})

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faCircleQuestion,
  faXmark,
  faExpand,
  faMagnifyingGlassMinus,
  faMagnifyingGlassPlus,
  faRotateLeft,
} from '@fortawesome/free-solid-svg-icons'
import { layoutGraph, NODE_HEIGHT, NODE_WIDTH, type LaidOutEdge, type LaidOutNode } from '../core/layout'
import { pinLabel } from '../core/resolved'
import type { DependencyGraph, PackageIdentity } from '../core/types'
import { DRIFT_BADGE } from '../../components/drift'
import type { LatestState } from '../../lib/session'
import { versionView } from '../versions'

interface Props {
  graph: DependencyGraph
  selected?: PackageIdentity
  onSelect: (identity: PackageIdentity) => void
  /** View switcher and copy action, rendered into this component's toolbar. */
  toolbar?: React.ReactNode
  /** Newest release per repository, keyed owner/repo. */
  latest?: Record<string, LatestState>
}

const ZOOM_STEPS = [0.5, 0.65, 0.8, 1, 1.25, 1.5, 2]
const LEGEND_KEY = 'drift.graph.legend'
/** Must match markerWidth on the arrow markers below. */
const ARROW_LENGTH = 9
const DEFAULT_ZOOM = 3

/**
 * The diagram.
 *
 * Nodes are real `<button>` elements positioned over an SVG that carries only
 * the edges. That split is deliberate: buttons come with focus, activation and
 * an accessible name for free, which an SVG `<g>` does not. The whole thing is
 * one tab stop with a roving tabindex, and the arrow keys walk the graph
 * structurally — down to a dependency, up to a dependent — so a keyboard user
 * traverses the same relationships a mouse user reads off the lines.
 */
export function GraphView({ graph, selected, onSelect, toolbar, latest }: Props) {
  const layout = useMemo(() => layoutGraph(graph), [graph])
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM)
  const viewport = useRef<HTMLDivElement>(null)
  const surface = useRef<HTMLDivElement>(null)

  const legendId = useId()
  // Remembered, because whether you want the key up is a standing preference
  // rather than a per-visit decision.
  // Guarded: this runs during render, where there may be no DOM at all.
  const [legendOpen, setLegendOpen] = useState(
    () => typeof localStorage !== 'undefined' && localStorage.getItem(LEGEND_KEY) === '1',
  )

  useEffect(() => {
    localStorage.setItem(LEGEND_KEY, legendOpen ? '1' : '0')
  }, [legendOpen])

  const zoom = ZOOM_STEPS[zoomIndex]
  const byId = useMemo(() => new Map(layout.nodes.map((n) => [n.identity, n])), [layout])
  const nodeIndex = useMemo(() => new Map(graph.nodes.map((n) => [n.identity, n])), [graph])

  const focusNode = useCallback((identity: PackageIdentity) => {
    const element = surface.current?.querySelector<HTMLButtonElement>(
      `[data-identity="${CSS.escape(identity)}"]`,
    )
    element?.focus()
    element?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [])

  const fit = useCallback(() => {
    const box = viewport.current
    if (!box || !layout.width) return
    const ratio = Math.min(box.clientWidth / layout.width, box.clientHeight / layout.height)
    let best = 0
    ZOOM_STEPS.forEach((step, i) => {
      if (step <= ratio) best = i
    })
    setZoomIndex(best)
    box.scrollTo({ top: 0, left: 0 })
  }, [layout])

  const reset = useCallback(() => {
    setZoomIndex(DEFAULT_ZOOM)
    viewport.current?.scrollTo({ top: 0, left: 0 })
  }, [])

  // A fresh graph starts fitted. Opening at 100% on a wide graph strands the
  // nodes in a corner of an empty canvas, which reads as an empty result.
  useEffect(() => {
    fit()
  }, [fit])

  // Keep the selected node in view when selection changes from elsewhere.
  useEffect(() => {
    if (!selected) return
    surface.current
      ?.querySelector(`[data-identity="${CSS.escape(selected)}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [selected])

  const onKeyDown = (event: React.KeyboardEvent, node: LaidOutNode) => {
    const record = nodeIndex.get(node.identity)
    if (!record) return

    let target: PackageIdentity | undefined
    switch (event.key) {
      case 'ArrowDown':
        target = record.dependencies[0]
        break
      case 'ArrowUp':
        target = record.dependents[0]
        break
      case 'ArrowRight':
      case 'ArrowLeft': {
        const row = layout.nodes
          .filter((n) => n.layer === node.layer)
          .sort((a, b) => a.column - b.column)
        const at = row.findIndex((n) => n.identity === node.identity)
        target = row[at + (event.key === 'ArrowRight' ? 1 : -1)]?.identity
        break
      }
      case 'Home':
        target = layout.nodes.find((n) => n.layer === 0 && n.column === 0)?.identity
        break
      case 'End':
        target = layout.nodes[layout.nodes.length - 1]?.identity
        break
      default:
        return
    }

    if (!target) return
    event.preventDefault()
    onSelect(target)
    focusNode(target)
  }

  if (!layout.nodes.length) return null

  const active = selected && byId.has(selected) ? selected : layout.nodes[0].identity

  return (
    <div className="graph">
      {/* One toolbar, not two: the view switcher passed in from above sits in
          the same row as the zoom controls it shares a purpose with. */}
      <div className="graph-toolbar">
        {toolbar}
        <div className="toolbar-group" role="group" aria-label="Zoom">
          <button
            type="button"
            className="btn btn-icon-text"
            onClick={() => setZoomIndex((i) => Math.max(0, i - 1))}
            disabled={zoomIndex === 0}
          >
            <FontAwesomeIcon icon={faMagnifyingGlassMinus} aria-hidden="true" fixedWidth />
            Out
          </button>
          <output className="zoom-readout">{Math.round(zoom * 100)}%</output>
          <button
            type="button"
            className="btn btn-icon-text"
            onClick={() => setZoomIndex((i) => Math.min(ZOOM_STEPS.length - 1, i + 1))}
            disabled={zoomIndex === ZOOM_STEPS.length - 1}
          >
            <FontAwesomeIcon icon={faMagnifyingGlassPlus} aria-hidden="true" fixedWidth />
            In
          </button>
          <button type="button" className="btn btn-icon-text" onClick={fit}>
            <FontAwesomeIcon icon={faExpand} aria-hidden="true" fixedWidth />
            Fit
          </button>
          <button type="button" className="btn btn-icon-text" onClick={reset}>
            <FontAwesomeIcon icon={faRotateLeft} aria-hidden="true" fixedWidth />
            Reset
          </button>
          <button
            type="button"
            className="btn btn-icon-text"
            aria-pressed={legendOpen}
            aria-controls={legendId}
            onClick={() => setLegendOpen((open) => !open)}
          >
            <FontAwesomeIcon icon={faCircleQuestion} aria-hidden="true" fixedWidth />
            Legend
          </button>
        </div>
      </div>

      <div className="graph-canvas">
        <div className="graph-viewport" ref={viewport} tabIndex={-1}>
        <div
          className="graph-surface"
          ref={surface}
          style={{
            width: layout.width * zoom,
            height: layout.height * zoom,
          }}
        >
          <div
            className="graph-scale"
            style={{ width: layout.width, height: layout.height, transform: `scale(${zoom})` }}
          >
            <svg
              width={layout.width}
              height={layout.height}
              aria-hidden="true"
              focusable="false"
              className="graph-edges"
            >
              <defs>
                {/*
                  `orient="auto"` — `auto-start-reverse` is for marker-start and
                  only confused matters here. `markerUnits="userSpaceOnUse"`
                  keeps the head one size instead of growing with the stroke
                  when an edge is highlighted. `refX` at the tip puts the point
                  exactly on the node edge the curve ends at.
                */}
                <marker
                  id="arrow-verified"
                  viewBox="0 0 10 10"
                  refX="0"
                  refY="5"
                  markerWidth="9"
                  markerHeight="9"
                  markerUnits="userSpaceOnUse"
                  orient="auto"
                >
                  <path d="M0,0 L10,5 L0,10 Z" className="arrow" />
                </marker>
                <marker
                  id="arrow-unknown"
                  viewBox="0 0 10 10"
                  refX="0"
                  refY="5"
                  markerWidth="9"
                  markerHeight="9"
                  markerUnits="userSpaceOnUse"
                  orient="auto"
                >
                  {/* Hollow, so confidence survives greyscale and colour blindness. */}
                  <path d="M1,1 L9,5 L1,9 Z" className="arrow-open" />
                </marker>
              </defs>
              {layout.edges.map((edge) => (
                <Edge
                  key={`${edge.from}->${edge.to}`}
                  edge={edge}
                  from={byId.get(edge.from)}
                  to={byId.get(edge.to)}
                  highlighted={edge.from === active || edge.to === active}
                />
              ))}
            </svg>

            {layout.nodes.map((node) => {
              const record = nodeIndex.get(node.identity)!
              const isSelected = node.identity === active
              const key =
                record.repository.owner && record.repository.name
                  ? `${record.repository.owner}/${record.repository.name}`.toLowerCase()
                  : ''
              const version = versionView(record.resolved?.state, latest?.[key])
              return (
                <button
                  key={node.identity}
                  type="button"
                  data-identity={node.identity}
                  className="graph-node"
                  aria-pressed={isSelected}
                  tabIndex={isSelected ? 0 : -1}
                  style={{ left: node.x, top: node.y, width: NODE_WIDTH, height: NODE_HEIGHT }}
                  onClick={() => onSelect(node.identity)}
                  onKeyDown={(event) => onKeyDown(event, node)}
                >
                  <span className="graph-node-name">{record.label}</span>
                  <span className="graph-node-meta">
                    <span>{record.resolved ? pinLabel(record.resolved.state) : 'no pin'}</span>
                    {version.latest && version.latest !== version.pinned ? (
                      <span className="node-latest">→ {version.latest}</span>
                    ) : null}
                    <span className="node-degree" aria-hidden="true">
                      {record.dependencies.length}↓ {record.dependents.length}↑
                    </span>
                  </span>
                  {version.drift !== 'unknown' ? (
                    <span className="node-drift badge" data-drift={version.drift}>
                      {DRIFT_BADGE[version.drift]}
                    </span>
                  ) : null}
                  {/* The glyphs are compact; the screen reader gets words. */}
                  <span className="sr-only">
                    {record.dependencies.length} dependencies, {record.dependents.length} dependents
                    {version.latest ? `, latest release ${version.latest}` : ''}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
        </div>

        {/*
          A floating card pinned to the canvas corner. `pointer-events: none`
          on the card is what keeps it from obstructing: a click meant for a
          node beneath it passes straight through. Only the close button opts
          back in.
        */}
        <dl className="graph-legend" id={legendId} data-open={legendOpen} aria-hidden={!legendOpen}>
          <div className="legend-head">
            <span className="micro">Legend</span>
            <button
              type="button"
              className="legend-close"
              onClick={() => setLegendOpen(false)}
              tabIndex={legendOpen ? 0 : -1}
            >
              <FontAwesomeIcon icon={faXmark} aria-hidden="true" fixedWidth />
              <span className="sr-only">Hide legend</span>
            </button>
          </div>
          <div className="legend-row">
            <dt>
              <svg width="34" height="10" aria-hidden="true" focusable="false">
                <line x1="0" y1="5" x2="24" y2="5" className="edge verified" />
                <path d="M24,1 L32,5 L24,9 z" className="legend-arrow" />
              </svg>
            </dt>
            <dd>Verified at the pinned revision</dd>
          </div>
          <div className="legend-row">
            <dt>
              <svg width="34" height="10" aria-hidden="true" focusable="false">
                <line x1="0" y1="5" x2="24" y2="5" className="edge unknown" />
                <path d="M24,0.5 L32.5,5 L24,9.5 z" className="legend-arrow-open" />
              </svg>
            </dt>
            <dd>Read at another ref — unverified</dd>
          </div>
          <div className="legend-row">
            <dt className="node-degree">n↓ n↑</dt>
            <dd>Dependencies, dependents</dd>
          </div>
          <div className="legend-row">
            <dt aria-hidden="true">A→B</dt>
            <dd>A depends on B</dd>
          </div>
          <div className="legend-row">
            <dt aria-hidden="true">↑↓</dt>
            <dd>Walk to a dependent or dependency</dd>
          </div>
        </dl>
      </div>
    </div>
  )
}

function Edge({
  edge,
  from,
  to,
  highlighted,
}: {
  edge: LaidOutEdge
  from?: LaidOutNode
  to?: LaidOutNode
  highlighted: boolean
}) {
  if (!from || !to) return null

  const start = { x: from.x + NODE_WIDTH / 2, y: edge.reversed ? from.y : from.y + NODE_HEIGHT }
  const lift = edge.reversed ? -1 : 1

  // Stop the line where the arrowhead begins. Drawn to the node edge instead,
  // the stroke runs through the hollow head and fills it in.
  const tipY = edge.reversed ? to.y + NODE_HEIGHT : to.y
  const end = { x: to.x + NODE_WIDTH / 2, y: tipY - ARROW_LENGTH * lift }
  const bend = Math.max(24, Math.abs(end.y - start.y) / 2)

  return (
    <path
      d={`M ${start.x} ${start.y} C ${start.x} ${start.y + bend * lift}, ${end.x} ${end.y - bend * lift}, ${end.x} ${end.y}`}
      className={`edge ${edge.confidence}${highlighted ? ' highlighted' : ''}${edge.reversed ? ' reversed' : ''}`}
      markerEnd={`url(#arrow-${edge.confidence})`}
      fill="none"
    />
  )
}

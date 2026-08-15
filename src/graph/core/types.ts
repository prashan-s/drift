/**
 * Domain models for the internal dependency graph.
 *
 * Nothing in `core/` touches React, `fetch`, or the DOM — every function here is
 * pure and directly unit testable. The GitHub layer supplies raw text; the UI
 * layer renders the structures below.
 */

/** Canonical, comparison-safe identity for a package: lowercased repo name. */
export type PackageIdentity = string

/** A repository location parsed down to the parts we compare on. */
export interface PackageRepository {
  /** Exactly what appeared in the input, untouched. */
  raw: string
  /** `github` when we recognised a GitHub host, otherwise `other`. */
  host: 'github' | 'other'
  /** Owner as GitHub spells it, e.g. `bhashacode`. Absent for non-GitHub. */
  owner?: string
  /** Repository name as GitHub spells it, `.git` and trailing slashes removed. */
  name?: string
  /** Lowercased owner, for case-insensitive organisation comparison. */
  ownerKey?: string
  /** Canonical browse URL, or `undefined` when the location is not GitHub. */
  url?: string
}

/** How a pin was resolved. `Package.resolved` gives exactly one of these. */
export type PinState =
  | { kind: 'version'; version: string; revision?: string }
  | { kind: 'branch'; branch: string; revision?: string }
  | { kind: 'revision'; revision: string }
  | { kind: 'unpinned' }

/** One entry from a `Package.resolved` pins array. */
export interface ResolvedPackage {
  /** Position in the file, 0-based. Preserved so ordering stays deterministic. */
  order: number
  identity: PackageIdentity
  /** `name` from schema v1, when present. Undefined on v2/v3. */
  displayName?: string
  repository: PackageRepository
  state: PinState
  /** `remoteSourceControl`, `registry`, `localSourceControl`, … when stated. */
  kind?: string
}

export interface ResolvedFile {
  /** `version` field from the file: 1, 2 or 3. */
  schemaVersion: number
  packages: ResolvedPackage[]
  /** Identities that appeared more than once, lowercased. */
  duplicateIdentities: PackageIdentity[]
}

/** A dependency declared in a `Package.swift`, before internal filtering. */
export interface ManifestDependency {
  repository: PackageRepository
  /** Verbatim requirement text, e.g. `from: "1.2.0"`. Display only. */
  requirement?: string
}

/** Why a package's outgoing edges are or are not known. */
export type ManifestStatus =
  | { kind: 'not-attempted' }
  | { kind: 'loading' }
  /** Manifest read at exactly the pinned revision. Edges are trustworthy. */
  | { kind: 'exact'; ref: string; dependencies: ManifestDependency[] }
  /** Manifest read at a different ref (tag or default branch). Edges may drift. */
  | { kind: 'fallback'; ref: string; reason: string; dependencies: ManifestDependency[] }
  /** No manifest. We know nothing about this package's dependencies. */
  | { kind: 'unavailable'; reason: string; remedy?: string }

/**
 * Confidence in a single edge.
 *
 * `verified` — read from the depender's `Package.swift` at the exact revision
 *   `Package.resolved` pinned. This is the only case we draw as solid.
 * `unknown` — the declaration was read from a different ref, so the edge is
 *   real for *that* ref but not proven for the pinned one.
 *
 * There is deliberately no third state for "inferred": we never create an edge
 * that no manifest stated.
 */
export type EdgeConfidence = 'verified' | 'unknown'

export interface InternalDependency {
  from: PackageIdentity
  to: PackageIdentity
  confidence: EdgeConfidence
  /** Git ref the declaration was read at. Shown in the details panel. */
  ref: string
  /** Requirement text from the manifest, e.g. `from: "1.2.0"`. */
  requirement?: string
}

export interface GraphNode {
  identity: PackageIdentity
  /** Repository name as GitHub spells it — the label shown on the node. */
  label: string
  repository: PackageRepository
  /** The pin from `Package.resolved`, absent when only a manifest named it. */
  resolved?: ResolvedPackage
  manifest: ManifestStatus
  dependencies: PackageIdentity[]
  dependents: PackageIdentity[]
}

export interface DependencyGraph {
  /** Sorted by identity, so repeated analysis produces identical output. */
  nodes: GraphNode[]
  /** Sorted by (from, to). */
  edges: InternalDependency[]
  /** Every strongly connected component with more than one node, plus self-loops. */
  cycles: PackageIdentity[][]
  /** Packages in `Package.resolved` that are not owned by the organisation. */
  external: ResolvedPackage[]
}

/** A GitHub release or, when releases are unavailable, a tag. */
export interface Release {
  tag: string
  name?: string
  /** ISO 8601. Absent for tags, which carry no publish date. */
  publishedAt?: string
  prerelease: boolean
  /** Raw markdown. Rendered as plain text — never as HTML. */
  body?: string
  url: string
  /** `releases` when from the Releases API, `tags` when derived from a tag. */
  origin: 'releases' | 'tags'
}

/** A structural observation. Not necessarily a problem — severity says which. */
export interface Finding {
  id: string
  severity: 'error' | 'warning' | 'note'
  title: string
  detail: string
  /** Packages the finding points at, for the "show me" jump. */
  subjects: PackageIdentity[]
}

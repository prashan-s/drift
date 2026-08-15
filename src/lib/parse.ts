export type Requirement =
  | { kind: 'exact'; version: string }
  | { kind: 'from'; version: string }
  | { kind: 'upToNextMinor'; version: string }
  | { kind: 'range'; lower: string; upper: string; closed: boolean }
  | { kind: 'branch'; name: string }
  | { kind: 'revision'; sha: string }
  | { kind: 'resolved'; version: string }
  | { kind: 'none' }

export interface Dependency {
  /** Position in the manifest, 1-based. Order is preserved end to end. */
  order: number
  identity: string
  location: string
  owner?: string
  repo?: string
  /** Version SwiftPM actually locked, when the source knows one. */
  pinned?: string
  revision?: string
  requirement: Requirement
  supported: boolean
  note?: string
}

export interface ParseResult {
  source: 'Package.resolved' | 'Package.swift' | 'URL list' | 'none'
  detail: string
  dependencies: Dependency[]
  error?: string
}

const EMPTY: ParseResult = { source: 'none', detail: '', dependencies: [] }

export function parseManifest(text: string): ParseResult {
  const trimmed = text.trim()
  if (!trimmed) return EMPTY
  if (trimmed.startsWith('{')) return parseResolved(trimmed)
  if (trimmed.includes('.package(')) return parsePackageSwift(trimmed)
  const urls = parseUrlList(trimmed)
  if (urls.dependencies.length) return urls
  return { ...EMPTY, error: 'Paste a Package.resolved, a Package.swift, or a list of repository URLs.' }
}

/* ------------------------------------------------------------------ resolved */

interface ResolvedStateJSON {
  version?: string
  branch?: string
  revision?: string
}

function parseResolved(text: string): ParseResult {
  let json: Record<string, unknown>
  try {
    json = JSON.parse(text)
  } catch {
    return { ...EMPTY, error: 'That looks like JSON but it will not parse. Check for a truncated paste.' }
  }

  const formatVersion = Number(json.version ?? 0)
  const v1Pins = (json.object as { pins?: unknown[] } | undefined)?.pins
  const rawPins = (Array.isArray(json.pins) ? json.pins : v1Pins) as unknown[] | undefined

  if (!Array.isArray(rawPins)) {
    return { ...EMPTY, error: 'No `pins` array found in this Package.resolved.' }
  }

  const dependencies = rawPins.map((entry, i) => {
    const pin = entry as Record<string, unknown>
    const state = (pin.state ?? {}) as ResolvedStateJSON
    const location = String(pin.location ?? pin.repositoryURL ?? '')
    const identity = String(pin.identity ?? pin.package ?? repoNameFrom(location) ?? `package-${i + 1}`)
    const { owner, repo } = parseGitHub(location)

    let requirement: Requirement = { kind: 'none' }
    if (state.version) requirement = { kind: 'resolved', version: state.version }
    else if (state.branch) requirement = { kind: 'branch', name: state.branch }
    else if (state.revision) requirement = { kind: 'revision', sha: state.revision }

    return {
      order: i + 1,
      identity,
      location,
      owner,
      repo,
      pinned: state.version,
      revision: state.revision,
      requirement,
      supported: Boolean(owner && repo),
      note: owner && repo ? undefined : 'Not a GitHub repository',
    }
  })

  const label = formatVersion ? `v${formatVersion}` : 'unversioned'
  return {
    source: 'Package.resolved',
    detail: `${label} · ${dependencies.length} ${plural(dependencies.length, 'pin')}`,
    dependencies,
  }
}

/* --------------------------------------------------------------- Package.swift */

function parsePackageSwift(text: string): ParseResult {
  const calls = extractPackageCalls(text)
  const dependencies: Dependency[] = []

  calls.forEach((call) => {
    const urlMatch =
      /\burl\s*:\s*"([^"]+)"/.exec(call) ?? /\blocation\s*:\s*"([^"]+)"/.exec(call)
    const pathMatch = /\bpath\s*:\s*"([^"]+)"/.exec(call)
    const idMatch = /\bid\s*:\s*"([^"]+)"/.exec(call)

    const location = urlMatch?.[1] ?? pathMatch?.[1] ?? idMatch?.[1]
    if (!location) return

    const { owner, repo } = urlMatch ? parseGitHub(location) : {}
    const order = dependencies.length + 1
    const identity =
      /\bname\s*:\s*"([^"]+)"/.exec(call)?.[1] ?? repoNameFrom(location) ?? `package-${order}`

    let note: string | undefined
    if (pathMatch) note = 'Local path dependency'
    else if (idMatch && !urlMatch) note = 'Registry dependency'
    else if (!owner) note = 'Not a GitHub repository'

    dependencies.push({
      order,
      identity,
      location,
      owner,
      repo,
      requirement: readRequirement(call),
      supported: Boolean(owner && repo),
      note,
    })
  })

  if (!dependencies.length) {
    return { ...EMPTY, error: 'Found `.package(` but no readable URLs. Paste the full dependencies array.' }
  }

  return {
    source: 'Package.swift',
    detail: `${dependencies.length} ${plural(dependencies.length, 'dependency', 'dependencies')}`,
    dependencies,
  }
}

/** Scans for `.package(` and returns each call's balanced argument list. */
function extractPackageCalls(text: string): string[] {
  const calls: string[] = []
  const needle = '.package('
  let cursor = 0

  while (cursor < text.length) {
    const start = text.indexOf(needle, cursor)
    if (start === -1) break

    let depth = 0
    let inString = false
    let i = start + needle.length - 1

    for (; i < text.length; i++) {
      const ch = text[i]
      if (inString) {
        if (ch === '\\') i++
        else if (ch === '"') inString = false
        continue
      }
      if (ch === '"') inString = true
      else if (ch === '(') depth++
      else if (ch === ')') {
        depth--
        if (depth === 0) break
      }
    }

    calls.push(text.slice(start + needle.length, i))
    cursor = i + 1
  }
  return calls
}

const VERSION = String.raw`Version\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)`
const VERSION_RANGE = new RegExp(`${VERSION}\\s*\\.\\.([.<])\\s*${VERSION}`)

function readRequirement(call: string): Requirement {
  const exact = /\bexact\s*:\s*"([^"]+)"/.exec(call) ?? /\.exact\s*\(\s*"([^"]+)"/.exec(call)
  if (exact) return { kind: 'exact', version: exact[1] }

  const minor = /\.upToNextMinor\s*\(\s*from\s*:\s*"([^"]+)"/.exec(call)
  if (minor) return { kind: 'upToNextMinor', version: minor[1] }

  const major = /\.upToNextMajor\s*\(\s*from\s*:\s*"([^"]+)"/.exec(call)
  if (major) return { kind: 'from', version: major[1] }

  const range = /"([^"]+)"\s*\.\.([.<])\s*"([^"]+)"/.exec(call)
  if (range) return { kind: 'range', lower: range[1], upper: range[3], closed: range[2] === '.' }

  // `Version(1,2,3)..<Version(2,0,0)` — the struct form of the same range.
  const structRange = VERSION_RANGE.exec(call)
  if (structRange) {
    const [, a, b, c, op, d, e, f] = structRange
    return {
      kind: 'range',
      lower: `${a}.${b}.${c}`,
      upper: `${d}.${e}.${f}`,
      closed: op === '.',
    }
  }

  const structFrom = /\bfrom\s*:\s*Version\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/.exec(call)
  if (structFrom) {
    return { kind: 'from', version: `${structFrom[1]}.${structFrom[2]}.${structFrom[3]}` }
  }

  const from = /\bfrom\s*:\s*"([^"]+)"/.exec(call)
  if (from) return { kind: 'from', version: from[1] }

  const branch = /\bbranch\s*:\s*"([^"]+)"/.exec(call) ?? /\.branch\s*\(\s*"([^"]+)"/.exec(call)
  if (branch) return { kind: 'branch', name: branch[1] }

  const revision = /\brevision\s*:\s*"([^"]+)"/.exec(call) ?? /\.revision\s*\(\s*"([^"]+)"/.exec(call)
  if (revision) return { kind: 'revision', sha: revision[1] }

  return { kind: 'none' }
}

/* ------------------------------------------------------------------ url list */

function parseUrlList(text: string): ParseResult {
  const dependencies: Dependency[] = []
  text.split(/\s+/).forEach((token) => {
    const { owner, repo } = parseGitHub(token)
    if (!owner || !repo) return
    dependencies.push({
      order: dependencies.length + 1,
      identity: repo,
      location: token,
      owner,
      repo,
      requirement: { kind: 'none' },
      supported: true,
    })
  })

  if (!dependencies.length) return EMPTY
  return {
    source: 'URL list',
    detail: `${dependencies.length} ${plural(dependencies.length, 'repository', 'repositories')}`,
    dependencies,
  }
}

/* -------------------------------------------------------------------- helpers */

export function parseGitHub(location: string): { owner?: string; repo?: string } {
  const cleaned = location.trim().replace(/\.git$/, '').replace(/\/+$/, '')
  const https = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s]+)/i.exec(cleaned)
  if (https) return { owner: https[1], repo: https[2] }
  const ssh = /^git@github\.com:([^/\s]+)\/([^/\s]+)/i.exec(cleaned)
  if (ssh) return { owner: ssh[1], repo: ssh[2] }
  return {}
}

function repoNameFrom(location: string): string | undefined {
  const cleaned = location.trim().replace(/\.git$/, '').replace(/\/+$/, '')
  const last = cleaned.split(/[/:]/).pop()
  return last || undefined
}

function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many
}

export function requirementLabel(requirement: Requirement): string | null {
  switch (requirement.kind) {
    case 'resolved':
      return null
    case 'exact':
      return `exact ${requirement.version}`
    case 'from':
      return `from ${requirement.version}`
    case 'upToNextMinor':
      return `~> ${requirement.version}`
    case 'range':
      return `${requirement.lower} ..${requirement.closed ? '.' : '<'} ${requirement.upper}`
    case 'branch':
      return `branch ${requirement.name}`
    case 'revision':
      return `rev ${requirement.sha.slice(0, 7)}`
    default:
      return null
  }
}

/** The version to measure drift against, when the manifest states one. */
export function baselineVersion(dependency: Dependency): string | undefined {
  if (dependency.pinned) return dependency.pinned
  const r = dependency.requirement
  if (r.kind === 'exact' || r.kind === 'from' || r.kind === 'upToNextMinor') return r.version
  if (r.kind === 'range') return r.lower
  return undefined
}

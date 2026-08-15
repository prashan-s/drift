import { normalizeRepository } from './repository'
import type { ManifestDependency } from './types'

/**
 * Extracts the package-level dependencies declared in a `Package.swift`.
 *
 * This is a text scan, not a Swift evaluator — running the manifest is the only
 * way to be exhaustive, and we are not going to execute untrusted input. The
 * scan covers the literal `.package(url:)` / `.package(path:)` / `.package(id:)`
 * forms that SwiftPM's own documentation uses and that essentially every real
 * manifest is written in.
 *
 * Two deliberate limitations, surfaced in the UI rather than hidden:
 *   - a URL built from a variable or `#if` branch is invisible to us;
 *   - `.product(name:package:)` inside targets is ignored, because it names a
 *     product of an already-declared package rather than a new dependency.
 */
export function parseManifestDependencies(source: string): ManifestDependency[] {
  const code = stripComments(source)
  const dependencies: ManifestDependency[] = []
  const seen = new Set<string>()

  for (const call of extractPackageCalls(code)) {
    const location =
      capture(call, /\burl\s*:\s*"((?:[^"\\]|\\.)*)"/) ??
      capture(call, /\blocation\s*:\s*"((?:[^"\\]|\\.)*)"/)
    if (!location) continue

    const repository = normalizeRepository(location)
    const key = repository.url ?? location
    if (seen.has(key)) continue
    seen.add(key)

    dependencies.push({ repository, requirement: readRequirement(call) })
  }

  return dependencies
}

/** Returns the balanced argument text of every `.package(` call in `code`. */
function extractPackageCalls(code: string): string[] {
  const calls: string[] = []
  const needle = '.package('
  let cursor = 0

  while (cursor < code.length) {
    const start = code.indexOf(needle, cursor)
    if (start === -1) break

    const open = start + needle.length - 1
    let depth = 0
    let inString = false
    let i = open

    for (; i < code.length; i++) {
      const ch = code[i]
      if (inString) {
        if (ch === '\\') i++
        else if (ch === '"') inString = false
        continue
      }
      if (ch === '"') inString = true
      else if (ch === '(') depth++
      else if (ch === ')' && --depth === 0) break
    }

    // An unbalanced call means a truncated file; stop rather than guess.
    if (depth !== 0) break
    calls.push(code.slice(open + 1, i))
    cursor = i + 1
  }
  return calls
}

/** Verbatim requirement text for display. Never used to draw edges. */
function readRequirement(call: string): string | undefined {
  const exact =
    capture(call, /\bexact\s*:\s*"([^"]+)"/) ?? capture(call, /\.exact\s*\(\s*"([^"]+)"/)
  if (exact) return `exact ${exact}`

  const minor = capture(call, /\.upToNextMinor\s*\(\s*from\s*:\s*"([^"]+)"/)
  if (minor) return `~> ${minor}`

  const major = capture(call, /\.upToNextMajor\s*\(\s*from\s*:\s*"([^"]+)"/)
  if (major) return `from ${major}`

  const range = /"([^"]+)"\s*\.\.([.<])\s*"([^"]+)"/.exec(call)
  if (range) return `${range[1]} ..${range[2] === '.' ? '.' : '<'} ${range[3]}`

  // `Version(1,2,3)..<Version(2,0,0)` — the struct form of the same range.
  const structRange = VERSION_RANGE.exec(call)
  if (structRange) {
    const [, a, b, c, op, d, e, f] = structRange
    return `${a}.${b}.${c} ..${op === '.' ? '.' : '<'} ${d}.${e}.${f}`
  }

  const structFrom = /\b(?:from|exact)\s*:\s*Version\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/.exec(call)
  if (structFrom) return `from ${structFrom[1]}.${structFrom[2]}.${structFrom[3]}`

  const from = capture(call, /\bfrom\s*:\s*"([^"]+)"/)
  if (from) return `from ${from}`

  const branch =
    capture(call, /\bbranch\s*:\s*"([^"]+)"/) ?? capture(call, /\.branch\s*\(\s*"([^"]+)"/)
  if (branch) return `branch ${branch}`

  const revision =
    capture(call, /\brevision\s*:\s*"([^"]+)"/) ?? capture(call, /\.revision\s*\(\s*"([^"]+)"/)
  if (revision) return `rev ${revision.slice(0, 7)}`

  return undefined
}

const VERSION = String.raw`Version\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)`
const VERSION_RANGE = new RegExp(`${VERSION}\\s*\\.\\.([.<])\\s*${VERSION}`)

function capture(text: string, pattern: RegExp): string | undefined {
  return pattern.exec(text)?.[1]
}

/**
 * Blanks out `//` and block comments so a commented-out `.package(…)` never
 * becomes an edge. Replaces with spaces rather than deleting, so any offsets a
 * future caller computes still line up with the original text.
 */
function stripComments(source: string): string {
  let out = ''
  let i = 0
  let inString = false
  let inRawString = false

  while (i < source.length) {
    const ch = source[i]
    const next = source[i + 1]

    if (inString || inRawString) {
      out += ch
      if (!inRawString && ch === '\\') {
        out += next ?? ''
        i += 2
        continue
      }
      if (ch === '"') {
        if (inRawString && source[i + 1] === '#') {
          out += '#'
          i += 2
          inRawString = false
          continue
        }
        if (!inRawString) inString = false
      }
      i++
      continue
    }

    if (ch === '#' && next === '"') {
      inRawString = true
      out += '#"'
      i += 2
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
      i++
      continue
    }
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') {
        out += ' '
        i++
      }
      continue
    }
    if (ch === '/' && next === '*') {
      let depth = 1
      out += '  '
      i += 2
      while (i < source.length && depth > 0) {
        if (source[i] === '/' && source[i + 1] === '*') {
          depth++
          out += '  '
          i += 2
        } else if (source[i] === '*' && source[i + 1] === '/') {
          depth--
          out += '  '
          i += 2
        } else {
          out += source[i] === '\n' ? '\n' : ' '
          i++
        }
      }
      continue
    }

    out += ch
    i++
  }

  return out
}

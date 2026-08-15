import { describe, expect, test } from 'bun:test'
import { analyzeWithoutNetwork } from '../analysis'
import { buildGraph } from '../core/graph'
import { analyze } from '../core/issues'
import { parseResolved } from '../core/resolved'
import { describeGraph } from '../core/text'
import { assertAllowed, GitHubError } from '../github/client'
import { orgSet } from '../core/repository'

const ORGS = orgSet(['bhashacode'])

const RESOLVED = JSON.stringify({
  version: 2,
  pins: [
    {
      identity: 'a',
      location: 'https://github.com/bhashacode/A.git',
      state: { version: '1.0.0', revision: 'aaa' },
    },
    {
      identity: 'b',
      location: 'https://github.com/bhashacode/B.git',
      state: { branch: 'develop', revision: 'bbb' },
    },
    {
      identity: 'c',
      location: 'https://github.com/bhashacode/C.git',
      state: { revision: 'ccc' },
    },
    {
      identity: 'alamofire',
      location: 'https://github.com/Alamofire/Alamofire.git',
      state: { version: '5.10.2' },
    },
    { identity: 'local', location: '/Users/dev/Local', state: { version: '1.0.0' } },
  ],
})

describe('findings', () => {
  const resolved = parseResolved(RESOLVED)
  const findings = analyze(buildGraph(resolved, new Map(), ORGS), resolved)
  const byId = (id: string) => findings.find((f) => f.id === id)

  test('branch pins are a note, not an error', () => {
    expect(byId('branch-pin')).toMatchObject({ severity: 'note', subjects: ['b'] })
  })

  test('bare revision pins are a note', () => {
    expect(byId('revision-pin')).toMatchObject({ severity: 'note', subjects: ['c'] })
  })

  test('missing manifests are a warning, and name every affected package', () => {
    expect(byId('manifest-missing')).toMatchObject({ severity: 'warning', subjects: ['a', 'b', 'c'] })
  })

  test('a non-GitHub location is reported rather than silently ignored', () => {
    expect(byId('non-github')?.detail).toContain('local')
  })

  test('third-party packages produce no finding of their own', () => {
    expect(findings.some((f) => f.subjects.includes('alamofire'))).toBe(false)
  })

  test('errors sort above warnings, warnings above notes', () => {
    const rank = { error: 0, warning: 1, note: 2 } as const
    const order = findings.map((f) => rank[f.severity])
    expect(order).toEqual([...order].sort((x, y) => x - y))
  })
})

describe('analyzeWithoutNetwork', () => {
  const analysis = analyzeWithoutNetwork(parseResolved(RESOLVED), ORGS)

  test('produces nodes but declines to produce edges', () => {
    expect(analysis.graph.nodes.map((n) => n.identity)).toEqual(['a', 'b', 'c'])
    expect(analysis.graph.edges).toEqual([])
    expect(analysis.edgesUnavailable).toBe(true)
  })

  test('says why, in terms a developer can act on', () => {
    const node = analysis.graph.nodes[0]
    expect(node.manifest.kind).toBe('unavailable')
    expect(node.manifest.kind === 'unavailable' && node.manifest.remedy).toContain(
      'who depends on whom',
    )
  })
})

describe('textual alternative', () => {
  const analysis = analyzeWithoutNetwork(parseResolved(RESOLVED), ORGS)

  test('lists every node, with its version and its lack of known edges', () => {
    const text = describeGraph(analysis.graph)
    expect(text).toContain('A 1.0.0')
    expect(text).toContain('branch develop')
    expect(text).toContain('dependencies are unknown')
  })

  test('renders edges as prose when they exist', () => {
    const resolved = parseResolved(RESOLVED)
    const graph = buildGraph(
      resolved,
      new Map([
        [
          'a',
          {
            kind: 'exact',
            ref: 'aaa',
            dependencies: [
              { repository: { raw: '', host: 'github', owner: 'bhashacode', name: 'B', ownerKey: 'bhashacode', url: 'https://github.com/bhashacode/B' } },
            ],
          },
        ],
      ]),
      ORGS,
    )
    expect(describeGraph(graph)).toContain('depends on B')
  })
})

describe('request allow-list', () => {
  test('permits reads of internal repositories', () => {
    expect(assertAllowed('/repos/bhashacode/A/tags', ORGS)).toBe(
      'https://api.github.com/repos/bhashacode/A/tags',
    )
  })

  test('permits an owner in any casing', () => {
    expect(() => assertAllowed('/repos/BhashaCode/A/releases', ORGS)).not.toThrow()
  })

  test('the allow-list follows the configured organisations', () => {
    const orgs = orgSet(['apple', 'realm'])
    expect(() => assertAllowed('/repos/apple/swift-log/tags', orgs)).not.toThrow()
    expect(() => assertAllowed('/repos/Realm/realm-swift/tags', orgs)).not.toThrow()
    // Reconfiguring must move the guard, not widen it.
    expect(() => assertAllowed('/repos/bhashacode/A/tags', orgs)).toThrow(GitHubError)
  })

  test('traversal is still rejected under a custom configuration', () => {
    expect(() => assertAllowed('/repos/../orgs/apple/repos', orgSet(['apple']))).toThrow(
      GitHubError,
    )
  })

  test.each([
    '/repos/Alamofire/Alamofire/tags',
    '/repos/bhashacodex/A/tags',
    '/users/bhashacode',
    '/orgs/bhashacode/repos',
    'https://evil.example/repos/bhashacode/A',
    '//evil.example/repos/bhashacode/A',
    '/repos/../orgs/bhashacode/repos',
  ])('refuses %p', (path) => {
    expect(() => assertAllowed(path, ORGS)).toThrow(GitHubError)
  })

  test('with nothing configured, nothing is permitted', () => {
    expect(() => assertAllowed('/repos/bhashacode/A/tags', orgSet([]))).toThrow(GitHubError)
  })
})

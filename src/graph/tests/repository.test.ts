import { describe, expect, test } from 'bun:test'
import { identityFor, isInternal, normalizeRepository, orgSet } from '../core/repository'

const ORGS = orgSet(['bhashacode'])

describe('normalizeRepository', () => {
  const canonical = 'https://github.com/bhashacode/swift-spm-bhasha-connectivity'

  test.each([
    'https://github.com/bhashacode/swift-spm-bhasha-connectivity.git',
    'https://github.com/bhashacode/swift-spm-bhasha-connectivity',
    'https://github.com/bhashacode/swift-spm-bhasha-connectivity/',
    'http://github.com/bhashacode/swift-spm-bhasha-connectivity.git',
    'https://www.github.com/bhashacode/swift-spm-bhasha-connectivity',
    'github.com/bhashacode/swift-spm-bhasha-connectivity',
    'git@github.com:bhashacode/swift-spm-bhasha-connectivity.git',
    'git@github.com:bhashacode/swift-spm-bhasha-connectivity',
    'ssh://git@github.com/bhashacode/swift-spm-bhasha-connectivity.git',
    'git+https://github.com/bhashacode/swift-spm-bhasha-connectivity.git',
    '  https://github.com/bhashacode/swift-spm-bhasha-connectivity.git  ',
  ])('%s normalises to the canonical URL', (input) => {
    const repository = normalizeRepository(input)
    expect(repository.host).toBe('github')
    expect(repository.url).toBe(canonical)
    expect(repository.owner).toBe('bhashacode')
    expect(repository.name).toBe('swift-spm-bhasha-connectivity')
    expect(repository.raw).toBe(input)
  })

  test('preserves owner casing but compares on the lowercased key', () => {
    const repository = normalizeRepository('https://github.com/BhashaCode/MyPackage.git')
    expect(repository.owner).toBe('BhashaCode')
    expect(repository.ownerKey).toBe('bhashacode')
    expect(repository.name).toBe('MyPackage')
  })

  test('strips only a trailing .git, not one inside the name', () => {
    expect(normalizeRepository('https://github.com/x/my.git.tools.git').name).toBe('my.git.tools')
  })

  test('ignores query strings and fragments', () => {
    expect(normalizeRepository('https://github.com/x/repo?tab=readme#top').name).toBe('repo')
  })

  test.each([
    '',
    '   ',
    'not a url',
    'https://gitlab.com/bhashacode/thing.git',
    'https://github.example.com/bhashacode/thing',
    'https://notgithub.com/bhashacode/thing',
    'https://github.com/bhashacode',
    'https://github.com/bhashacode/',
    '/Users/dev/local/MyPackage',
    'file:///Users/dev/local/MyPackage',
  ])('%p is not a GitHub repository', (input) => {
    const repository = normalizeRepository(input)
    expect(repository.host).toBe('other')
    expect(repository.owner).toBeUndefined()
    expect(isInternal(repository, ORGS)).toBe(false)
  })
})

describe('isInternal', () => {
  test.each([
    'https://github.com/bhashacode/swift-spm-token-manager.git',
    'https://github.com/BHASHACODE/swift-spm-token-manager',
    'git@github.com:BhashaCode/swift-spm-token-manager.git',
  ])('%s belongs to the organisation', (input) => {
    expect(isInternal(normalizeRepository(input), ORGS)).toBe(true)
  })

  test.each([
    // Similarly named organisations must not match.
    'https://github.com/bhashacodex/thing.git',
    'https://github.com/bhasha-code/thing.git',
    'https://github.com/bhashacode-labs/thing.git',
    'https://github.com/notbhashacode/thing.git',
    'https://github.com/bhasha/thing.git',
    // Third-party organisations from the brief.
    'https://github.com/apple/swift-log.git',
    'https://github.com/realm/realm-swift.git',
    'https://github.com/Alamofire/Alamofire.git',
    'https://github.com/pointfreeco/swift-composable-architecture',
    'https://github.com/emqx/CocoaMQTT.git',
  ])('%s does not', (input) => {
    expect(isInternal(normalizeRepository(input), ORGS)).toBe(false)
  })

  test('an owner path segment cannot be smuggled in', () => {
    expect(isInternal(normalizeRepository('https://github.com/evil/bhashacode/thing'), ORGS)).toBe(
      false,
    )
  })
})

describe('identityFor', () => {
  test('matches SwiftPM: the repository name, lowercased', () => {
    expect(identityFor(normalizeRepository('https://github.com/bhashacode/MyPackage.git'))).toBe(
      'mypackage',
    )
  })

  test('is undefined for non-GitHub locations', () => {
    expect(identityFor(normalizeRepository('/local/path'))).toBeUndefined()
  })
})

describe('configurable organisations', () => {
  const gh = (owner: string) => normalizeRepository(`https://github.com/${owner}/Pkg.git`)

  test('an empty configuration stays empty — no built-in name is substituted', () => {
    expect([...orgSet([])]).toEqual([])
    expect([...orgSet(['   '])]).toEqual([])
  })

  test('nothing is internal when nothing is configured', () => {
    expect(isInternal(gh('bhashacode'), orgSet([]))).toBe(false)
    expect(isInternal(gh('apple'), orgSet([]))).toBe(false)
  })

  test('names are lowercased, trimmed and de-duplicated', () => {
    expect([...orgSet([' Apple ', 'apple', 'REALM'])].sort()).toEqual(['apple', 'realm'])
  })

  test('membership follows the configured set only', () => {
    const orgs = orgSet(['apple', 'realm'])
    expect(isInternal(gh('apple'), orgs)).toBe(true)
    expect(isInternal(gh('Realm'), orgs)).toBe(true)
    // No built-in name survives a configuration that does not list it.
    expect(isInternal(gh('bhashacode'), orgs)).toBe(false)
  })

  test('look-alike organisations stay excluded whatever the configuration', () => {
    const orgs = orgSet(['apple'])
    for (const owner of ['applet', 'apple-inc', 'notapple', 'my-apple']) {
      expect(isInternal(gh(owner), orgs)).toBe(false)
    }
  })

  test('a non-GitHub location is never internal', () => {
    expect(isInternal(normalizeRepository('/local/path'), orgSet(['apple']))).toBe(false)
  })
})

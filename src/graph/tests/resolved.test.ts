import { describe, expect, test } from 'bun:test'
import { MAX_INPUT_BYTES, ResolvedParseError, parseResolved, pinLabel, pinnedRef } from '../core/resolved'

const V1 = JSON.stringify({
  object: {
    pins: [
      {
        package: 'Alamofire',
        repositoryURL: 'https://github.com/Alamofire/Alamofire.git',
        state: { branch: null, revision: '513364f8', version: '5.10.2' },
      },
      {
        package: 'BhashaConnectivity',
        repositoryURL: 'git@github.com:bhashacode/swift-spm-bhasha-connectivity.git',
        state: { branch: null, revision: '12d6f026', version: '1.4.0' },
      },
    ],
  },
  version: 1,
})

const V2 = JSON.stringify({
  pins: [
    {
      identity: 'swift-spm-bhasha-connectivity',
      kind: 'remoteSourceControl',
      location: 'https://github.com/bhashacode/swift-spm-bhasha-connectivity.git',
      state: { revision: '12d6f026', version: '1.4.0' },
    },
    {
      identity: 'swift-spm-token-manager',
      kind: 'remoteSourceControl',
      location: 'https://github.com/bhashacode/swift-spm-token-manager.git',
      state: { branch: 'main', revision: 'aaaabbbb' },
    },
    {
      identity: 'swift-spm-webrtckit-core',
      kind: 'remoteSourceControl',
      location: 'https://github.com/bhashacode/swift-spm-webrtckit-core.git',
      state: { revision: 'ccccdddd' },
    },
  ],
  version: 2,
})

const V3 = JSON.stringify({
  originHash: 'f1a2b3',
  pins: [
    {
      identity: 'swift-spm-helago-contracts',
      kind: 'remoteSourceControl',
      location: 'https://github.com/bhashacode/swift-spm-helago-contracts.git',
      state: { revision: 'eeeeffff', version: '1.2.7' },
    },
  ],
  version: 3,
})

describe('schema variants', () => {
  test('v1 reads object.pins, package and repositoryURL', () => {
    const file = parseResolved(V1)
    expect(file.schemaVersion).toBe(1)
    expect(file.packages).toHaveLength(2)
    // v1 has no identity field; it is derived from the repository name.
    expect(file.packages[0].identity).toBe('alamofire')
    expect(file.packages[0].displayName).toBe('Alamofire')
    expect(file.packages[1].identity).toBe('swift-spm-bhasha-connectivity')
    expect(file.packages[1].repository.owner).toBe('bhashacode')
  })

  test('v2 reads top-level pins, identity and location', () => {
    const file = parseResolved(V2)
    expect(file.schemaVersion).toBe(2)
    expect(file.packages.map((p) => p.identity)).toEqual([
      'swift-spm-bhasha-connectivity',
      'swift-spm-token-manager',
      'swift-spm-webrtckit-core',
    ])
  })

  test('v3 parses despite the added originHash', () => {
    const file = parseResolved(V3)
    expect(file.schemaVersion).toBe(3)
    expect(file.packages[0].state).toEqual({ kind: 'version', version: '1.2.7', revision: 'eeeeffff' })
  })

  test('an unknown future version still parses when the pin shape holds', () => {
    const file = parseResolved(V3.replace('"version" : 3', '"version": 4').replace('"version":3', '"version":4'))
    expect(file.packages).toHaveLength(1)
  })
})

describe('pin states', () => {
  test('semantic version pin', () => {
    const [pin] = parseResolved(V3).packages
    expect(pin.state).toMatchObject({ kind: 'version', version: '1.2.7' })
    expect(pinLabel(pin.state)).toBe('1.2.7')
    expect(pinnedRef(pin.state)).toEqual({ ref: 'eeeeffff', exact: true })
  })

  test('branch pin', () => {
    const pin = parseResolved(V2).packages[1]
    expect(pin.state).toMatchObject({ kind: 'branch', branch: 'main' })
    expect(pinLabel(pin.state)).toBe('branch main')
  })

  test('revision-only pin', () => {
    const pin = parseResolved(V2).packages[2]
    expect(pin.state).toEqual({ kind: 'revision', revision: 'ccccdddd' })
    expect(pinLabel(pin.state)).toBe('rev ccccddd')
  })

  test('missing or null state becomes unpinned', () => {
    const file = parseResolved(
      JSON.stringify({ version: 2, pins: [{ identity: 'a', location: 'https://github.com/x/a' }] }),
    )
    expect(file.packages[0].state).toEqual({ kind: 'unpinned' })
    expect(pinnedRef(file.packages[0].state)).toBeUndefined()
  })

  test('a v1 null branch does not become a branch pin', () => {
    expect(parseResolved(V1).packages[0].state.kind).toBe('version')
  })
})

describe('duplicates and empties', () => {
  test('empty pins array parses to zero packages, not an error', () => {
    const file = parseResolved('{"pins": [], "version": 2}')
    expect(file.packages).toEqual([])
    expect(file.duplicateIdentities).toEqual([])
  })

  test('duplicate identities are reported, first pin wins', () => {
    const file = parseResolved(
      JSON.stringify({
        version: 2,
        pins: [
          { identity: 'dup', location: 'https://github.com/bhashacode/A.git', state: { version: '1.0.0' } },
          { identity: 'dup', location: 'https://github.com/bhashacode/B.git', state: { version: '2.0.0' } },
        ],
      }),
    )
    expect(file.duplicateIdentities).toEqual(['dup'])
    expect(file.packages).toHaveLength(2)
  })

  test('identity comparison is case-insensitive', () => {
    const file = parseResolved(
      JSON.stringify({
        version: 2,
        pins: [
          { identity: 'Dup', location: 'https://github.com/bhashacode/A.git' },
          { identity: 'dup', location: 'https://github.com/bhashacode/A.git' },
        ],
      }),
    )
    expect(file.duplicateIdentities).toEqual(['dup'])
  })

  test('non-object entries in pins are skipped rather than crashing', () => {
    const file = parseResolved('{"version":2,"pins":[null,42,"x",{"identity":"a","location":"https://github.com/bhashacode/a"}]}')
    expect(file.packages).toHaveLength(1)
  })
})

describe('malformed input', () => {
  const cases: Array<[string, string]> = [
    ['', 'empty'],
    ['{"pins": [', 'truncated JSON'],
    ['[]', 'array root'],
    ['"a string"', 'string root'],
    ['{"version": 2}', 'no pins array'],
    ['{"pins": {}}', 'pins is not an array'],
  ]

  test.each(cases)('%p is rejected (%s)', (input) => {
    expect(() => parseResolved(input)).toThrow(ResolvedParseError)
  })

  test('errors carry an actionable remedy', () => {
    try {
      parseResolved('{"version": 2}')
      throw new Error('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ResolvedParseError)
      expect((error as ResolvedParseError).remedy).toContain('object.pins')
    }
  })

  test('a Package.swift is called out by name', () => {
    try {
      parseResolved('import PackageDescription\nlet package = Package(name: "X")')
      throw new Error('should have thrown')
    } catch (error) {
      expect((error as ResolvedParseError).remedy).toContain('Package.resolved')
    }
  })

  test('oversized input is rejected before parsing', () => {
    const huge = `{"pins":[],"version":2,"pad":"${'x'.repeat(MAX_INPUT_BYTES)}"}`
    expect(() => parseResolved(huge)).toThrow(/larger than/)
  })
})

import { describe, expect, test } from 'bun:test'
import { InputParseError, parseInput } from '../core/input'
import { isInternal, orgSet } from '../core/repository'

const ORGS = orgSet(['bhashacode'])

const RESOLVED = JSON.stringify({
  version: 3,
  pins: [
    {
      identity: 'swift-spm-helago-contracts',
      location: 'https://github.com/bhashacode/swift-spm-helago-contracts.git',
      state: { version: '1.2.7', revision: 'abc123' },
    },
  ],
})

/** Shaped after the real bhashacode manifests, which live at the repo root. */
const MANIFEST = `// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "BhashaCallKitCore",
    dependencies: [
        .package(url: "https://github.com/stasel/WebRTC.git", from: "124.0.0"),
        .package(url: "https://github.com/bhashacode/swift-spm-bhasha-connectivity.git", from: "1.3.1"),
        .package(url: "https://github.com/bhashacode/swift-spm-webrtckit-core.git", from: "1.0.7"),
        .package(url: "https://github.com/bhashacode/swift-spm-token-manager.git", from: "2.3.0"),
    ]
)`

describe('format detection', () => {
  test('JSON is read as a Package.resolved', () => {
    const file = parseInput(RESOLVED)
    expect(file.schemaVersion).toBe(3)
    expect(file.packages[0].state).toMatchObject({ kind: 'version', version: '1.2.7' })
  })

  test('a .package( declaration is read as a Package.swift', () => {
    const file = parseInput(MANIFEST)
    expect(file.schemaVersion).toBe(0)
    expect(file.packages.map((p) => p.repository.name)).toEqual([
      'WebRTC',
      'swift-spm-bhasha-connectivity',
      'swift-spm-webrtckit-core',
      'swift-spm-token-manager',
    ])
  })

  test('leading whitespace and a comment header do not confuse detection', () => {
    expect(() => parseInput(`\n\n${MANIFEST}`)).not.toThrow()
    expect(() => parseInput(`  \n${RESOLVED}`)).not.toThrow()
  })
})

describe('a manifest states requirements, not resolutions', () => {
  const file = parseInput(MANIFEST)

  test('every package comes back unpinned', () => {
    // `from: "1.3.1"` is a floor, not the version that resolved. Recording it
    // as a pin would put a version in the UI that the file never stated.
    expect(file.packages.every((p) => p.state.kind === 'unpinned')).toBe(true)
  })

  test('identities follow SwiftPM: the repository name, lowercased', () => {
    expect(file.packages.map((p) => p.identity)).toContain('swift-spm-webrtckit-core')
    expect(file.packages.map((p) => p.identity)).toContain('webrtc')
  })

  test('third-party declarations survive parsing but are not internal', () => {
    const webrtc = file.packages.find((p) => p.identity === 'webrtc')!
    expect(isInternal(webrtc.repository, ORGS)).toBe(false)
    expect(file.packages.filter((p) => isInternal(p.repository, ORGS))).toHaveLength(3)
  })
})

describe('rejections carry a remedy', () => {
  test.each([
    ['', 'empty'],
    ['just some prose', 'neither format'],
    ['let package = Package(name: "X")', 'neither format either'],
    ['.package(path: "../Local")', 'only unfollowable dependencies'],
  ])('%p is rejected (%s)', (input) => {
    expect(() => parseInput(input)).toThrow(InputParseError)
  })

  test('an unrecognised input explains what each format looks like', () => {
    try {
      parseInput('hello')
      throw new Error('should have thrown')
    } catch (error) {
      expect((error as InputParseError).remedy).toContain('.package(')
    }
  })

  test('a manifest of only path/registry deps says why it cannot be used', () => {
    try {
      parseInput('.package(path: "../Local"), .package(id: "scope.name", from: "1.0.0")')
      throw new Error('should have thrown')
    } catch (error) {
      expect((error as InputParseError).message).toContain('no package dependencies')
    }
  })
})

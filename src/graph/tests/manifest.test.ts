import { describe, expect, test } from 'bun:test'
import { parseManifestDependencies } from '../core/manifest'

const MANIFEST = `// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "BhashaConnectivity",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "BhashaConnectivity", targets: ["BhashaConnectivity"]),
    ],
    dependencies: [
        .package(url: "https://github.com/bhashacode/swift-spm-helago-contracts.git", from: "1.2.0"),
        .package(url: "git@github.com:bhashacode/swift-spm-bhasha-mobilelogkit.git", exact: "1.1.1"),
        .package(url: "https://github.com/emqx/CocoaMQTT.git", .upToNextMajor(from: "2.1.0")),
        .package(url: "https://github.com/apple/swift-log.git", "1.0.0"..<"2.0.0"),
        // .package(url: "https://github.com/bhashacode/removed-package.git", from: "9.9.9"),
        .package(path: "../LocalThing"),
        .package(id: "scope.registry-package", from: "3.0.0"),
    ],
    targets: [
        .target(
            name: "BhashaConnectivity",
            dependencies: [
                .product(name: "HelagoContracts", package: "swift-spm-helago-contracts"),
            ]
        ),
    ]
)`

describe('parseManifestDependencies', () => {
  const dependencies = parseManifestDependencies(MANIFEST)

  test('reads every url-based declaration, and only those', () => {
    expect(dependencies.map((d) => d.repository.name)).toEqual([
      'swift-spm-helago-contracts',
      'swift-spm-bhasha-mobilelogkit',
      'CocoaMQTT',
      'swift-log',
    ])
  })

  test('ignores path and registry dependencies, which name no repository', () => {
    expect(dependencies.some((d) => d.repository.raw.includes('LocalThing'))).toBe(false)
    expect(dependencies.some((d) => d.repository.raw.includes('scope.registry'))).toBe(false)
  })

  test('a commented-out dependency never becomes an edge', () => {
    expect(dependencies.some((d) => d.repository.name === 'removed-package')).toBe(false)
  })

  test('does not mistake .product(package:) for a package declaration', () => {
    expect(dependencies).toHaveLength(4)
  })

  test.each([
    ['from: "1.2.0"', 'from 1.2.0'],
    ['exact: "1.1.1"', 'exact 1.1.1'],
    ['.upToNextMajor(from: "2.1.0")', 'from 2.1.0'],
    ['.upToNextMinor(from: "2.1.0")', '~> 2.1.0'],
    ['branch: "main"', 'branch main'],
    ['revision: "0123456789abcdef"', 'rev 0123456'],
    ['"1.0.0"..<"2.0.0"', '1.0.0 ..< 2.0.0'],
    ['"1.0.0"..."2.0.0"', '1.0.0 ... 2.0.0'],
    // Spacing around the range operator is a style choice, not a different form.
    ['"11.0.0" ..< "13.0.0"', '11.0.0 ..< 13.0.0'],
    ['"11.0.0"  ...  "13.0.0"', '11.0.0 ... 13.0.0'],
    ['Version(11,0,0)..<Version(13,0,0)', '11.0.0 ..< 13.0.0'],
    ['Version(1, 2, 3) ... Version(2, 0, 0)', '1.2.3 ... 2.0.0'],
    ['from: Version(1,2,3)', 'from 1.2.3'],
  ])('renders requirement %s as %s', (requirement, expected) => {
    const source = `.package(url: "https://github.com/bhashacode/a.git", ${requirement})`
    expect(parseManifestDependencies(source)[0].requirement).toBe(expected)
  })

  test('block comments, including nested ones, are stripped', () => {
    const source = `
      /* .package(url: "https://github.com/bhashacode/gone.git", from: "1.0.0")
         /* nested */
      */
      .package(url: "https://github.com/bhashacode/kept.git", from: "1.0.0")`
    expect(parseManifestDependencies(source).map((d) => d.repository.name)).toEqual(['kept'])
  })

  test('a URL containing // is not treated as a comment', () => {
    const source = '.package(url: "https://github.com/bhashacode/kept.git", from: "1.0.0")'
    expect(parseManifestDependencies(source)).toHaveLength(1)
  })

  test('the same repository declared twice yields one dependency', () => {
    const source = `
      .package(url: "https://github.com/bhashacode/a.git", from: "1.0.0")
      .package(url: "git@github.com:bhashacode/a.git", from: "2.0.0")`
    expect(parseManifestDependencies(source)).toHaveLength(1)
  })

  test('a range split across lines is still one range', () => {
    const source = `.package(
      url: "https://github.com/firebase/firebase-ios-sdk.git",
      "11.0.0"
        ..<
      "13.0.0"
    )`
    expect(parseManifestDependencies(source)[0].requirement).toBe('11.0.0 ..< 13.0.0')
  })

  test('a manifest with no dependencies yields none', () => {
    expect(parseManifestDependencies('let package = Package(name: "X")')).toEqual([])
  })

  test('a truncated call is dropped rather than half-read', () => {
    expect(parseManifestDependencies('.package(url: "https://github.com/bhashacode/a.git"')).toEqual(
      [],
    )
  })

  test('a non-GitHub url is kept but marked as another host', () => {
    const [dependency] = parseManifestDependencies(
      '.package(url: "https://gitlab.com/team/a.git", from: "1.0.0")',
    )
    expect(dependency.repository.host).toBe('other')
  })
})

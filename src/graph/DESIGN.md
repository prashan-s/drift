# Drift — design

One application, two views of the same repositories, sharing one GitHub token
and one manifest.

| View | Question | URL |
| --- | --- | --- |
| **Version audit** | How far behind is every pin? | `#/audit` |
| **Dependency graph** | Which internal package depends on which? | `#/graph` |

Entry: `index.html` → `src/main.tsx` → `src/Shell.tsx`.

---

## 1. Product design

The shell owns what neither view owns: the token, the API quota readout, the
manifest both views work from, and a release store either can populate. The two
views answer different questions about the *same* file, so pasting it twice
would be a bug rather than a feature. Both views stay mounted — a scan costs dozens of API
calls, and losing it by glancing at the graph would be the worst kind of
avoidable. The inactive one is `hidden` **and** `inert`, so it is out of the tab
order rather than merely invisible.

### The correctness constraint

`Package.resolved` is a lockfile: it records *which packages resolved and at
what versions*, not *which package asked for which*. A tool that draws
A → B → C from a flat pin list is inventing structure.

So edges come from exactly one source — each package's `Package.swift`, read
from the repository root at the revision the lockfile pinned — and when that
source is unreadable the tool draws nothing and says why.

### Trade-offs

| Decision | Cost | Why anyway |
| --- | --- | --- |
| Edges only from `Package.swift` | Needs `Contents: read` | The alternative is fabricating relationships |
| Text-scan the manifest | Misses URLs built from variables or `#if` | Evaluating a manifest means executing untrusted Swift |
| Lockfile-at-tag from repo root only | An app's `xcshareddata/swiftpm/…` is not found | Guessing project-specific paths is guessing |
| Both views share one shell layout | Neither gets a bespoke page | Switching tabs should not change what kind of thing the page is |
| Client-only, no server | Token lives in the browser | A backend secures nothing extra here |
| No layout animation | Less impressive | A stable picture is one you can learn to read |

The graph reports each package's newest release and how far behind the pin is —
the same comparison the audit makes, shown where you are already standing. The
selected package's third-party dependencies get the same treatment in the detail
drawer: they are still not graph nodes, but "what versions does *this* package
drag in" is a question you can only ask from a node.

---

## 2. Version audit

### Deferred history

A scan asks GitHub for **one release per dependency**, because drift is measured
against the newest release alone. The earlier two are fetched per package, only
when someone opens that row.

Measured against the live API:

| Repository | Initial (`per_page=10`, keep 1) | On demand (`per_page=100`, keep 3) |
| --- | --- | --- |
| `Alamofire/Alamofire` | **35 KB** | 358 KB |
| `bhashacode/swift-spm-bhasha-connectivity` | 21 KB | 41 KB |

Ten releases are requested to keep one. That is deliberate: GitHub returns
releases newest-first **by date**, so a patch backported onto an older major
would otherwise be reported as the latest version. Ten is enough to rank
honestly and still a tenth of the old payload on a busy repository.

The table therefore shows `# · Package · In manifest · Latest · Drift` and a
per-row **Earlier** disclosure. Two fewer columns dropped the table's minimum
width from 1020px to 840px, which is the difference between fitting a laptop and
not.

### Two bugs the live run exposed

1. **A permission 403 was reported as a rate limit.** `describe()` mapped every
   403 to "rate limit reached — add a token", which is the wrong advice for
   someone who already has a token and 4,900 calls left. Now only
   `x-ratelimit-remaining: 0` is a rate limit; a token that cannot reach an
   endpoint says so and names the scope.
2. **No tag fallback when Releases is forbidden.** A 403 on `/releases` threw
   instead of falling through to `/tags`, so private repositories reported an
   error while exposing perfectly readable tags. Both 403 and 404 now fall
   through.

---

## 3. Dependency graph

### Semantics

`A → B` means **A declares a dependency on B in its `Package.swift`**. Nodes are
`bhashacode` packages and nothing else.

| Confidence | Means | Drawn as |
| --- | --- | --- |
| `Verified` | Read at the exact revision the lockfile pinned | Solid line, filled arrowhead, badge |
| `Unknown` | Read at a different ref — a tag, or the default branch | Dashed line, open arrowhead, dashed badge |

No third state exists: `EdgeConfidence = 'verified' | 'unknown'`. An edge nobody's
manifest declared cannot be represented.

**Absence of an edge is not evidence of absence.** A package whose manifest could
not be read contributes no edges and is reported under "No manifest read for N
packages" — *missing, not absent*.

Cycles use Tarjan's SCC, iterative so a deep graph cannot overflow the stack, and
are errors because SwiftPM refuses to resolve one. Branch and revision pins are
notes, because teams ship that way on purpose.

### Verified against the live organisation

With `Contents: read` granted, a `Package.resolved` carrying real commit SHAs
produces:

```
VERIFIED  callkit-core -> bhasha-connectivity   [from 1.3.1] at b16711d7
VERIFIED  callkit-core -> token-manager         [from 2.3.0] at b16711d7
VERIFIED  callkit-core -> webrtckit-core        [from 1.0.7] at b16711d7
```

The same pins without revisions resolve the manifests at tags instead, and every
edge comes back `Unknown` — which is what is true of them.

### Input

Either file a Swift package keeps at its root:

- **`Package.resolved`** — schema v1, v2, v3, detected by shape rather than by
  declared version. Carries versions and revisions, so edges can be verified.
- **`Package.swift`** — carries requirements, not resolutions. Every package from
  one is therefore *unpinned*: `from: "1.3.1"` is a floor, not the version that
  resolved, and recording it as a pin would put a version on screen that the file
  never stated. Manifests are then read at the default branch and the edges are
  marked unknown.

Drop anywhere on the input panel or paste. Both views read one manifest, held by
the shell and persisted locally, so a reload does not cost you the paste.

Requirement forms cover `from:`, `exact:`, `.upToNextMajor`, `.upToNextMinor`,
`branch:`, `revision:`, string ranges in any spacing (`"11.0.0" ..< "13.0.0"`,
including split across lines) and the struct form
`Version(11,0,0)..<Version(13,0,0)`.

### The legend

A floating card in the canvas's top-right corner, closed by default and
remembered per browser. Toggled from the toolbar, dismissed by its own close
button.

`pointer-events: none` on the card is the load-bearing detail: it overlays the
diagram, so without it a node underneath would silently stop being clickable.
Only the close button opts back in — a click anywhere else on the card lands on
whatever is beneath it. Closed, the card is `visibility: hidden` as well as
transparent and its close button leaves the tab order, so nothing inside it is
focusable or announced.

Only `opacity` and `transform` animate — both composite-only, so the reveal
stays off the main thread, which matters because analysing a graph is exactly
when the main thread is busy. `prefers-reduced-motion` drops it.

### Copying

The detail tables and the external package list render to Markdown tables on
demand. Pipes inside a cell are escaped rather than silently breaking the table
someone is about to paste into a pull request.

### Layout

Longest-path layering over the DAG (back edges detected by DFS in sorted order
and marked, not deleted), then exactly two barycentre sweeps with identity as the
tie-break. No physics, no randomness: the same dependency set always produces
byte-identical coordinates, asserted by test.

---

## 3a. The local copy

One IndexedDB database holds the newest release seen per repository, the
manifest, and the organisation settings. Release lookups paint from it first and
revalidate against GitHub afterwards, so a reload shows last session's answer
immediately with **no network call at all**.

Which of the two you are looking at is never hidden. A restored value is marked
`cached`; when the network then disagrees, the old tag is kept and shown as
`was 5.4.0` rather than the number silently changing between visits.

The comparison lives in one place — `publishLatest` in the shell — so the audit
scan and the graph's revalidation produce the same diff. Everything in `db.ts`
degrades to a no-op: private browsing or a blocked upgrade costs a cache, not
the application.

**A bug this design walked into:** the "token changed, drop the cache" effect
originally used a *has this run before* flag. StrictMode invokes effects twice
on mount, so the second invocation read as a token change and wiped the cache on
every single load. It compares the token value now, which is idempotent.

## 3b. Organisations

There is no hardcoded organisation in the runtime path. `SEED_ORGS` is written
into IndexedDB on first run and never consulted again — a *seed*, not a
fallback. `orgSet()` substitutes nothing for an empty list, and `isInternal`,
`buildGraph`, `runAnalysis` and `assertAllowed` all take the set as a required
argument, so a built-in name cannot hide inside a default parameter. Emptying
the selection persists as empty across reloads, and with nothing configured the
request allow-list permits nothing.

Both views wait for the store: Scan and Analyse are disabled while hydrating,
because acting on an empty set would silently treat every package as external.


The audit's organisation filter sits directly above the table, because it
decides which rows the table has — a control that removes rows has no business
being hidden. It preselects your own organisation: where several configured
ones appear, the one contributing the most packages wins, since manifest order
would hand the choice to whichever happened to be listed first.

**The filter also scopes the scan.** A manifest of forty packages where you care
about five spends five API calls, not forty; the rest are fetched only if you
widen the filter. The preselection is therefore computed synchronously inside
`scan` rather than in an effect — an effect lands a tick later, by which time
the fetcher has already read an empty filter and asked for everything.

On the graph the same setting is multi-select and folded away by default: there
it is configuration, not a reading.


Which organisations count as internal is user configuration, stored in
IndexedDB and defaulting to `bhashacode`. `isInternal(repository, orgs)` takes
the set explicitly rather than reading a global — a pure function is the only
version that stays testable once the value can change. The same set is handed to
the GitHub client, so the SSRF allow-list *moves* with the configuration instead
of widening.

## 4. Architecture

```
src/
  main.tsx  Shell.tsx  styles.css
  lib/        github  parse  semver  sample  session  route
  components/ ResultsTable  drift
  tools/      Audit.tsx
  graph/
    Graph.tsx  analysis.ts  sample.ts
    core/     repository resolved manifest input graph layout issues text types
    github/   client packages
    ui/       GraphView Summary PackageDetails ExternalTable
    tests/    repository resolved manifest input graph issues render
```

`graph/core/` never imports from `graph/github/` or any UI. That one-way arrow is
why the interesting half is testable without a DOM or a network.

Hash routing is hand-rolled: two views and no nested state do not justify a
router, and the hash already gives linkable, refresh-surviving views.

---

## 5. Accessibility

- **The diagram is HTML.** Nodes are real `<button>` elements over an
  `aria-hidden` SVG that carries only edges. Buttons bring focus, activation and
  an accessible name for free.
- **Roving tabindex.** The graph is one tab stop; arrow keys then walk it
  *structurally* — ↓ to a dependency, ↑ to a dependent, ←/→ across the row.
- **Textual alternative.** The Text view and Copy carry the same facts as the
  diagram, including which edges are unverified.
- **Never colour alone.** Confidence is solid vs dashed stroke, filled vs open
  arrowhead, *and* a badge. Severity is a word before it is a colour. A filtered-
  out drift level is struck through, not just dimmed. Parse errors carry a `!`
  marker.
- Skip link; one `<h1>`; labels on every control; `role="alert"` for errors and
  `role="status"` for progress; 44px minimum touch targets; hover effects behind
  `(hover: hover) and (pointer: fine)`; 16px inputs so iOS does not zoom;
  `prefers-reduced-motion` honoured, with the loading pulse pinned solid rather
  than left at 40% opacity.
- Icons are Font Awesome, always beside a text label, always `aria-hidden`.
  `config.autoAddCss = false` stops its runtime `<style>` racing the bundle and
  flashing oversized glyphs on first paint.

---

## 6. Security

- **Untrusted input.** Parsed with `JSON.parse`, never evaluated.
  `Package.swift` is scanned as text — the main reason it is a scan and not an
  evaluator.
- **No SSRF surface.** `assertAllowed()` runs immediately before every `fetch`:
  origin must be `api.github.com`, the **normalised** pathname must start with
  `/repos/`, and the owner must be `bhashacode`. Unit-tested, including the
  `/repos/../orgs/…` traversal.
- **Release notes are never HTML.** Plain text in `<pre>`; no markdown pipeline,
  no `dangerouslySetInnerHTML` anywhere. GitHub error text is stripped of control
  characters and truncated.
- 4 MB input cap, 1 MB per API response body.
- Token sent only as `Authorization: Bearer` to `api.github.com`, kept in
  `localStorage`. Vite inlines `VITE_*` at build time, so a build made with
  `.env.local` set embeds the token in `dist/` — use the in-app field for
  anything hosted.

---

## 7. Performance

- One request per dependency on a scan; one more per package only when a row is
  opened. External packages are never fetched.
- `GitHubClient` caches by path and returns the in-flight promise, so duplicate
  concurrent requests collapse. Failures are not cached — a 403 a new token would
  fix must be retryable. Changing the token clears the cache.
- Graph, layout and text are memoised on the graph object: selecting a node,
  toggling views or zooming recomputes nothing.
- Zoom is one CSS `transform`; pan is native scroll. No re-layout per frame.

---

## 8. Testing

`bun test` — **152 tests**, no config, no extra runner dependency.

| File | Covers |
| --- | --- |
| `repository` | 11 URL forms → one canonical; casing; `.git`; invalid URLs; look-alike orgs; the third-party orgs from the brief |
| `resolved` | v1/v2/v3/future schemas; version, branch, revision, unpinned; empty pins; duplicate identities; six malformed inputs; size cap |
| `manifest` | URL/SSH declarations; eight requirement forms; `path:`/`id:` ignored; `.product(package:)` not mistaken for a package; commented-out deps; truncated calls |
| `input` | format detection; a manifest yields unpinned packages; identities; third parties excluded; rejections carry remedies |
| `graph` | internal-only nodes; **co-occurrence creates no edges**; verified vs unknown; transitive reach; orphans; unresolved packages; 2- and 3-cycles; diamond ≠ cycle; 3,000-node chain; determinism under shuffled input; no node overlap |
| `issues` | severity assignment; offline analysis; textual alternative; request allow-list |
| `render` | nodes are real buttons; one `tabindex=0`; edge SVG `aria-hidden`; text labels on toolbar buttons; confidence in stroke style; edgeless graph raises `role="alert"`; third-party names absent from the diagram |

Verified live against GitHub: the releases→tags fallback, the 403 permission
message, payload sizes per depth, verified edges from real commit SHAs, and the
Package.swift input path.

---

## 9. Status

`tsc -b` clean · `oxlint` clean · 152/152 tests · `bun run build` succeeds
(364 kB, 108 kB gzipped).

### Known limitations

1. **Manifest scanning is textual.** A dependency URL built from a variable or
   behind `#if` is invisible.
2. **Lockfile-at-tag reads the repository root only.**
3. **Release-to-release comparison is not implemented.** It needs two lockfiles.
   Rather than ship a comparison that silently compares nothing, the release
   loader reports exactly why it could not fetch.
4. **A pasted `Package.swift` has no root node.** The file does not state its own
   repository URL, so the root cannot be placed in an organisation. Its declared
   dependencies and their inter-relationships are shown instead.

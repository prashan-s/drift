/**
 * The local copy.
 *
 * One IndexedDB database holds two things: the newest release seen for each
 * repository, and the handful of settings that change what the tool considers
 * internal. Everything here degrades to a no-op rather than throwing — private
 * browsing, a disabled storage quota or a blocked upgrade must cost the user a
 * cache, not the application.
 */

const DB_NAME = 'drift'
const DB_VERSION = 1
const RELEASES = 'releases'
const SETTINGS = 'settings'

export interface CachedRelease {
  /** `owner/repo`, lowercased. */
  key: string
  tag: string
  date?: string
  url: string
  prerelease: boolean
  origin: 'releases' | 'tags'
  /** Epoch milliseconds this was written. */
  fetchedAt: number
}

let handle: Promise<IDBDatabase | null> | undefined

function open(): Promise<IDBDatabase | null> {
  if (handle) return handle

  handle = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null)

    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch {
      return resolve(null)
    }

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(RELEASES)) db.createObjectStore(RELEASES, { keyPath: 'key' })
      if (!db.objectStoreNames.contains(SETTINGS)) db.createObjectStore(SETTINGS)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
    // A concurrent tab holding an older version would otherwise hang forever.
    request.onblocked = () => resolve(null)
  })

  return handle
}

function run<T>(
  store: string,
  mode: IDBTransactionMode,
  body: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | undefined> {
  return open().then(
    (db) =>
      new Promise<T | undefined>((resolve) => {
        if (!db) return resolve(undefined)
        try {
          const tx = db.transaction(store, mode)
          const request = body(tx.objectStore(store))
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => resolve(undefined)
        } catch {
          resolve(undefined)
        }
      }),
  )
}

export async function readAllReleases(): Promise<CachedRelease[]> {
  const rows = await run<CachedRelease[]>(RELEASES, 'readonly', (s) => s.getAll())
  return rows ?? []
}

export async function writeRelease(entry: CachedRelease): Promise<void> {
  await run(RELEASES, 'readwrite', (s) => s.put(entry))
}

export async function clearReleases(): Promise<void> {
  await run(RELEASES, 'readwrite', (s) => s.clear())
}

export async function readSetting<T>(key: string): Promise<T | undefined> {
  return (await run<T>(SETTINGS, 'readonly', (s) => s.get(key))) ?? undefined
}

export async function writeSetting<T>(key: string, value: T): Promise<void> {
  await run(SETTINGS, 'readwrite', (s) => s.put(value, key))
}

export const SETTING_ORGS = 'internalOrgs'

/**
 * Written into settings the first time the app runs and never consulted again.
 *
 * It is a seed, not a fallback: once the store has a value — including one you
 * emptied — that value is the answer, and no built-in name overrides it.
 */
export const SEED_ORGS = ['bhashacode']
export const SETTING_MANIFEST = 'manifest'

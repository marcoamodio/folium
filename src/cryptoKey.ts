/**
 * Cryptographic key material — threat model & design
 * ----------------------------------------------------
 * Folium encrypts the canvas blob with AES-256-GCM in the browser. The attack
 * surface we care about most is **JavaScript readability**: any XSS, a hostile
 * extension, or another script in the origin can invoke Web Crypto and IndexedDB
 * APIs, so we avoid storing a **raw AES key** or **exportable** key in places
 * that are trivially scraped (e.g. localStorage).
 *
 * Approach:
 * - Persist only a random **32-byte seed** in IndexedDB (`keySeed` table).
 * - Derive the AES-GCM key with **PBKDF2** (SHA-256, high iteration count) using
 *   a **fixed app-level salt** (not secret — binds derivation to this app).
 * - The working `CryptoKey` is **not extractable**; we never export the AES key.
 *
 * This does **not** protect against full device compromise or an attacker who
 * can run arbitrary JS in the page: they can still derive the key the same way
 * the app does. It **does** remove the “steal base64 key from localStorage”
 * footgun and aligns storage with the encrypted payload (both in IndexedDB).
 *
 * Legacy: versions that stored `folium.encKey` in localStorage are migrated
 * once: decrypt with the old key, re-encrypt with a newly seeded PBKDF2 key,
 * then remove the localStorage entry.
 */

import { base64ToBytes, bytesToBase64, decrypt, encrypt } from './crypto'
import { CANVAS_ID, db, loadCanvasRow, KEY_SEED_ROW_ID } from './db'

/** @deprecated Removed after migration; cleared when present. */
const LEGACY_LOCALSTORAGE_KEY = 'folium.encKey'

/** Fixed, public salt — binds KDF output to Folium; not a secret. */
const PBKDF2_SALT = new TextEncoder().encode('folium.local-first.v1')

const PBKDF2_ITERATIONS = 210_000

let keyPromise: Promise<CryptoKey> | null = null

async function readSeedFromDb(): Promise<Uint8Array | undefined> {
  const row = await db.keySeed.get(KEY_SEED_ROW_ID)
  if (!row?.seedB64) return undefined
  try {
    const raw = new Uint8Array(base64ToBytes(row.seedB64))
    return raw.length === 32 ? raw : undefined
  } catch {
    return undefined
  }
}

async function saveSeedToDb(seed: Uint8Array): Promise<void> {
  await db.keySeed.put({
    id: KEY_SEED_ROW_ID,
    seedB64: bytesToBase64(seed),
  })
}

async function deriveAesKeyFromSeed(seed: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    seed.slice(),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey'],
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: PBKDF2_SALT,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/**
 * One-time transition from localStorage AES key → IndexedDB seed + PBKDF2.
 * Does not write a new seed until legacy decrypt succeeds (if ciphertext exists),
 * to avoid bricking data on partial failure.
 */
async function migrateLegacyLocalStorageKeyIfPresent(): Promise<void> {
  const legacyB64 = localStorage.getItem(LEGACY_LOCALSTORAGE_KEY)
  if (!legacyB64) return

  let legacyRaw: Uint8Array
  try {
    legacyRaw = new Uint8Array(base64ToBytes(legacyB64))
  } catch {
    localStorage.removeItem(LEGACY_LOCALSTORAGE_KEY)
    return
  }
  if (legacyRaw.length !== 32) {
    localStorage.removeItem(LEGACY_LOCALSTORAGE_KEY)
    return
  }

  let legacyKey: CryptoKey
  try {
    legacyKey = await crypto.subtle.importKey(
      'raw',
      legacyRaw.slice(),
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )
  } catch {
    localStorage.removeItem(LEGACY_LOCALSTORAGE_KEY)
    return
  }

  const row = await loadCanvasRow()

  if (row?.payload) {
    let plaintext: string
    try {
      plaintext = await decrypt(row.payload, legacyKey)
    } catch {
      await db.canvas.delete(CANVAS_ID)
      localStorage.removeItem(LEGACY_LOCALSTORAGE_KEY)
      return
    }
    const newSeed = crypto.getRandomValues(new Uint8Array(32))
    await saveSeedToDb(newSeed)
    const newKey = await deriveAesKeyFromSeed(newSeed)
    const newPayload = await encrypt(plaintext, newKey)
    await db.canvas.put({
      id: CANVAS_ID,
      payload: newPayload,
      updatedAt: Date.now(),
    })
    localStorage.removeItem(LEGACY_LOCALSTORAGE_KEY)
    return
  }

  const newSeed = crypto.getRandomValues(new Uint8Array(32))
  await saveSeedToDb(newSeed)
  localStorage.removeItem(LEGACY_LOCALSTORAGE_KEY)
}

async function loadOrCreateKey(): Promise<CryptoKey> {
  const existing = await readSeedFromDb()
  if (existing) {
    return deriveAesKeyFromSeed(existing)
  }

  await migrateLegacyLocalStorageKeyIfPresent()

  const afterMigrate = await readSeedFromDb()
  if (afterMigrate) {
    return deriveAesKeyFromSeed(afterMigrate)
  }

  const newSeed = crypto.getRandomValues(new Uint8Array(32))
  await saveSeedToDb(newSeed)
  return deriveAesKeyFromSeed(newSeed)
}

export function getOrCreateKey(): Promise<CryptoKey> {
  keyPromise ??= loadOrCreateKey()
  return keyPromise
}

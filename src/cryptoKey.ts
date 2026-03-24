import { base64ToBytes, bytesToBase64 } from './crypto'

const STORAGE_KEY = 'folium.encKey'

let keyPromise: Promise<CryptoKey> | null = null

async function loadOrCreateKey(): Promise<CryptoKey> {
  const existing = localStorage.getItem(STORAGE_KEY)
  if (existing) {
    const raw = new Uint8Array(base64ToBytes(existing))
    return crypto.subtle.importKey(
      'raw',
      raw,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt'],
    )
  }

  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  )
  const exported = await crypto.subtle.exportKey('raw', key)
  const raw = new Uint8Array(exported)
  localStorage.setItem(STORAGE_KEY, bytesToBase64(raw))
  return key
}

export function getOrCreateKey(): Promise<CryptoKey> {
  keyPromise ??= loadOrCreateKey()
  return keyPromise
}

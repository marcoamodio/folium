const AES_GCM = 'AES-GCM' as const
const IV_LENGTH = 12

/** Binary → base64 (safe for large buffers). */
export function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    for (let j = 0; j < chunk.length; j++) {
      binary += String.fromCharCode(chunk[j]!)
    }
  }
  return btoa(binary)
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i)
  }
  return out
}

export async function encrypt(
  plaintext: string,
  key: CryptoKey,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const encoded = new TextEncoder().encode(plaintext)
  const ciphertext = await crypto.subtle.encrypt(
    { name: AES_GCM, iv },
    key,
    encoded,
  )
  const ct = new Uint8Array(ciphertext)
  return `${bytesToBase64(iv)}.${bytesToBase64(ct)}`
}

export async function decrypt(
  payload: string,
  key: CryptoKey,
): Promise<string> {
  const dot = payload.indexOf('.')
  if (dot === -1) {
    throw new Error('Invalid encrypted payload format')
  }
  const ivB64 = payload.slice(0, dot)
  const ctB64 = payload.slice(dot + 1)
  if (!ivB64.length || !ctB64.length) {
    throw new Error('Invalid encrypted payload segments')
  }
  const iv = new Uint8Array(base64ToBytes(ivB64))
  const ciphertext = new Uint8Array(base64ToBytes(ctB64))
  const decrypted = await crypto.subtle.decrypt(
    { name: AES_GCM, iv },
    key,
    ciphertext,
  )
  return new TextDecoder().decode(decrypted)
}

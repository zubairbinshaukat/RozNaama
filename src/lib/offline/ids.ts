import { CLIENT_REQUEST_ID_RE } from '../../../convex/lib/limits'

type CryptoLike = {
  randomUUID?: () => string
  getRandomValues?: <T extends ArrayBufferView>(array: T) => T
}

function fallbackId(cryptoImpl: CryptoLike | undefined): string {
  const bytes = new Uint8Array(16)
  if (cryptoImpl?.getRandomValues) {
    cryptoImpl.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  // 32 hex chars: matches CLIENT_REQUEST_ID_RE (16–64 of [A-Za-z0-9_-]).
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * A new outbox entry id = server `clientRequestId`. `crypto.randomUUID()`
 * when available (secure contexts), otherwise 128 random bits as hex.
 */
export function newClientRequestId(cryptoImpl: CryptoLike | undefined = globalThis.crypto): string {
  try {
    const id = cryptoImpl?.randomUUID?.()
    if (id && CLIENT_REQUEST_ID_RE.test(id)) return id
  } catch {
    // randomUUID throws outside secure contexts in some browsers.
  }
  return fallbackId(cryptoImpl)
}

export function isValidClientRequestId(id: string): boolean {
  return CLIENT_REQUEST_ID_RE.test(id)
}

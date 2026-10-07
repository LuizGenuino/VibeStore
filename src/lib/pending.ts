/**
 * Mantém a MESMA request_id entre retries (inclusive após recarregar a aba).
 * Mudou qualquer campo → fingerprint muda → nova intenção → novo request_id.
 */
export interface Pending<T> {
  requestId: string
  fingerprint: string
  payload: T
  createdAt: number
}

export function stablePending<T>(key: string, payload: T): Pending<T> {
  const fingerprint = JSON.stringify(payload)
  try {
    const saved = sessionStorage.getItem(key)
    if (saved) {
      const p = JSON.parse(saved) as Pending<T>
      if (p.fingerprint === fingerprint) return p // mesma intenção → mesma chave
    }
  } catch {
    /* sessionStorage indisponível/corrompido → segue com chave nova */
  }
  const fresh: Pending<T> = {
    requestId: crypto.randomUUID(),
    fingerprint,
    payload,
    createdAt: Date.now(),
  }
  try {
    sessionStorage.setItem(key, JSON.stringify(fresh))
  } catch {
    /* sem storage: idempotência só vale dentro desta aba */
  }
  return fresh
}

export const clearPending = (key: string) => {
  try {
    sessionStorage.removeItem(key)
  } catch {
    /* noop */
  }
}

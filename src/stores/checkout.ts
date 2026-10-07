import { newClientSecret } from '@/lib/ids'
import { storefrontApi, StorefrontError } from '@/services/storefront.service'
import type { CheckoutInput, CheckoutData } from '@/types/storefront'
import { useCartStore } from './cart'

/**
 * Submissão idempotente do checkout (guia 19.5).
 * request_id + client_secret gerados UMA vez por intenção e reutilizados nos retries;
 * alterar qualquer campo = nova intenção = nova chave (fingerprint).
 */
interface PendingCheckout {
  request_id: string
  client_secret: string
  input: CheckoutInput
  fingerprint: string
}

const KEY = (slug: string) => `vibestore:checkout:${slug}`

function readPending(slug: string): PendingCheckout | null {
  try {
    return JSON.parse(sessionStorage.getItem(KEY(slug)) ?? 'null')
  } catch {
    return null
  }
}

export async function submitCheckout(slug: string, input: CheckoutInput): Promise<CheckoutData> {
  const fingerprint = JSON.stringify(input)
  let p = readPending(slug)
  if (!p || p.fingerprint !== fingerprint) {
    // NOVA intenção (primeira tentativa ou dados alterados) => nova chave e novo segredo
    p = { request_id: crypto.randomUUID(), client_secret: newClientSecret(), input, fingerprint }
    try {
      sessionStorage.setItem(KEY(slug), JSON.stringify(p))
    } catch {
      /* sem storage */
    }
  }
  try {
    const data = await storefrontApi.checkout({
      store_slug: slug,
      request_id: p.request_id,
      client_secret: p.client_secret,
      input: p.input,
    })
    // SUCESSO (inclusive replayed=true): limpar payload sensível
    sessionStorage.removeItem(KEY(slug))
    useCartStore.getState().clear(slug)
    return data
  } catch (e) {
    if (e instanceof StorefrontError && e.retryable) throw e // manter p: retry usa a MESMA chave
    if (e instanceof StorefrontError && e.code === 'IDEMPOTENCY_KEY_REUSED') {
      sessionStorage.removeItem(KEY(slug))
    }
    throw e // 400/409: usuário corrige → fingerprint muda
  }
}

/** Token de acompanhamento do pedido (43 chars) — vive só em sessionStorage, nunca na URL/log. */
export const orderTokenKey = (orderId: string) => `vibestore:order-token:${orderId}`
export const ORDER_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/

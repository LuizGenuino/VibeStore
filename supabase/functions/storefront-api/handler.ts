export type Rpc = (name: string, args: Record<string, unknown>) => Promise<unknown>
export interface Config {
  appUrl: string
  orderTokenSecret: string
  rateLimitSecret: string
  allowedOrigins: string[]
  trustedClientIpHeader?: string
}
export class RpcError extends Error {
  constructor(public code: string, message: string) { super(message) }
}
class HttpError extends Error {
  constructor(public status: number, public code: string, public retryAfter?: number) { super(code) }
}
const encoder = new TextEncoder()
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const TOKEN = /^[A-Za-z0-9_-]{43}$/
const MAX_BYTES = 32768
const actionLimits: Record<string, number> = { catalog: 300, product: 300, checkout: 30, 'order-status': 120 }
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'INVALID_BODY')
  return v as Record<string, unknown>
}
function onlyKeys(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).some(k => !keys.includes(k))) throw new HttpError(400, 'UNKNOWN_FIELD')
}
function string(v: unknown, min: number, max: number): string {
  if (typeof v !== 'string' || v.length < min || v.length > max) throw new HttpError(400, 'INVALID_FIELD')
  return v
}
function slug(v: unknown): string {
  const s = string(v, 2, 160)
  if (!SLUG.test(s)) throw new HttpError(400, 'INVALID_SLUG')
  return s
}
function uuid(v: unknown): string {
  const s = string(v, 36, 36)
  if (!UUID.test(s)) throw new HttpError(400, 'INVALID_UUID')
  return s.toLowerCase()
}
function token(v: unknown): string {
  const s = string(v, 43, 43)
  if (!TOKEN.test(s)) throw new HttpError(400, 'INVALID_TOKEN')
  return s
}
export async function sha256(value: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('')
}
async function hmac(secret: string, value: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)))
}
async function subject(secret: string, value: string): Promise<string> {
  return Array.from(await hmac(secret, value), b => b.toString(16).padStart(2, '0')).join('')
}
export async function trackingToken(secret: string, store: string, request: string, clientSecret: string): Promise<string> {
  const bytes = await hmac(secret, `v1:${store}:${request}:${clientSecret}`)
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
async function readBody(req: Request): Promise<Record<string, unknown>> {
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) throw new HttpError(415, 'JSON_REQUIRED')
  const length = Number(req.headers.get('content-length') ?? 0)
  if (length > MAX_BYTES) throw new HttpError(413, 'BODY_TOO_LARGE')
  const reader = req.body?.getReader()
  if (!reader) throw new HttpError(400, 'INVALID_BODY')
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BYTES) { await reader.cancel(); throw new HttpError(413, 'BODY_TOO_LARGE') }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  try { return object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))) }
  catch { throw new HttpError(400, 'INVALID_JSON') }
}
function validateFilters(raw: unknown): Record<string, unknown> {
  const f = object(raw ?? {})
  onlyKeys(f, ['search', 'category_id', 'min_price', 'max_price', 'in_stock', 'sort', 'page', 'page_size'])
  if (f.search !== undefined) string(f.search, 0, 100)
  if (f.category_id !== undefined && f.category_id !== null) uuid(f.category_id)
  for (const key of ['min_price', 'max_price']) {
    if (f[key] !== undefined && f[key] !== null && (typeof f[key] !== 'number' || !Number.isFinite(f[key]) || (f[key] as number) < 0 || (f[key] as number) > 9999999999.99)) throw new HttpError(400, 'INVALID_PRICE_FILTER')
  }
  if (typeof f.min_price === 'number' && typeof f.max_price === 'number' && f.min_price > f.max_price) throw new HttpError(400, 'INVALID_PRICE_RANGE')
  if (f.in_stock !== undefined && typeof f.in_stock !== 'boolean') throw new HttpError(400, 'INVALID_STOCK_FILTER')
  if (f.sort !== undefined && !['newest', 'price_asc', 'price_desc', 'name_asc'].includes(String(f.sort))) throw new HttpError(400, 'INVALID_SORT')
  for (const [key, max] of [['page', 1000], ['page_size', 24]] as const) {
    if (f[key] !== undefined && (!Number.isInteger(f[key]) || Number(f[key]) < 1 || Number(f[key]) > max)) throw new HttpError(400, 'INVALID_PAGINATION')
  }
  return f
}
function validateCheckout(raw: unknown): Record<string, unknown> {
  const input = object(raw)
  onlyKeys(input, ['customer', 'address', 'items', 'note'])
  const c = object(input.customer)
  onlyKeys(c, ['full_name', 'phone'])
  string(c.full_name, 2, 120)
  const phone = string(c.phone, 9, 16)
  if (!/^\+[1-9][0-9]{7,14}$/.test(phone)) throw new HttpError(400, 'INVALID_PHONE')
  const a = object(input.address)
  onlyKeys(a, ['postal_code', 'street', 'number', 'complement', 'district', 'city', 'state'])
  for (const key of ['postal_code', 'street', 'number', 'district', 'city', 'state']) string(a[key], 1, 160)
  if (!/^\d{8}$/.test(String(a.postal_code)) || !/^[A-Z]{2}$/.test(String(a.state))) throw new HttpError(400, 'INVALID_ADDRESS')
  if (a.complement !== undefined) string(a.complement, 0, 160)
  if (input.note !== undefined) string(input.note, 0, 1000)
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 20) throw new HttpError(400, 'INVALID_ITEMS')
  const ids = new Set<string>()
  for (const item of input.items) {
    const row = object(item); onlyKeys(row, ['product_id', 'quantity'])
    const id = uuid(row.product_id)
    if (ids.has(id)) throw new HttpError(400, 'DUPLICATE_PRODUCT')
    ids.add(id)
    if (!Number.isInteger(row.quantity) || Number(row.quantity) < 1 || Number(row.quantity) > 999) throw new HttpError(400, 'INVALID_QUANTITY')
  }
  return input
}
export function createHandler(config: Config, rpc: Rpc): (req: Request) => Promise<Response> {
  const app = new URL(config.appUrl)
  if (!['https:', 'http:'].includes(app.protocol) || config.orderTokenSecret.length < 32 || config.rateLimitSecret.length < 32) throw new Error('Invalid server configuration')
  if (config.trustedClientIpHeader && !['x-forwarded-for', 'x-real-ip', 'cf-connecting-ip'].includes(config.trustedClientIpHeader.toLowerCase())) throw new Error('Unsupported proxy header')
  return async req => {
    const origin = req.headers.get('origin')
    const originAllowed = !origin || config.allowedOrigins.includes(origin)
    const headers = new Headers({ 'content-type': 'application/json', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'vary': 'Origin' })
    if (origin && originAllowed) {
      headers.set('access-control-allow-origin', origin)
      headers.set('access-control-allow-methods', 'POST, OPTIONS')
      headers.set('access-control-allow-headers', 'content-type, apikey, authorization, x-client-info')
    }
    const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers })
    try {
      if (!originAllowed) throw new HttpError(403, 'ORIGIN_NOT_ALLOWED')
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
      if (req.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED')
      const body = await readBody(req)
      const action = string(body.action, 1, 30)
      if (!Object.hasOwn(actionLimits, action)) throw new HttpError(400, 'INVALID_ACTION')
      const store = slug(body.store_slug)
      if (store.length > 63) throw new HttpError(400, 'INVALID_STORE_SLUG')
      const limit = async (scope: string, identity: string, maximum: number) => {
        const raw = object(await rpc('consume_public_rate_limit', { p_scope: scope, p_subject_hash: await subject(config.rateLimitSecret, identity), p_limit: maximum, p_window_seconds: 60 }))
        if (raw.allowed !== true) throw new HttpError(429, 'RATE_LIMITED', Math.max(1, Number(raw.retry_after) || 60))
      }
      // Teto global por acao, independentemente de headers, telefone ou chave de pedido.
      await limit(action, `global:${action}`, actionLimits[action])
      // Opt-in: somente habilitar apos comprovar que o gateway sobrescreve o header.
      if (config.trustedClientIpHeader) {
        const ip = req.headers.get(config.trustedClientIpHeader)?.split(',')[0].trim() || 'unknown'
        await limit('client', `${action}:${store}:${ip}`, action === 'checkout' ? 5 : 60)
      }
      let data: unknown
      if (action === 'catalog') {
        onlyKeys(body, ['action', 'store_slug', 'filters'])
        data = await rpc('get_public_catalog', { p_store_slug: store, p_filters: validateFilters(body.filters) })
      } else if (action === 'product') {
        onlyKeys(body, ['action', 'store_slug', 'product_slug'])
        data = await rpc('get_public_product', { p_store_slug: store, p_product_slug: slug(body.product_slug) })
      } else if (action === 'order-status') {
        onlyKeys(body, ['action', 'store_slug', 'order_id', 'token'])
        data = await rpc('get_public_order_status', { p_store_slug: store, p_order_id: uuid(body.order_id), p_token_hash: await sha256(token(body.token)) })
      } else {
        onlyKeys(body, ['action', 'store_slug', 'request_id', 'client_secret', 'input'])
        const input = validateCheckout(body.input)
        const customer = object(input.customer)
        await limit('checkout-phone', `${store}:${customer.phone}`, 3)
        const requestId = uuid(body.request_id)
        const accessToken = await trackingToken(config.orderTokenSecret, store, requestId, token(body.client_secret))
        const result = object(await rpc('create_public_order', { p_store_slug: store, p_request_id: requestId, p_input: input, p_token_hash: await sha256(accessToken) }))
        const orderId = uuid(result.order_id)
        const trackingUrl = new URL(`/s/${store}/pedido/${orderId}`, app)
        trackingUrl.hash = `token=${accessToken}`
        const phone = string(result.whatsapp_number, 9, 16).replace(/\D/g, '')
        const amount = Number(result.subtotal).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
        const message = `Olá! Fiz o pedido ${String(result.code)} na loja ${store}.\nSubtotal dos produtos: ${amount}. Frete e pagamento a combinar.\nAcompanhar: ${trackingUrl.href}`
        data = { ...result, token: accessToken, tracking_url: trackingUrl.href, whatsapp_url: `https://wa.me/${phone}?text=${encodeURIComponent(message)}`, shipping_included: false }
      }
      if (data === null) return respond({ error: 'NOT_FOUND' }, 404)
      return respond({ data })
    } catch (error) {
      if (error instanceof HttpError) {
        if (error.retryAfter) headers.set('retry-after', String(error.retryAfter))
        return respond({ error: error.code }, error.status)
      }
      if (error instanceof RpcError) {
        const known = ['STORE_UNAVAILABLE', 'PRODUCT_UNAVAILABLE', 'INSUFFICIENT_AVAILABLE_STOCK', 'IDEMPOTENCY_KEY_REUSED', 'ORDER_TOTAL_LIMIT']
        if (known.includes(error.message)) return respond({ error: error.message }, error.message === 'STORE_UNAVAILABLE' ? 404 : 409)
        if (error.code.startsWith('22') || error.code.startsWith('23')) return respond({ error: 'INVALID_REQUEST' }, 400)
      }
      // Nao registrar body, telefone, endereco, token, client_secret ou resposta do banco.
      return respond({ error: 'SERVICE_UNAVAILABLE' }, 503)
    }
  }
}

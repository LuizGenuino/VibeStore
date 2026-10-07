declare const Deno: any


import { createHandler, RpcError, sha256, trackingToken, type Rpc } from './handler.ts'
function assert(value: unknown, message = 'Assertion failed'): asserts value { if (!value) throw new Error(message) }
const config = { appUrl: 'https://app.example.test', orderTokenSecret: 'T'.repeat(48), rateLimitSecret: 'R'.repeat(48), allowedOrigins: ['https://app.example.test'] }
const requestId = '11111111-1111-4111-8111-111111111111'
const productId = '22222222-2222-4222-8222-222222222222'
const orderId = '33333333-3333-4333-8333-333333333333'
const secret = 'A'.repeat(43)
function req(body: unknown, origin = 'https://app.example.test') {
  return new Request('https://edge.example.test/storefront-api', { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) })
}
function checkout() {
  return { action: 'checkout', store_slug: 'minha-loja', request_id: requestId, client_secret: secret,
    input: { customer: { full_name: 'Cliente Teste', phone: '+12025550101' }, address: { postal_code: '01001000', street: 'Rua Teste', number: '1', district: 'Centro', city: 'Sao Paulo', state: 'SP' }, items: [{ product_id: productId, quantity: 2 }] } }
}
Deno.test('token deterministico, isolado por loja/request/client_secret, hash de 64 caracteres', async () => {
  const a = await trackingToken(config.orderTokenSecret, 'minha-loja', requestId, secret)
  const again = await trackingToken(config.orderTokenSecret, 'minha-loja', requestId, secret)
  const other = await trackingToken(config.orderTokenSecret, 'minha-loja', requestId, 'B'.repeat(43))
  assert(a === again && a !== other && a.length === 43)
  assert((await sha256(a)).length === 64)
})
Deno.test('catalogo passa filtros validados para RPC e aplica quota primeiro', async () => {
  const calls: string[] = []
  const rpc: Rpc = async (name, args) => {
    calls.push(name)
    if (name === 'consume_public_rate_limit') return { allowed: true }
    assert(name === 'get_public_catalog')
    assert((args.p_filters as Record<string, unknown>).page_size === 12)
    return { products: [], total: 0 }
  }
  const res = await createHandler(config, rpc)(req({ action: 'catalog', store_slug: 'minha-loja', filters: { page_size: 12 } }))
  assert(res.status === 200 && calls[0] === 'consume_public_rate_limit')
  assert(res.headers.get('cache-control') === 'no-store')
})
Deno.test('checkout salva apenas hash e retorna link com fragmento e WhatsApp', async () => {
  const rpc: Rpc = async (name, args) => {
    if (name === 'consume_public_rate_limit') return { allowed: true }
    assert(name === 'create_public_order')
    assert(typeof args.p_token_hash === 'string' && args.p_token_hash.length === 64)
    assert(!Object.hasOwn(args, 'client_secret') && !Object.hasOwn(args, 'token'))
    return { order_id: orderId, code: 'PED-000001', subtotal: 50, whatsapp_number: '+12025550102', status: 'PENDING', replayed: false }
  }
  const res = await createHandler(config, rpc)(req(checkout()))
  const body = await res.json()
  assert(res.status === 200 && body.data.tracking_url.includes('#token='))
  assert(!new URL(body.data.tracking_url).search && body.data.whatsapp_url.startsWith('https://wa.me/'))
})
Deno.test('preco vindo do navegador e campo desconhecido sao rejeitados', async () => {
  let checkoutCalls = 0
  const rpc: Rpc = async (name) => { if (name !== 'consume_public_rate_limit') checkoutCalls++; return { allowed: true } }
  const input = checkout()
  Object.assign(input.input.items[0], { unit_price: 0 })
  const res = await createHandler(config, rpc)(req(input))
  assert(res.status === 400 && checkoutCalls === 0)
})
Deno.test('quantidade fracionada, produto repetido e UUID invalido sao rejeitados', async () => {
  const rpc: Rpc = async () => ({ allowed: true })
  for (const change of ['fraction', 'duplicate', 'uuid']) {
    const input = checkout()
    if (change === 'fraction') input.input.items[0].quantity = 1.5
    if (change === 'duplicate') input.input.items.push({ ...input.input.items[0] })
    if (change === 'uuid') input.request_id = 'invalido'
    assert((await createHandler(config, rpc)(req(input))).status === 400)
  }
})
Deno.test('rate limit retorna 429 com Retry-After e impede RPC de negocio', async () => {
  let businessCalls = 0
  const rpc: Rpc = async (name) => { if (name !== 'consume_public_rate_limit') businessCalls++; return { allowed: false, retry_after: 20 } }
  const res = await createHandler(config, rpc)(req({ action: 'catalog', store_slug: 'minha-loja' }))
  assert(res.status === 429 && res.headers.get('retry-after') === '20' && businessCalls === 0)
})
Deno.test('sem token nao consulta dados do pedido; com token envia apenas hash', async () => {
  let called = false
  const rpc: Rpc = async (name, args) => {
    if (name === 'consume_public_rate_limit') return { allowed: true }
    called = true
    assert(name === 'get_public_order_status' && typeof args.p_token_hash === 'string' && args.p_token_hash.length === 64)
    return null
  }
  const handler = createHandler(config, rpc)
  const res = await handler(req({ action: 'order-status', store_slug: 'minha-loja', order_id: orderId }))
  assert(res.status === 400 && !called)
  const valid = await handler(req({ action: 'order-status', store_slug: 'minha-loja', order_id: orderId, token: secret }))
  assert(valid.status === 404 && called)
})
Deno.test('CORS rejeita origem desconhecida e nao permite metodos diferentes', async () => {
  const handler = createHandler(config, async () => ({ allowed: true }))
  assert((await handler(req({ action: 'catalog', store_slug: 'minha-loja' }, 'https://evil.example.test'))).status === 403)
  assert((await handler(new Request('https://edge.example.test/'))).status === 405)
})
Deno.test('corpo acima de 32 KiB e rejeitado', async () => {
  const handler = createHandler(config, async () => ({ allowed: true }))
  assert((await handler(req({ action: 'catalog', store_slug: 'minha-loja', extra: 'x'.repeat(40000) }))).status === 413)
})
Deno.test('erro SQL nao expoe detalhes internos; conflitos conhecidos retornam 409', async () => {
  const handler = createHandler(config, async name => {
    if (name === 'consume_public_rate_limit') return { allowed: true }
    throw new RpcError('22023', 'INSUFFICIENT_AVAILABLE_STOCK')
  })
  assert((await handler(req(checkout()))).status === 409)
  const other = createHandler(config, async () => { throw new RpcError('XX000', 'secret-database-detail') })
  const res = await other(req({ action: 'catalog', store_slug: 'minha-loja' }))
  assert(res.status === 503 && !(await res.text()).includes('secret-database-detail'))
})
Deno.test('propriedade de prototype nao e acao valida', async () => {
  const res = await createHandler(config, async () => ({ allowed: true }))(req({ action: 'toString', store_slug: 'minha-loja' }))
  assert(res.status === 400)
})

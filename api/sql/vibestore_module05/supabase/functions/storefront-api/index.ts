import { createHandler, RpcError } from './handler.ts'

const url = Deno.env.get('SUPABASE_URL')
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ??
  JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}').default
if (!url || !serviceKey) throw new Error('Missing server database credentials')
const appUrl = Deno.env.get('APP_URL') ?? ''
const handler = createHandler({
  appUrl,
  orderTokenSecret: Deno.env.get('ORDER_TOKEN_SECRET') ?? '',
  rateLimitSecret: Deno.env.get('RATE_LIMIT_SECRET') ?? '',
  allowedOrigins: (Deno.env.get('ALLOWED_ORIGINS') ?? new URL(appUrl).origin)
    .split(',').map(value => value.trim()).filter(Boolean),
  trustedClientIpHeader: Deno.env.get('TRUSTED_CLIENT_IP_HEADER') || undefined,
}, async (name, args) => {
  const headers: Record<string, string> = { apikey: serviceKey, 'content-type': 'application/json' }
  if (serviceKey.startsWith('eyJ')) headers.Authorization = `Bearer ${serviceKey}`
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST', headers, body: JSON.stringify(args), signal: AbortSignal.timeout(10000),
  })
  const result = await response.json()
  if (!response.ok) throw new RpcError(String(result.code ?? ''), String(result.message ?? ''))
  return result
})
Deno.serve(handler)

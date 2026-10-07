const ALLOWED_PREFIXES = ['/app', '/sudo', '/auth/reset-password', '/s/']

/** Aceita SOMENTE caminhos relativos internos (anti open-redirect). Qualquer outro valor → fallback. */
export function safeRedirect(raw: unknown, fallback = '/app'): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 512) return fallback
  let value: string
  try {
    value = decodeURIComponent(raw)
  } catch {
    return fallback
  }
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback
  if (/[-\u001f\\]/.test(value)) return fallback // controle e barra invertida
  let url: URL
  try {
    url = new URL(value, window.location.origin)
  } catch {
    return fallback
  }
  if (url.origin !== window.location.origin) return fallback // ex.: '/\t//evil.com'
  if (url.pathname.startsWith('/auth/callback')) return fallback // evita loop
  if (!ALLOWED_PREFIXES.some((p) => url.pathname === p.replace(/\/$/, '') || url.pathname.startsWith(p)))
    return fallback
  return url.pathname + url.search // descarta hash (nunca propagar #token)
}

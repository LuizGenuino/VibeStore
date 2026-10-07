/** Formatação e máscaras pt-BR (datas, telefones, slugs). */

export const DEFAULT_TZ = 'America/Sao_Paulo'

const dtFmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: DEFAULT_TZ,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})
const dFmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: DEFAULT_TZ,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

export const formatDateTime = (iso: string | null | undefined): string =>
  iso ? dtFmt.format(new Date(iso)) : '—'
export const formatDate = (iso: string | null | undefined): string =>
  iso ? dFmt.format(new Date(iso)) : '—'

/** Início do dia (00:00) de YYYY-MM-DD no fuso informado, em ISO UTC. */
export function startOfDayIso(date: string, tz: string = DEFAULT_TZ): string {
  // Constrói a data no fuso alvo via en-CA trick + offset calculado.
  const [y, m, d] = date.split('-').map(Number)
  const guess = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)) // meio-dia UTC: seguro p/ achar o offset do dia
  const inTz = new Date(guess.toLocaleString('en-US', { timeZone: tz }))
  const offsetMs = inTz.getTime() - guess.getTime()
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - offsetMs).toISOString()
}

export const addDays = (date: string, days: number): string => {
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return dt.toISOString().slice(0, 10)
}

export const todayIso = (tz: string = DEFAULT_TZ): string =>
  new Date().toLocaleDateString('en-CA', { timeZone: tz })

/** Telefone E.164 (+5511999999999) → exibição "(11) 99999-9999". */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return '—'
  const digits = e164.replace(/\D/g, '')
  const local = digits.startsWith('55') ? digits.slice(2) : digits
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`
  return e164
}

/** Telefone com máscara parcial para listas (PII): "(11) 9••••-9999". */
export function maskPhone(e164: string | null | undefined): string {
  const f = formatPhone(e164)
  return f.replace(/(\d{4,5})-(\d{4})$/, (_m, a, b) => `${'•'.repeat(String(a).length)}-${b}`)
}

/** Entrada BR "(11) 99999-9999" → "+5511999999999" (E.164). Retorna null se inválido. */
export function toE164(input: string): string | null {
  const digits = input.replace(/\D/g, '')
  const local = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits
  if (local.length < 10 || local.length > 11) return null
  const e164 = `+55${local}`
  return /^\+[1-9][0-9]{7,14}$/.test(e164) ? e164 : null
}

/** Máscara progressiva de telefone BR enquanto digita. */
export function maskPhoneInput(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 2) return d
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

/** CEP: "00000-000" enquanto digita; envio usa só dígitos. */
export function maskCepInput(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 8)
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d
}

/** Gera slug a partir de um nome (sem acentos, minúsculo, hífens). */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
}

export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

export const shortId = (id: string | null | undefined): string => (id ? id.slice(0, 8) : '—')

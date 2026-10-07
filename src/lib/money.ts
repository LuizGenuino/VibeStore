/** numeric(12,2) → centavos inteiros para somar/comparar. */
export const toCents = (v: number | string): number => Math.round(Number(v) * 100)
export const fromCents = (c: number): number => c / 100

/** Exibição BRL: 1234.5 → "R$ 1.234,50" */
export const brl = (v: number | string | null | undefined): string =>
  Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/** Custo médio / valores de 6 casas — somente exibição, arredondado para 2 na UI. */
export const brl6 = (v: number | string | null | undefined): string => brl(Number(v ?? 0))

/** Converte entrada digitada "1.234,56" → 1234.56 (2 casas) ou null. Nunca envia mais de 2 casas. */
export function parseBrlInput(s: string): number | null {
  const n = Number(s.replace(/\./g, '').replace(',', '.').trim())
  return Number.isFinite(n) && n >= 0 ? fromCents(toCents(n)) : null
}

/** Formata número para exibição em input (1234.56 → "1234,56"). */
export function formatBrlInput(v: number | null | undefined): string {
  if (v == null) return ''
  return Number(v).toFixed(2).replace('.', ',')
}

/** Quantidade: sempre inteiro; valida antes de enviar. */
export const parseQty = (v: string): number | null => {
  const n = Number(v)
  return Number.isInteger(n) && n >= 0 ? n : null
}

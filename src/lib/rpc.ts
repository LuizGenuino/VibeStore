import type { PostgrestError } from '@supabase/supabase-js'
import { supabase } from './supabase'

export class BackendError extends Error {
  constructor(
    public code: string, // código de negócio (RAISE EXCEPTION) ou SQLSTATE/PGRST
    public sqlState: string, // ex.: '22023', '42501', '23505'
    public raw?: PostgrestError,
  ) {
    super(code)
    this.name = 'BackendError'
  }
  get isForbidden() {
    return this.sqlState === '42501'
  }
  get isStale() {
    return this.code === 'STALE_ORDER_REVISION' || this.code === 'STALE_INVENTORY_REVISION'
  }
  get isNetwork() {
    return this.code === 'NETWORK_ERROR'
  }
}

const BUSINESS_CODE = /^[A-Z][A-Z0-9_]{2,80}$/

export function toBackendError(e: PostgrestError | null | undefined): BackendError {
  if (!e) return new BackendError('UNKNOWN', '')
  const msg = (e.message ?? '').trim()
  if (BUSINESS_CODE.test(msg)) return new BackendError(msg, e.code ?? '', e) // RAISE EXCEPTION 'CODIGO'
  const constraint = /constraint "([^"]+)"/.exec(msg)?.[1] // 23505 / 23514 / 23503
  if (constraint) return new BackendError(`${e.code}:${constraint}`, e.code ?? '', e)
  if (e.code === '42501') return new BackendError('FORBIDDEN', '42501', e) // RLS/GRANT
  if (!e.code && /fetch|network/i.test(msg)) return new BackendError('NETWORK_ERROR', '', e)
  return new BackendError(e.code || 'UNKNOWN', e.code ?? '', e)
}

/** Chamada tipada: rpc<CreateProductArgs, CreateProductResult>('create_product', args) */
export async function rpc<A extends object, R>(fn: string, args?: A): Promise<R> {
  const { data, error } = await supabase.rpc(fn, args as never)
  if (error) throw toBackendError(error)
  return data as R
}

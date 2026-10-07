import { toast } from 'sonner'
import { BackendError } from '@/lib/rpc'
import { StorefrontError } from '@/services/storefront.service'
import { messageFor } from '@/lib/errors'
import { MediaError } from '@/lib/media'

/** Extrai a mensagem pt-BR de qualquer erro da aplicação. */
export function errorMessage(e: unknown): string {
  if (e instanceof BackendError) return messageFor(e.code)
  if (e instanceof StorefrontError) return messageFor(e.code)
  if (e instanceof MediaError) return messageFor(e.code)
  if (e instanceof Error && e.message === 'INVALID_REPORT_PERIOD_OR_TIMEZONE')
    return messageFor(e.message)
  return messageFor('UNKNOWN')
}

export function toastError(e: unknown, fallbackTitle = 'Não foi possível concluir') {
  if (e instanceof BackendError || e instanceof StorefrontError || e instanceof MediaError) {
    toast.error(fallbackTitle, { description: errorMessage(e) })
    return
  }
  toast.error(fallbackTitle, { description: 'Tente novamente em instantes.' })
}

export const toastSuccess = (title: string, description?: string) =>
  toast.success(title, description ? { description } : undefined)

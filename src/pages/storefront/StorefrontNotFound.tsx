import { Link, useParams } from 'react-router-dom'
import { Store } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * 404 da vitrine (guia 19.7): mensagem GENÉRICA — nunca distingue
 * "loja não existe" de "loja não publicada" (o backend também não distingue).
 * Sem links para o painel. Export nomeado (StorefrontLayout) + default (router).
 */
export function StorefrontNotFound() {
  const { storeSlug } = useParams()
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6 py-16">
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <div className="mb-1 flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Store className="h-6 w-6" />
        </div>
        <h1 className="font-display text-2xl font-bold">Loja ou página indisponível</h1>
        <p className="text-sm text-muted-foreground">
          O endereço pode estar incorreto ou o conteúdo não está mais disponível. Confira o link
          recebido e tente novamente.
        </p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {storeSlug ? (
            <Button asChild>
              <Link to={`/s/${storeSlug}`}>Voltar para a loja</Link>
            </Button>
          ) : (
            <Button asChild variant="outline">
              <Link to="/">Ir para o início</Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

export default StorefrontNotFound

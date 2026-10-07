import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, MessageCircle, Minus, Plus, ShoppingBag } from 'lucide-react'
import { toast } from 'sonner'
import { storefrontApi, StorefrontError } from '@/services/storefront.service'
import { useStorefrontStore } from '@/layouts/StorefrontLayout'
import { useCartStore } from '@/stores/cart'
import { productImageUrl } from '@/lib/media'
import { brl } from '@/lib/money'
import { errorMessage } from '@/lib/feedback'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { ErrorRetryState } from '@/components/shared/page-state'
import { StorefrontNotFound } from './StorefrontNotFound'

/**
 * Página do produto (guia 19.3): galeria (≤4 imagens ordenadas), atributos
 * em tabela, descrição como TEXTO (escape do React — nunca HTML), quantidade
 * inteira 1..999. A validação final de estoque acontece no checkout (a
 * quantidade disponível não é exposta).
 */
export default function StorefrontProductPage() {
  const { slug, store } = useStorefrontStore()
  const { productSlug = '' } = useParams()
  const navigate = useNavigate()
  const add = useCartStore((s) => s.add)

  const [imageIndex, setImageIndex] = useState(0)
  const [qty, setQty] = useState(1)

  const productQuery = useQuery({
    queryKey: ['storefront', 'product', slug, productSlug],
    queryFn: () => storefrontApi.product(slug, productSlug),
    enabled: !!slug && !!productSlug,
    retry: (failureCount, error) => {
      if (error instanceof StorefrontError && (error.notFound || error.status === 400)) return false
      return failureCount < 2
    },
  })

  const product = productQuery.data
  const images = useMemo(
    () => [...(product?.images ?? [])].sort((a, b) => a.sort_order - b.sort_order).slice(0, 4),
    [product?.images],
  )

  if (productQuery.error instanceof StorefrontError && productQuery.error.notFound) {
    return <StorefrontNotFound />
  }

  if (productQuery.isPending) {
    return (
      <div className="container grid gap-8 py-8 md:grid-cols-2" aria-busy="true">
        <div className="space-y-3">
          <Skeleton className="aspect-square w-full rounded-xl" />
          <div className="flex gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-16 rounded-lg" />
            ))}
          </div>
        </div>
        <div className="space-y-4">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-7 w-1/4" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-10 w-48" />
        </div>
      </div>
    )
  }

  if (productQuery.isError || !product) {
    return (
      <div className="container py-8">
        <ErrorRetryState
          description={
            productQuery.error ? errorMessage(productQuery.error) : undefined
          }
          onRetry={() => void productQuery.refetch()}
          retrying={productQuery.isRefetching}
        />
      </div>
    )
  }

  const current = images[Math.min(imageIndex, Math.max(0, images.length - 1))]
  const currentUrl = productImageUrl(current?.path)

  const clampQty = (v: number) => Math.max(1, Math.min(999, Math.trunc(v) || 1))

  const whatsappDigits = (store?.whatsapp_number ?? '').replace(/\D/g, '')
  const whatsappUrl = whatsappDigits
    ? `https://wa.me/${whatsappDigits}?text=${encodeURIComponent(
        `Olá! Tenho interesse em ${product.name}`,
      )}`
    : null

  const onAdd = () => {
    const result = add(slug, product, qty)
    if (!result.ok) {
      toast.error('Não foi possível adicionar', { description: result.reason })
      return
    }
    toast.success('Adicionado ao carrinho', {
      description: `${qty} × ${product.name}`,
      action: { label: 'Ver carrinho', onClick: () => navigate(`/s/${slug}/carrinho`) },
    })
  }

  return (
    <div className="container py-6">
      <Link
        to={`/s/${slug}`}
        className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Voltar para a vitrine
      </Link>

      <div className="grid gap-8 md:grid-cols-2">
        {/* Galeria */}
        <div className="space-y-3">
          <div className="relative aspect-square overflow-hidden rounded-xl border bg-muted">
            {currentUrl ? (
              <img
                src={currentUrl}
                alt={current?.alt_text || product.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center font-display text-6xl font-bold text-muted-foreground/30">
                {product.name.slice(0, 1)}
              </div>
            )}
            {!product.in_stock && (
              <Badge className="absolute left-3 top-3 border-transparent bg-foreground/85 text-background">
                Esgotado
              </Badge>
            )}
          </div>
          {images.length > 1 && (
            <div className="flex gap-2">
              {images.map((img, i) => {
                const url = productImageUrl(img.path)
                return (
                  <button
                    key={`${img.path}-${i}`}
                    type="button"
                    onClick={() => setImageIndex(i)}
                    aria-label={`Imagem ${i + 1} de ${product.name}`}
                    className={cn(
                      'h-16 w-16 overflow-hidden rounded-lg border-2 bg-muted transition-colors',
                      i === imageIndex ? 'border-primary' : 'border-transparent hover:border-muted-foreground/40',
                    )}
                  >
                    {url && (
                      <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Detalhes */}
        <div className="flex flex-col gap-4">
          <div>
            <p className="font-mono text-xs text-muted-foreground">{product.code}</p>
            <h1 className="mt-1 font-display text-2xl font-bold text-balance sm:text-3xl">
              {product.name}
            </h1>
          </div>
          <p className="font-display text-3xl font-bold text-primary">{brl(product.price)}</p>

          {product.description && (
            <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
              {product.description}
            </p>
          )}

          {product.attributes.length > 0 && (
            <div className="overflow-hidden rounded-lg border">
              <dl>
                {product.attributes.map((attr, i) => (
                  <div
                    key={`${attr.name}-${i}`}
                    className={cn(
                      'grid grid-cols-[140px_1fr] gap-3 px-4 py-2.5 text-sm',
                      i % 2 === 0 && 'bg-muted/50',
                    )}
                  >
                    <dt className="font-medium text-muted-foreground">{attr.name}</dt>
                    <dd>{attr.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          <Separator />

          {/* Quantidade + ações */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center rounded-md border shadow-sm">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-r-none"
                onClick={() => setQty((q) => clampQty(q - 1))}
                disabled={qty <= 1}
                aria-label="Diminuir quantidade"
              >
                <Minus />
              </Button>
              <Input
                value={qty}
                onChange={(e) => {
                  const n = Number(e.target.value.replace(/\D/g, ''))
                  setQty(Number.isFinite(n) ? clampQty(n) : 1)
                }}
                inputMode="numeric"
                className="h-9 w-16 rounded-none border-0 text-center font-mono shadow-none focus-visible:ring-0"
                aria-label="Quantidade"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-l-none"
                onClick={() => setQty((q) => clampQty(q + 1))}
                disabled={qty >= 999}
                aria-label="Aumentar quantidade"
              >
                <Plus />
              </Button>
            </div>
            <Button
              size="lg"
              className="flex-1 sm:flex-none"
              disabled={!product.in_stock}
              onClick={onAdd}
            >
              <ShoppingBag />
              {product.in_stock ? 'Adicionar ao carrinho' : 'Produto esgotado'}
            </Button>
          </div>

          {whatsappUrl && (
            <Button asChild variant="outline" size="lg" className="w-full sm:w-fit">
              <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
                <MessageCircle />
                Chamar no WhatsApp
              </a>
            </Button>
          )}

          <p className="text-xs text-muted-foreground">
            Frete e pagamento combinados pelo WhatsApp após o pedido.
          </p>
        </div>
      </div>
    </div>
  )
}

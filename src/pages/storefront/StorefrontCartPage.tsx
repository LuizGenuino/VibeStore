import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Minus, Plus, ShoppingBag, Trash2 } from 'lucide-react'
import { storefrontApi } from '@/services/storefront.service'
import { useStorefrontStore } from '@/layouts/StorefrontLayout'
import { cartSubtotal, useCartItems, useCartStore } from '@/stores/cart'
import { productImageUrl } from '@/lib/media'
import { brl } from '@/lib/money'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/page-state'
import type { PublicProduct } from '@/types/storefront'
import type { Uuid } from '@/types/backend'

/**
 * Carrinho da vitrine (guia 19.4): estado local por loja; ao abrir, REVALIDA
 * cada item contra a Edge (nome/preço/in_stock) e avisa as mudanças.
 * O preço aqui é SÓ exibição — o servidor recalcula no checkout.
 */
export default function StorefrontCartPage() {
  const { slug } = useStorefrontStore()
  const items = useCartItems(slug)
  const loaded = useCartStore((s) => s.byStore[slug] !== undefined)
  const load = useCartStore((s) => s.load)
  const setQty = useCartStore((s) => s.setQty)
  const remove = useCartStore((s) => s.remove)
  const applyRevalidation = useCartStore((s) => s.applyRevalidation)

  const [notices, setNotices] = useState<string[]>([])
  const [revalidating, setRevalidating] = useState(false)
  const revalidatedFor = useRef<string | null>(null)

  useEffect(() => {
    if (!loaded) load(slug)
  }, [slug, loaded, load])

  // Revalidação ao abrir: um product() por item; 404 sai do mapa → removido.
  useEffect(() => {
    if (!loaded || items.length === 0 || revalidatedFor.current === slug) return
    revalidatedFor.current = slug
    let alive = true
    setRevalidating(true)
    const snapshot = [...items]
    void (async () => {
      const results = await Promise.allSettled(
        snapshot.map((item) => storefrontApi.product(slug, item.slug)),
      )
      if (!alive) return
      const fresh = new Map<Uuid, PublicProduct>()
      results.forEach((r) => {
        if (r.status === 'fulfilled') fresh.set(r.value.id, r.value)
      })
      const notes = applyRevalidation(slug, fresh)
      setNotices(notes)
      setRevalidating(false)
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, loaded])

  if (!loaded) {
    return (
      <div className="container max-w-3xl space-y-3 py-8" aria-busy="true">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="container max-w-3xl py-10">
        <EmptyState
          title="Seu carrinho está vazio"
          description="Explore a vitrine e adicione produtos para montar seu pedido."
          action={
            <Button asChild>
              <Link to={`/s/${slug}`}>
                <ShoppingBag /> Ver produtos
              </Link>
            </Button>
          }
        />
      </div>
    )
  }

  const subtotal = cartSubtotal(items)

  return (
    <div className="container max-w-3xl space-y-5 py-8">
      <h1 className="font-display text-2xl font-bold">Seu carrinho</h1>

      {notices.length > 0 && (
        <Alert variant="warning">
          <AlertTriangle />
          <AlertTitle>Atualizamos seu carrinho</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-0.5 pl-4">
              {notices.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div className="divide-y rounded-xl border bg-card shadow-sm">
        {items.map((item) => {
          const url = productImageUrl(item.image_path)
          const line = item.price * item.quantity
          return (
            <div key={item.product_id} className="flex gap-3 p-4">
              <Link
                to={`/s/${slug}/produto/${item.slug}`}
                className="h-20 w-20 shrink-0 overflow-hidden rounded-lg border bg-muted"
              >
                {url ? (
                  <img src={url} alt={item.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center font-display text-xl font-bold text-muted-foreground/40">
                    {item.name.slice(0, 1)}
                  </div>
                )}
              </Link>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex items-start justify-between gap-2">
                  <Link
                    to={`/s/${slug}/produto/${item.slug}`}
                    className="line-clamp-2 text-sm font-medium leading-snug hover:text-primary"
                  >
                    {item.name}
                  </Link>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => remove(slug, item.product_id)}
                    aria-label={`Remover ${item.name}`}
                  >
                    <Trash2 />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{brl(item.price)} cada</p>
                <div className="mt-auto flex items-center justify-between gap-2">
                  <div className="flex items-center rounded-md border shadow-sm">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-r-none"
                      onClick={() => setQty(slug, item.product_id, item.quantity - 1)}
                      aria-label="Diminuir quantidade"
                    >
                      <Minus />
                    </Button>
                    <Input
                      value={item.quantity}
                      onChange={(e) => {
                        const n = Number(e.target.value.replace(/\D/g, ''))
                        if (Number.isFinite(n) && n >= 1) setQty(slug, item.product_id, n)
                      }}
                      inputMode="numeric"
                      className="h-8 w-14 rounded-none border-0 text-center font-mono text-sm shadow-none focus-visible:ring-0"
                      aria-label={`Quantidade de ${item.name}`}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-l-none"
                      onClick={() => setQty(slug, item.product_id, item.quantity + 1)}
                      disabled={item.quantity >= 999}
                      aria-label="Aumentar quantidade"
                    >
                      <Plus />
                    </Button>
                  </div>
                  <p className="font-display text-sm font-bold">{brl(line)}</p>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="space-y-3 rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex items-baseline justify-between">
          <p className="text-sm text-muted-foreground">Subtotal</p>
          <p className="font-display text-xl font-bold">{brl(subtotal)}</p>
        </div>
        <p className="text-xs text-muted-foreground">
          Valor estimado — o valor final é confirmado no pedido.
        </p>
        <Separator />
        <p className="text-sm text-muted-foreground">
          Frete e pagamento combinados pelo WhatsApp após o pedido.
        </p>
        {revalidating ? (
          <Button size="lg" className="w-full" disabled>
            Finalizar pedido
          </Button>
        ) : (
          <Button asChild size="lg" className="w-full">
            <Link to={`/s/${slug}/checkout`}>Finalizar pedido</Link>
          </Button>
        )}
      </div>
    </div>
  )
}

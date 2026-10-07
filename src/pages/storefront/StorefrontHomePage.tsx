import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Facebook,
  Globe,
  Instagram,
  Music2,
  Search,
  Youtube,
} from 'lucide-react'
import { storefrontApi, StorefrontError } from '@/services/storefront.service'
import { useStorefrontStore } from '@/layouts/StorefrontLayout'
import { productImageUrl, storeBannerUrl } from '@/lib/media'
import { brl } from '@/lib/money'
import { errorMessage } from '@/lib/feedback'
import { cn } from '@/lib/utils'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DataPagination } from '@/components/shared/pagination'
import { EmptyState, ErrorRetryState } from '@/components/shared/page-state'
import { StorefrontNotFound } from './StorefrontNotFound'
import type { CatalogFilters, PublicCategory, PublicProduct } from '@/types/storefront'
import type { SocialLinks } from '@/types/backend'

/**
 * Vitrine pública (guia 19.2) — fala SOMENTE com a Edge storefrontApi.
 * Filtros vivem na URL (?q=&categoria=&min=&max=&estoque=1&ordem=&pagina=):
 * valores inválidos são descartados na leitura.
 */

const PAGE_SIZE = 24
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SORTS = ['newest', 'price_asc', 'price_desc', 'name_asc'] as const
type Sort = (typeof SORTS)[number]
const SORT_LABELS: Record<Sort, string> = {
  newest: 'Mais recentes',
  price_asc: 'Menor preço',
  price_desc: 'Maior preço',
  name_asc: 'A–Z',
}

const SOCIAL_ICONS: Record<keyof SocialLinks, { label: string; Icon: typeof Instagram }> = {
  instagram: { label: 'Instagram', Icon: Instagram },
  facebook: { label: 'Facebook', Icon: Facebook },
  tiktok: { label: 'TikTok', Icon: Music2 },
  youtube: { label: 'YouTube', Icon: Youtube },
  website: { label: 'Site', Icon: Globe },
}

interface ParsedFilters {
  search?: string
  category_id?: string
  min_price?: number
  max_price?: number
  in_stock?: boolean
  sort: Sort
  page: number
}

/** Lê e valida os parâmetros da URL; qualquer valor inválido é descartado. */
function parseFilters(sp: URLSearchParams): ParsedFilters {
  const out: ParsedFilters = { sort: 'newest', page: 1 }

  const q = (sp.get('q') ?? '').trim()
  if (q && q.length <= 100) out.search = q

  const cat = sp.get('categoria')
  if (cat && UUID_RE.test(cat)) out.category_id = cat

  const min = sp.get('min')
  const max = sp.get('max')
  const minN = min === null || min === '' ? null : Number(min)
  const maxN = max === null || max === '' ? null : Number(max)
  const minOk = minN !== null && Number.isFinite(minN) && minN >= 0
  const maxOk = maxN !== null && Number.isFinite(maxN) && maxN >= 0
  if (minOk && maxOk && (maxN as number) >= (minN as number)) {
    out.min_price = minN as number
    out.max_price = maxN as number
  } else if (minOk && !maxOk) {
    out.min_price = minN as number
  } else if (!minOk && maxOk) {
    out.max_price = maxN as number
  }

  if (sp.get('estoque') === '1') out.in_stock = true

  const ordem = sp.get('ordem')
  if (ordem && (SORTS as readonly string[]).includes(ordem)) out.sort = ordem as Sort

  const pagina = Number(sp.get('pagina'))
  if (Number.isInteger(pagina) && pagina >= 1 && pagina <= 1000) out.page = pagina

  return out
}

function toApiFilters(f: ParsedFilters): CatalogFilters {
  return {
    search: f.search,
    category_id: f.category_id ?? null,
    min_price: f.min_price ?? null,
    max_price: f.max_price ?? null,
    in_stock: f.in_stock,
    sort: f.sort,
    page: f.page,
    page_size: PAGE_SIZE,
  }
}

/** Contagem regressiva de Retry-After (429): devolve segundos restantes. */
function useRetryCountdown(until: number | null): number {
  const [left, setLeft] = useState(0)
  useEffect(() => {
    if (!until) {
      setLeft(0)
      return
    }
    const tick = () => setLeft(Math.max(0, Math.ceil((until - Date.now()) / 1000)))
    tick()
    const id = window.setInterval(tick, 500)
    return () => window.clearInterval(id)
  }, [until])
  return left
}

function ProductCard({ slug, product }: { slug: string; product: PublicProduct }) {
  const cover = product.images[0]
  const url = productImageUrl(cover?.path)
  return (
    <Link
      to={`/s/${slug}/produto/${product.slug}`}
      className="group flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="relative aspect-square overflow-hidden bg-muted">
        {url ? (
          <img
            src={url}
            alt={cover?.alt_text || product.name}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center font-display text-3xl font-bold text-muted-foreground/40">
            {product.name.slice(0, 1)}
          </div>
        )}
        {!product.in_stock && (
          <Badge className="absolute left-2 top-2 border-transparent bg-foreground/85 text-background">
            Esgotado
          </Badge>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3.5">
        <p className="line-clamp-2 text-sm font-medium leading-snug">{product.name}</p>
        <p className="mt-auto font-display text-base font-bold text-primary">
          {brl(product.price)}
        </p>
      </div>
    </Link>
  )
}

function GridSkeleton() {
  return (
    <div
      className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
      aria-busy="true"
      aria-label="Carregando produtos"
    >
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="overflow-hidden rounded-xl border bg-card">
          <Skeleton className="aspect-square w-full rounded-none" />
          <div className="space-y-2 p-3.5">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-5 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function StorefrontHomePage() {
  const { slug, store: ctxStore } = useStorefrontStore()
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = useMemo(() => parseFilters(searchParams), [searchParams])

  // Busca com debounce de 350 ms → URL (o AbortController vai do TanStack Query).
  const [searchText, setSearchText] = useState(filters.search ?? '')
  const debounceRef = useRef<number | null>(null)
  useEffect(() => {
    setSearchText(filters.search ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.search])

  // Preço: inputs locais sincronizados com a URL, aplicados com debounce.
  const [minText, setMinText] = useState(filters.min_price != null ? String(filters.min_price) : '')
  const [maxText, setMaxText] = useState(filters.max_price != null ? String(filters.max_price) : '')
  useEffect(() => {
    setMinText(filters.min_price != null ? String(filters.min_price) : '')
    setMaxText(filters.max_price != null ? String(filters.max_price) : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.min_price, filters.max_price])

  const [rateLimitedUntil, setRateLimitedUntil] = useState<number | null>(null)
  const retryLeft = useRetryCountdown(rateLimitedUntil)
  const rateLimited = retryLeft > 0

  const catalogQuery = useQuery({
    queryKey: ['storefront', 'catalog', slug, filters],
    queryFn: ({ signal }) => storefrontApi.catalog(slug, toApiFilters(filters), signal),
    enabled: !!slug && !rateLimited,
    retry: (failureCount, error) => {
      if (error instanceof StorefrontError) {
        if (error.status === 429) return false // respeita Retry-After (countdown manual)
        if (error.notFound || error.status === 400) return false
      }
      return failureCount < 2
    },
  })

  // 429 → desabilita ações por Retry-After segundos.
  useEffect(() => {
    const e = catalogQuery.error
    if (e instanceof StorefrontError && e.status === 429) {
      setRateLimitedUntil(Date.now() + (e.retryAfter ?? 30) * 1000)
    }
  }, [catalogQuery.error])
  useEffect(() => {
    if (!rateLimited && rateLimitedUntil) {
      setRateLimitedUntil(null)
      void catalogQuery.refetch()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rateLimited])

  /** Atualiza a URL; qualquer mudança de filtro (exceto paginação) volta para a página 1. */
  const updateParams = (patch: Record<string, string | null>, keepPage = false) => {
    const next = new URLSearchParams(searchParams)
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k)
      else next.set(k, v)
    }
    if (!keepPage) next.delete('pagina')
    setSearchParams(next, { replace: false })
  }

  const onSearchChange = (value: string) => {
    setSearchText(value)
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => updateParams({ q: value.trim() || null }), 350)
  }

  const applyPrice = () => {
    const min = minText.trim() === '' ? null : Number(minText.replace(',', '.'))
    const max = maxText.trim() === '' ? null : Number(maxText.replace(',', '.'))
    updateParams({
      min: min !== null && Number.isFinite(min) && min >= 0 ? String(min) : null,
      max: max !== null && Number.isFinite(max) && max >= 0 ? String(max) : null,
    })
  }
  const priceDebounce = useRef<number | null>(null)
  const onPriceChange = (which: 'min' | 'max', value: string) => {
    if (which === 'min') setMinText(value)
    else setMaxText(value)
    if (priceDebounce.current) window.clearTimeout(priceDebounce.current)
    priceDebounce.current = window.setTimeout(applyPrice, 500)
  }

  const clearFilters = () => {
    setSearchText('')
    setMinText('')
    setMaxText('')
    setSearchParams(new URLSearchParams(), { replace: false })
  }

  if (catalogQuery.error instanceof StorefrontError && catalogQuery.error.notFound) {
    return <StorefrontNotFound />
  }

  const data = catalogQuery.data
  const store = ctxStore ?? data?.store ?? null
  const categories = data?.categories ?? []
  const parents = categories.filter((c) => !c.parent_id)
  const childrenOf = (id: string) => categories.filter((c) => c.parent_id === id)

  const hasFilters =
    !!filters.search ||
    !!filters.category_id ||
    filters.min_price != null ||
    filters.max_price != null ||
    !!filters.in_stock

  const bannerUrl = store ? storeBannerUrl(store.banner_path) : null
  const socials = (Object.keys(SOCIAL_ICONS) as (keyof SocialLinks)[])
    .map((key) => ({ key, url: store?.social_links?.[key], ...SOCIAL_ICONS[key] }))
    .filter((s) => !!s.url)

  return (
    <div>
      {/* Banner + identidade da loja */}
      <section className="relative">
        {bannerUrl ? (
          <div className="h-44 w-full overflow-hidden sm:h-60">
            <img src={bannerUrl} alt={`Banner de ${store?.name ?? 'loja'}`} className="h-full w-full object-cover" />
          </div>
        ) : (
          <div className="h-28 w-full bg-gradient-to-r from-primary via-primary/80 to-secondary sm:h-36" />
        )}
        <div className="container -mt-8 pb-2">
          <div className="rounded-xl border bg-card p-5 shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0">
                <h1 className="font-display text-2xl font-bold text-balance">
                  {store?.title || store?.name || '…'}
                </h1>
                {store?.subtitle && (
                  <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{store.subtitle}</p>
                )}
              </div>
              {socials.length > 0 && (
                <div className="flex items-center gap-1.5">
                  {socials.map(({ key, url, label, Icon }) => (
                    <a
                      key={key}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={label}
                      title={label}
                      className="flex h-9 w-9 items-center justify-center rounded-full border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-primary hover:text-primary-foreground"
                    >
                      <Icon className="h-4 w-4" />
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <div className="container space-y-5 py-6">
        {/* Filtros */}
        <div className="grid gap-3 rounded-xl border bg-card p-4 shadow-sm md:grid-cols-[1fr_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchText}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Buscar produtos…"
              className="pl-9"
              maxLength={100}
              disabled={rateLimited}
              aria-label="Buscar produtos"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={filters.category_id ?? 'all'}
              onValueChange={(v) => updateParams({ categoria: v === 'all' ? null : v })}
              disabled={rateLimited}
            >
              <SelectTrigger className="w-[190px]" aria-label="Categoria">
                <SelectValue placeholder="Categoria" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as categorias</SelectItem>
                {parents.map((p) => {
                  const children = childrenOf(p.id)
                  return (
                    <SelectGroup key={p.id}>
                      <SelectItem value={p.id}>{p.name}</SelectItem>
                      {children.length > 0 && <SelectLabel>em {p.name}</SelectLabel>}
                      {children.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          <span className="pl-2">— {c.name}</span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )
                })}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1.5">
              <Input
                value={minText}
                onChange={(e) => onPriceChange('min', e.target.value)}
                onBlur={applyPrice}
                placeholder="Mín"
                inputMode="decimal"
                className="w-24"
                disabled={rateLimited}
                aria-label="Preço mínimo"
              />
              <span className="text-xs text-muted-foreground">até</span>
              <Input
                value={maxText}
                onChange={(e) => onPriceChange('max', e.target.value)}
                onBlur={applyPrice}
                placeholder="Máx"
                inputMode="decimal"
                className="w-24"
                disabled={rateLimited}
                aria-label="Preço máximo"
              />
            </div>
            <Select
              value={filters.sort}
              onValueChange={(v) => updateParams({ ordem: v === 'newest' ? null : v })}
              disabled={rateLimited}
            >
              <SelectTrigger className="w-[160px]" aria-label="Ordenação">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORTS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {SORT_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm shadow-sm">
              <Checkbox
                checked={!!filters.in_stock}
                onCheckedChange={(checked) =>
                  updateParams({ estoque: checked === true ? '1' : null })
                }
                disabled={rateLimited}
                aria-label="Somente em estoque"
              />
              Em estoque
            </label>
          </div>
        </div>

        {rateLimited && (
          <Alert variant="warning">
            <AlertTitle>Muitas tentativas</AlertTitle>
            <AlertDescription>
              Aguarde {retryLeft}s para continuar navegando.
            </AlertDescription>
          </Alert>
        )}

        {/* Lista de produtos */}
        {catalogQuery.isPending ? (
          <GridSkeleton />
        ) : catalogQuery.isError && !rateLimited ? (
          <ErrorRetryState
            description={errorMessage(catalogQuery.error)}
            onRetry={() => void catalogQuery.refetch()}
            retrying={catalogQuery.isRefetching}
          />
        ) : data && data.products.length === 0 ? (
          <EmptyState
            title="Nenhum produto encontrado"
            description={
              hasFilters
                ? 'Nada corresponde aos filtros aplicados. Tente ajustar a busca.'
                : 'Esta loja ainda não publicou produtos.'
            }
            action={
              hasFilters ? (
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  Limpar filtros
                </Button>
              ) : undefined
            }
          />
        ) : data ? (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {data.products.map((p) => (
                <ProductCard key={p.id} slug={slug} product={p} />
              ))}
            </div>
            <DataPagination
              page={data.page}
              total={data.total}
              pageSize={data.page_size}
              onPage={(page) => {
                updateParams({ pagina: page > 1 ? String(page) : null }, true)
                window.scrollTo({ top: 0, behavior: 'smooth' })
              }}
            />
          </>
        ) : null}
      </div>
    </div>
  )
}

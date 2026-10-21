import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { Link, Outlet, useParams } from 'react-router-dom'
import { ShoppingBag, Store } from 'lucide-react'
import { ErrorRetryState } from '@/components/shared/page-state'
import { StorefrontError, storefrontApi } from '@/services/storefront.service'
import { storeLogoUrl } from '@/lib/media'
import { cartCount, useCartItems, useCartStore } from '@/stores/cart'
import type { PublicStore } from '@/types/storefront'
import { StorefrontNotFound } from '@/pages/storefront/StorefrontNotFound'

/**
 * StorefrontLayout (guia 19): carrega o cabeçalho da loja via Edge
 * (catalog com page_size=1, cache curto por slug) e aplica as cores
 * primária/secundária da loja como variáveis CSS.
 */

interface StorefrontCtx {
    slug: string
    store: PublicStore | null
    reloadStore: () => void
}
const Ctx = createContext<StorefrontCtx>({ slug: '', store: null, reloadStore: () => { } })
export const useStorefrontStore = () => useContext(Ctx)

/** Cache curto em memória por slug (permitido pelo guia 19.1). */
const storeCache = new Map<string, { store: PublicStore; at: number }>()
const CACHE_MS = 60_000

function hexToHsl(hex: string): string | null {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
    if (!m) return null
    const n = parseInt(m[1], 16)
    const r = ((n >> 16) & 255) / 255
    const g = ((n >> 8) & 255) / 255
    const b = (n & 255) / 255
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const l = (max + min) / 2
    const d = max - min
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
    let h = 0
    if (d !== 0) {
        if (max === r) h = 60 * (((g - b) / d) % 6)
        else if (max === g) h = 60 * ((b - r) / d + 2)
        else h = 60 * ((r - g) / d + 4)
    }
    return `${Math.round((h + 360) % 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`
}

export function StorefrontLayout() {
    const params = useParams();
    const storeSlug = params?.storeSlug || '';
    const [store, setStore] = useState<PublicStore | null>(storeCache.get(storeSlug)?.store ?? null)
    const [failed, setFailed] = useState(false)
    const [loadError, setLoadError] = useState(false)
    const [tick, setTick] = useState(0)
    const items = useCartItems(storeSlug)
    const loadCart = useCartStore((s) => s.load)

    useEffect(() => {
        loadCart(storeSlug)
    }, [storeSlug, loadCart])

    useEffect(() => {
        let alive = true
        const cached = storeCache.get(storeSlug)
        if (cached && Date.now() - cached.at < CACHE_MS) {
            setStore(cached.store)
            setFailed(false)
            setLoadError(false)
            return
        }
        setStore(null)
        setFailed(false)
        setLoadError(false)
        storefrontApi
            .catalog(storeSlug, { page_size: 1 })
            .then((data) => {
                if (!alive) return
                storeCache.set(storeSlug, { store: data.store, at: Date.now() })
                setStore(data.store)
            })
            .catch((error: unknown) => {
                if (!alive) return
                if (error instanceof StorefrontError && error.notFound) setFailed(true)
                else setLoadError(true)
            })
        return () => {
            alive = false
        }
    }, [storeSlug, tick])

    const themeVars = useMemo(() => {
        if (!store) return undefined
        const p = hexToHsl(store.primary_color)
        const s = hexToHsl(store.secondary_color)
        return {
            ...(p ? { '--primary': p, '--ring': p } : {}),
            ...(s ? { '--secondary': s } : {}),
        } as React.CSSProperties
    }, [store])

    if (failed) return <StorefrontNotFound />
    if (loadError) {
        return (
            <div className="container py-16">
                <ErrorRetryState onRetry={() => setTick((t) => t + 1)} />
            </div>
        )
    }

    const count = cartCount(items)
    const logoUrl = store ? storeLogoUrl(store.logo_path) : null

    return (
        <Ctx.Provider value={{ slug: storeSlug, store, reloadStore: () => setTick((t) => t + 1) }}>
            <div className="min-h-screen bg-background" style={themeVars}>
                <header className="sticky top-0 z-40 border-b bg-card/90 backdrop-blur">
                    <div className="container flex h-16 items-center justify-between gap-4">
                        <Link to={`/s/${storeSlug}`} className="flex min-w-0 items-center gap-2.5">
                            {logoUrl ? (
                                <img
                                    src={logoUrl}
                                    alt={store?.name ?? 'Logo da loja'}
                                    className="h-9 w-9 rounded-lg object-cover"
                                />
                            ) : (
                                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                                    <Store className="h-4 w-4" />
                                </span>
                            )}
                            <span className="truncate font-display text-lg font-bold">
                                {store?.name ?? '…'}
                            </span>
                        </Link>
                        <Link
                            to={`/s/${storeSlug}/carrinho`}
                            className="relative flex items-center gap-2 rounded-full border bg-card px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-accent"
                        >
                            <ShoppingBag className="h-4 w-4" />
                            <span className="hidden sm:inline">Carrinho</span>
                            {count > 0 && (
                                <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 font-mono text-[10px] font-semibold text-primary-foreground">
                                    {count}
                                </span>
                            )}
                        </Link>
                    </div>
                </header>
                <main>
                    <Outlet />
                </main>
                <footer className="border-t py-8">
                    <p className="text-center text-xs text-muted-foreground">
                        Vitrine criada com{' '}
                        <a href="/" className="font-medium text-primary hover:underline">
                            VibeStore
                        </a>
                    </p>
                </footer>
            </div>
        </Ctx.Provider>
    )
}

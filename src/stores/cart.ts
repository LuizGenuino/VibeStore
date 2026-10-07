import { create } from 'zustand'
import type { Uuid } from '@/types/backend'
import type { PublicProduct } from '@/types/storefront'

/**
 * Carrinho da vitrine — localStorage["vibestore:cart:{slug}"] (guia 19.4).
 * O preço é SÓ exibição: o servidor recalcula no checkout.
 * Limites espelhados: 1..20 itens distintos, quantidade inteira 1..999, sem produto repetido.
 */
export interface CartItem {
  product_id: Uuid
  slug: string
  name: string
  price: number
  image_path: string | null
  quantity: number
}

const key = (slug: string) => `vibestore:cart:${slug}`
const MAX_ITEMS = 20
const MAX_QTY = 999

function read(slug: string): CartItem[] {
  try {
    const raw = localStorage.getItem(key(slug))
    const parsed = raw ? (JSON.parse(raw) as CartItem[]) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function write(slug: string, items: CartItem[]) {
  try {
    if (items.length === 0) localStorage.removeItem(key(slug))
    else localStorage.setItem(key(slug), JSON.stringify(items))
  } catch {
    /* storage indisponível */
  }
}

interface CartState {
  /** Itens por slug de loja (carregados sob demanda). */
  byStore: Record<string, CartItem[]>
  load: (slug: string) => void
  add: (slug: string, product: PublicProduct, quantity: number) => { ok: boolean; reason?: string }
  setQty: (slug: string, productId: Uuid, quantity: number) => void
  remove: (slug: string, productId: Uuid) => void
  clear: (slug: string) => void
  /** Revalida itens contra o catálogo atual: atualiza nome/preço, remove indisponíveis. */
  applyRevalidation: (slug: string, fresh: Map<Uuid, PublicProduct>) => string[]
}

export const useCartStore = create<CartState>((set, get) => ({
  byStore: {},

  load(slug) {
    set((s) => ({ byStore: { ...s.byStore, [slug]: read(slug) } }))
  },

  add(slug, product, quantity) {
    const items = [...(get().byStore[slug] ?? read(slug))]
    const existing = items.find((i) => i.product_id === product.id)
    if (existing) {
      existing.quantity = Math.min(MAX_QTY, existing.quantity + quantity)
    } else {
      if (items.length >= MAX_ITEMS) return { ok: false, reason: 'Carrinho cheio (máx. 20 itens).' }
      items.push({
        product_id: product.id,
        slug: product.slug,
        name: product.name,
        price: product.price,
        image_path: product.images[0]?.path ?? null,
        quantity: Math.max(1, Math.min(MAX_QTY, Math.trunc(quantity))),
      })
    }
    write(slug, items)
    set((s) => ({ byStore: { ...s.byStore, [slug]: items } }))
    return { ok: true }
  },

  setQty(slug, productId, quantity) {
    const q = Math.trunc(quantity)
    let items = (get().byStore[slug] ?? []).map((i) =>
      i.product_id === productId ? { ...i, quantity: Math.max(1, Math.min(MAX_QTY, q)) } : i,
    )
    if (q <= 0) items = items.filter((i) => i.product_id !== productId)
    write(slug, items)
    set((s) => ({ byStore: { ...s.byStore, [slug]: items } }))
  },

  remove(slug, productId) {
    const items = (get().byStore[slug] ?? []).filter((i) => i.product_id !== productId)
    write(slug, items)
    set((s) => ({ byStore: { ...s.byStore, [slug]: items } }))
  },

  clear(slug) {
    write(slug, [])
    set((s) => ({ byStore: { ...s.byStore, [slug]: [] } }))
  },

  applyRevalidation(slug, fresh) {
    const notes: string[] = []
    const next: CartItem[] = []
    for (const item of get().byStore[slug] ?? []) {
      const p = fresh.get(item.product_id)
      if (!p || !p.in_stock) {
        notes.push(`"${item.name}" não está mais disponível e foi removido.`)
        continue
      }
      if (p.price !== item.price) notes.push(`O preço de "${p.name}" mudou para o valor atual.`)
      if (p.name !== item.name) notes.push(`"${item.name}" agora se chama "${p.name}".`)
      next.push({ ...item, name: p.name, price: p.price, image_path: p.images[0]?.path ?? null })
    }
    write(slug, next)
    set((s) => ({ byStore: { ...s.byStore, [slug]: next } }))
    return notes
  },
}))

export const useCartItems = (slug: string) =>
  useCartStore((s) => s.byStore[slug] ?? [])
export const cartSubtotal = (items: CartItem[]) =>
  items.reduce((acc, i) => acc + i.price * i.quantity, 0)
export const cartCount = (items: CartItem[]) => items.reduce((acc, i) => acc + i.quantity, 0)

import { supabase } from './supabase'

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }
export const LIMITS = {
  'store-logos': 2_097_152,
  'store-banners': 5_242_880,
  'product-images': 5_242_880,
} as const
export type Bucket = keyof typeof LIMITS

export class MediaError extends Error {
  constructor(public code: 'INVALID_IMAGE_TYPE' | 'IMAGE_TOO_LARGE') {
    super(code)
    this.name = 'MediaError'
  }
}

/** Validação no cliente espelhando as policies: MIME png/jpeg/webp e limite por bucket. */
export function assertImage(file: File, bucket: Bucket) {
  if (!EXT[file.type]) throw new MediaError('INVALID_IMAGE_TYPE')
  if (file.size > LIMITS[bucket]) throw new MediaError('IMAGE_TOO_LARGE')
}

export const storeMediaPath = (storeId: string, file: File) =>
  `${storeId}/${crypto.randomUUID()}.${EXT[file.type]}`
export const productMediaPath = (storeId: string, productId: string, file: File) =>
  `${storeId}/${productId}/${crypto.randomUUID()}.${EXT[file.type]}`

/** O banco guarda SÓ o caminho relativo; a URL é montada no cliente (buckets públicos). */
export const publicUrl = (bucket: Bucket, path: string | null | undefined): string | null =>
  path ? supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl : null

export const storeLogoUrl = (path: string | null | undefined) => publicUrl('store-logos', path)
export const storeBannerUrl = (path: string | null | undefined) => publicUrl('store-banners', path)
export const productImageUrl = (path: string | null | undefined) =>
  publicUrl('product-images', path)

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  Check,
  ExternalLink,
  Globe,
  ImagePlus,
  Loader2,
  Trash2,
  X,
} from 'lucide-react'
import { dashboardService } from '@/services/dashboard.service'
import { storesService } from '@/services/stores.service'
import { useAccessStore, useActiveStore, useHasStorePerm, useStoreId } from '@/stores/access'
import { BackendError } from '@/lib/rpc'
import { messageFor } from '@/lib/errors'
import { toastError, toastSuccess } from '@/lib/feedback'
import { formatPhone, maskPhoneInput, SLUG_RE, toE164 } from '@/lib/format'
import { storeBannerUrl, storeLogoUrl } from '@/lib/media'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { PageHeader } from '@/components/shared/page-header'
import { CopyButton } from '@/components/shared/copy-button'
import { FormField, CharCount } from '@/components/shared/form'
import { cn } from '@/lib/utils'
import type { SocialLinks, StoresRow, StoreUpdatePatch } from '@/types'

type FieldErrors = Partial<Record<string, string>>
type MediaKind = 'logo' | 'banner'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const SOCIAL_KEYS = ['instagram', 'facebook', 'tiktok', 'youtube', 'website'] as const

const SOCIAL_LABELS: Record<(typeof SOCIAL_KEYS)[number], string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  website: 'Site',
}

interface StoreForm {
  name: string
  title: string
  subtitle: string
  slug: string
  cnpj: string
  email: string
  whatsapp: string
  primaryColor: string
  secondaryColor: string
  socials: Record<(typeof SOCIAL_KEYS)[number], string>
}

function orderedSocials(src: SocialLinks | null | undefined): SocialLinks {
  const out: SocialLinks = {}
  for (const k of SOCIAL_KEYS) {
    const v = src?.[k]?.trim()
    if (v) out[k] = v
  }
  return out
}

function formFromStore(s: StoresRow): StoreForm {
  const links = s.social_links ?? {}
  return {
    name: s.name,
    title: s.title,
    subtitle: s.subtitle,
    slug: s.slug,
    cnpj: s.cnpj ?? '',
    email: s.email ?? '',
    whatsapp: s.whatsapp_number ? formatPhone(s.whatsapp_number) : '',
    primaryColor: (s.primary_color || '#6750A4').toLowerCase(),
    secondaryColor: (s.secondary_color || '#03A9F4').toLowerCase(),
    socials: {
      instagram: links.instagram ?? '',
      facebook: links.facebook ?? '',
      tiktok: links.tiktok ?? '',
      youtube: links.youtube ?? '',
      website: links.website ?? '',
    },
  }
}

function validate(f: StoreForm): FieldErrors {
  const errs: FieldErrors = {}
  const n = f.name.trim()
  if (n.length < 2 || n.length > 120) errs.name = 'Informe o nome da loja (2 a 120 caracteres).'
  const t = f.title.trim()
  if (t.length < 2 || t.length > 160) errs.title = 'O título deve ter entre 2 e 160 caracteres.'
  if (f.subtitle.trim().length > 300) errs.subtitle = 'Máximo de 300 caracteres.'
  const s = f.slug.trim().toLowerCase()
  if (s.length < 3 || s.length > 63 || !SLUG_RE.test(s))
    errs.slug = 'Use letras minúsculas, números e hífens (3 a 63 caracteres).'
  if (!toE164(f.whatsapp)) errs.whatsapp = 'Informe o WhatsApp com DDD, ex.: (11) 99999-9999.'
  if (f.cnpj.trim().length > 32) errs.cnpj = 'Máximo de 32 caracteres.'
  const em = f.email.trim()
  if (em && (em.length > 254 || !EMAIL_RE.test(em))) errs.email = 'E-mail inválido.'
  const invalidSocial = SOCIAL_KEYS.some((k) => {
    const v = f.socials[k].trim()
    return v !== '' && (v.length > 2048 || !/^https:\/\/\S+$/.test(v))
  })
  if (invalidSocial) errs.social = 'Use links completos começando com https://.'
  return errs
}

/** Somente campos alterados (guia 9: patch parcial). */
function buildPatch(f: StoreForm, s: StoresRow): StoreUpdatePatch {
  const patch: StoreUpdatePatch = {}
  const name = f.name.trim()
  if (name !== s.name) patch.name = name
  const title = f.title.trim()
  if (title !== s.title) patch.title = title
  const subtitle = f.subtitle.trim()
  if (subtitle !== s.subtitle) patch.subtitle = subtitle
  const slug = f.slug.trim().toLowerCase()
  if (slug !== s.slug) patch.slug = slug
  const cnpj = f.cnpj.trim() || null
  if (cnpj !== s.cnpj) patch.cnpj = cnpj
  const email = f.email.trim().toLowerCase() || null
  if (email !== s.email) patch.email = email
  const whats = toE164(f.whatsapp)
  if (whats && whats !== s.whatsapp_number) patch.whatsapp_number = whats
  if (f.primaryColor.toUpperCase() !== (s.primary_color || '').toUpperCase())
    patch.primary_color = f.primaryColor
  if (f.secondaryColor.toUpperCase() !== (s.secondary_color || '').toUpperCase())
    patch.secondary_color = f.secondaryColor
  const socials = orderedSocials(
    Object.fromEntries(SOCIAL_KEYS.map((k) => [k, f.socials[k].trim() || undefined])),
  )
  if (JSON.stringify(socials) !== JSON.stringify(orderedSocials(s.social_links)))
    patch.social_links = socials
  return patch
}

/** /app/store/settings (guia 9): dados, branding, publicação e zona de perigo. */
export default function StoreSettingsPage() {
  const store = useActiveStore()
  const storeId = useStoreId()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  const canUpdate = useHasStorePerm('store.update')
  const canBranding = useHasStorePerm('store.branding.manage')
  const canPublish = useHasStorePerm('store.publish')
  const canArchive = useHasStorePerm('store.archive')

  // Toast de boas-vindas pós-onboarding (guia 8.2 → 9).
  useEffect(() => {
    if (params.get('welcome') === '1') {
      toastSuccess(
        'Sua loja foi criada!',
        'Checklist: adicione logo e banner → crie uma categoria → cadastre um produto ativo → dê entrada no estoque → publique a loja.',
      )
      setParams({}, { replace: true })
    }
  }, [params, setParams])

  // ---- Formulário de dados -------------------------------------------------
  const [form, setForm] = useState<StoreForm | null>(null)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [saving, setSaving] = useState(false)
  const [slugConfirmPatch, setSlugConfirmPatch] = useState<StoreUpdatePatch | null>(null)

  useEffect(() => {
    if (store && !form) setForm(formFromStore(store))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store])

  async function doSave(patch: StoreUpdatePatch) {
    if (!storeId) return
    setSaving(true)
    try {
      await storesService.updateStore(storeId, patch)
      toastSuccess('Configurações salvas')
      await useAccessStore.getState().reload()
      setForm(null) // reidrata do store atualizado
    } catch (err) {
      if (err instanceof BackendError) {
        const c = err.code
        if (c === 'SLUG_ALREADY_EXISTS' || c === '23505:stores_slug_key')
          setErrors((p) => ({ ...p, slug: 'Este endereço de loja já está em uso.' }))
        else if (c === 'INVALID_STORE_SLUG') setErrors((p) => ({ ...p, slug: messageFor(c) }))
        else if (c === 'INVALID_WHATSAPP_NUMBER' || c.startsWith('23514:stores_whatsapp'))
          setErrors((p) => ({ ...p, whatsapp: messageFor('INVALID_WHATSAPP_NUMBER') }))
        else if (c === 'INVALID_SOCIAL_LINKS' || c.startsWith('23514:stores_social'))
          setErrors((p) => ({ ...p, social: messageFor('INVALID_SOCIAL_LINKS') }))
        else if (c === 'INVALID_STORE_NAME_OR_TITLE')
          setErrors((p) => ({ ...p, name: messageFor(c) }))
        else if (c.startsWith('23514:stores_email'))
          setErrors((p) => ({ ...p, email: 'E-mail inválido.' }))
        else toastError(err)
      } else {
        toastError(err)
      }
    } finally {
      setSaving(false)
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!store || !form || !canUpdate || saving) return
    const errs = validate(form)
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    const patch = buildPatch(form, store)
    if (Object.keys(patch).length === 0) {
      toastSuccess('Nada para salvar', 'Nenhum campo foi alterado.')
      return
    }
    // Troca de slug exige confirmação explícita (guia 9 — links antigos quebram).
    if (patch.slug) {
      setSlugConfirmPatch(patch)
      return
    }
    void doSave(patch)
  }

  // ---- Logo / banner ---------------------------------------------------------
  const logoInputRef = useRef<HTMLInputElement>(null)
  const bannerInputRef = useRef<HTMLInputElement>(null)
  const [mediaBusy, setMediaBusy] = useState<MediaKind | null>(null)

  async function onPickMedia(kind: MediaKind, file: File | null) {
    if (!file || !storeId || !store) return
    setMediaBusy(kind)
    try {
      await storesService.replaceStoreMedia(
        storeId,
        kind,
        file,
        kind === 'logo' ? store.logo_path : store.banner_path,
      )
      toastSuccess(kind === 'logo' ? 'Logo atualizado' : 'Banner atualizado')
      await useAccessStore.getState().reload()
    } catch (err) {
      toastError(err, 'Não foi possível enviar a imagem')
    } finally {
      setMediaBusy(null)
    }
  }

  async function onRemoveMedia(kind: MediaKind) {
    if (!storeId || !store) return
    const oldPath = kind === 'logo' ? store.logo_path : store.banner_path
    if (!oldPath) return
    setMediaBusy(kind)
    try {
      await storesService.removeStoreMedia(storeId, kind, oldPath)
      toastSuccess(kind === 'logo' ? 'Logo removido' : 'Banner removido')
      await useAccessStore.getState().reload()
    } catch (err) {
      toastError(err, 'Não foi possível remover a imagem')
    } finally {
      setMediaBusy(null)
    }
  }

  // ---- Publicação ------------------------------------------------------------
  const [publishing, setPublishing] = useState(false)
  const [unpublishOpen, setUnpublishOpen] = useState(false)
  const publishCheck = useQuery({
    queryKey: ['store', storeId, 'publish-check'],
    enabled: !!storeId && canPublish,
    queryFn: async () => {
      const [activeProducts, withStock] = await Promise.all([
        dashboardService.countProducts(storeId!, 'ACTIVE'),
        dashboardService.countProductsWithStock(storeId!),
      ])
      return { activeProducts, withStock }
    },
  })

  async function doSetPublication(next: boolean) {
    if (!storeId) return
    setPublishing(true)
    try {
      await storesService.setPublication(storeId, next)
      toastSuccess(next ? 'Loja publicada!' : 'Loja despublicada')
      await useAccessStore.getState().reload()
    } catch (err) {
      toastError(err)
    } finally {
      setPublishing(false)
    }
  }

  async function onTogglePublish(next: boolean) {
    if (!canPublish || publishing || !store) return
    if (!next) {
      setUnpublishOpen(true)
      return
    }
    const checks = publishCheck.data
    if (!checks) {
      toastError(new BackendError('UNKNOWN', ''), 'Aguarde a verificação dos requisitos')
      return
    }
    const missing: string[] = []
    if (checks.activeProducts === 0) missing.push('ao menos 1 produto ativo')
    if (checks.withStock === 0) missing.push('estoque disponível em ao menos 1 produto')
    if (missing.length > 0) {
      toastError(new BackendError('UNKNOWN', ''), `Antes de publicar: ${missing.join(' e ')}.`)
      return
    }
    await doSetPublication(true)
  }

  // ---- Arquivamento ------------------------------------------------------------
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [archiveConfirm, setArchiveConfirm] = useState('')
  const [archiveError, setArchiveError] = useState<string | null>(null)
  const [archiving, setArchiving] = useState(false)

  async function onArchive() {
    if (!storeId || !store || archiveConfirm.trim().toLowerCase() !== store.slug) return
    setArchiving(true)
    setArchiveError(null)
    try {
      await storesService.archiveStore(storeId)
      toastSuccess('Loja arquivada', 'Você pode criar uma nova loja quando quiser.')
      await useAccessStore.getState().reload()
      navigate('/app/onboarding/plan', { replace: true })
    } catch (err) {
      if (
        err instanceof BackendError &&
        (err.code === 'STORE_HAS_STOCK' || err.code === 'STORE_HAS_OPEN_ORDERS')
      ) {
        setArchiveError(err.code)
      } else {
        toastError(err)
        setArchiveOpen(false)
      }
    } finally {
      setArchiving(false)
    }
  }

  if (!store || !form) return null

  const readOnly = !canUpdate
  const publicUrl = `${window.location.origin}/s/${store.slug}`
  const logoUrl = storeLogoUrl(store.logo_path)
  const bannerUrl = storeBannerUrl(store.banner_path)

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader
        title="Configurações da loja"
        description={store.name}
        actions={
          store.is_published ? (
            <Badge variant="success">Publicada</Badge>
          ) : (
            <Badge variant="secondary">Não publicada</Badge>
          )
        }
      />

      {readOnly && (
        <Alert variant="info" className="mb-6">
          <AlertTriangle />
          <AlertTitle>Somente leitura</AlertTitle>
          <AlertDescription>
            Você não tem permissão para editar os dados desta loja.
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-6">
        {/* Identidade visual */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Identidade visual</CardTitle>
            <CardDescription>Logo (até 2 MB) e banner (até 5 MB) da vitrine.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <input
              ref={logoInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                void onPickMedia('logo', e.target.files?.[0] ?? null)
                e.target.value = ''
              }}
            />
            <input
              ref={bannerInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                void onPickMedia('banner', e.target.files?.[0] ?? null)
                e.target.value = ''
              }}
            />

            <div className="flex flex-wrap items-center gap-4">
              <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-xl border bg-muted">
                {logoUrl ? (
                  <img src={logoUrl} alt={`Logo de ${store.name}`} className="h-full w-full object-cover" />
                ) : (
                  <ImagePlus className="h-6 w-6 text-muted-foreground" />
                )}
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">Logo</p>
                <p className="text-xs text-muted-foreground">PNG, JPG ou WebP, até 2 MB.</p>
                {canBranding && (
                  <div className="flex gap-2 pt-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={mediaBusy !== null}
                      onClick={() => logoInputRef.current?.click()}
                    >
                      {mediaBusy === 'logo' ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <ImagePlus />
                      )}
                      {logoUrl ? 'Trocar' : 'Enviar'}
                    </Button>
                    {logoUrl && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={mediaBusy !== null}
                        onClick={() => onRemoveMedia('logo')}
                      >
                        <Trash2 /> Remover
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex h-32 items-center justify-center overflow-hidden rounded-xl border bg-muted">
                {bannerUrl ? (
                  <img
                    src={bannerUrl}
                    alt={`Banner de ${store.name}`}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <ImagePlus className="h-6 w-6 text-muted-foreground" />
                )}
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">Banner — PNG, JPG ou WebP, até 5 MB.</p>
                {canBranding && (
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={mediaBusy !== null}
                      onClick={() => bannerInputRef.current?.click()}
                    >
                      {mediaBusy === 'banner' ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <ImagePlus />
                      )}
                      {bannerUrl ? 'Trocar' : 'Enviar'}
                    </Button>
                    {bannerUrl && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={mediaBusy !== null}
                        onClick={() => onRemoveMedia('banner')}
                      >
                        <Trash2 /> Remover
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Cor primária" htmlFor="primaryColor">
                <div className="flex items-center gap-2">
                  <Input
                    id="primaryColor"
                    type="color"
                    value={form.primaryColor}
                    disabled={readOnly || !canBranding}
                    onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
                    className="h-10 w-16 cursor-pointer p-1"
                  />
                  <span className="font-mono text-xs text-muted-foreground">{form.primaryColor}</span>
                </div>
              </FormField>
              <FormField label="Cor secundária" htmlFor="secondaryColor">
                <div className="flex items-center gap-2">
                  <Input
                    id="secondaryColor"
                    type="color"
                    value={form.secondaryColor}
                    disabled={readOnly || !canBranding}
                    onChange={(e) => setForm({ ...form, secondaryColor: e.target.value })}
                    className="h-10 w-16 cursor-pointer p-1"
                  />
                  <span className="font-mono text-xs text-muted-foreground">
                    {form.secondaryColor}
                  </span>
                </div>
              </FormField>
            </div>
          </CardContent>
        </Card>

        {/* Dados da loja */}
        <form onSubmit={onSubmit} noValidate>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Dados da loja</CardTitle>
              <CardDescription>Informações exibidas na vitrine e usadas nos pedidos.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Nome da loja" htmlFor="name" required error={errors.name}>
                  <Input
                    id="name"
                    value={form.name}
                    maxLength={140}
                    disabled={readOnly}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </FormField>
                <FormField
                  label="Endereço (slug)"
                  htmlFor="slug"
                  required
                  error={errors.slug}
                  hint="Alterar o slug muda a URL pública da loja."
                >
                  <Input
                    id="slug"
                    value={form.slug}
                    maxLength={63}
                    disabled={readOnly}
                    className="font-mono"
                    onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })}
                  />
                </FormField>
              </div>

              <FormField label="Título da vitrine" htmlFor="title" required error={errors.title}>
                <Input
                  id="title"
                  value={form.title}
                  maxLength={180}
                  disabled={readOnly}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                />
              </FormField>

              <FormField label="Subtítulo" htmlFor="subtitle" error={errors.subtitle}>
                <Textarea
                  id="subtitle"
                  value={form.subtitle}
                  rows={2}
                  disabled={readOnly}
                  onChange={(e) => setForm({ ...form, subtitle: e.target.value })}
                />
                <div className="flex justify-end pt-0.5">
                  <CharCount value={form.subtitle} max={300} />
                </div>
              </FormField>

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="WhatsApp" htmlFor="whatsapp" required error={errors.whatsapp}>
                  <Input
                    id="whatsapp"
                    inputMode="tel"
                    value={form.whatsapp}
                    disabled={readOnly}
                    onChange={(e) => setForm({ ...form, whatsapp: maskPhoneInput(e.target.value) })}
                    placeholder="(11) 99999-9999"
                  />
                </FormField>
                <FormField label="E-mail de contato" htmlFor="storeEmail" error={errors.email}>
                  <Input
                    id="storeEmail"
                    type="email"
                    value={form.email}
                    maxLength={254}
                    disabled={readOnly}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                </FormField>
                <FormField label="CNPJ" htmlFor="cnpj" error={errors.cnpj} hint="Opcional.">
                  <Input
                    id="cnpj"
                    value={form.cnpj}
                    maxLength={32}
                    disabled={readOnly}
                    onChange={(e) => setForm({ ...form, cnpj: e.target.value })}
                  />
                </FormField>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {SOCIAL_KEYS.map((k) => (
                  <FormField key={k} label={SOCIAL_LABELS[k]} htmlFor={`social-${k}`}>
                    <Input
                      id={`social-${k}`}
                      inputMode="url"
                      value={form.socials[k]}
                      disabled={readOnly}
                      onChange={(e) =>
                        setForm({ ...form, socials: { ...form.socials, [k]: e.target.value } })
                      }
                      placeholder="https://"
                      className={cn(errors.social && form.socials[k].trim() && 'border-destructive')}
                    />
                  </FormField>
                ))}
              </div>
              {errors.social && (
                <p className="text-xs font-medium text-destructive" role="alert">
                  {errors.social}
                </p>
              )}

              {canUpdate && (
                <div className="flex justify-end pt-2">
                  <Button type="submit" disabled={saving}>
                    {saving && <Loader2 className="animate-spin" />}
                    Salvar alterações
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </form>

        {/* Publicação */}
        {(canPublish || store.is_published) && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Publicação</CardTitle>
              <CardDescription>
                Controle se a vitrine pública está no ar.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {canPublish && (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">Loja publicada</p>
                      <p className="text-xs text-muted-foreground">
                        Despublicar tira a vitrine e o checkout do ar; o acompanhamento de pedidos
                        continua funcionando.
                      </p>
                    </div>
                    <Switch
                      checked={store.is_published}
                      disabled={publishing}
                      onCheckedChange={(v) => void onTogglePublish(v)}
                      aria-label="Loja publicada"
                    />
                  </div>

                  {!store.is_published && (
                    <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
                      <p className="text-xs font-medium text-muted-foreground">
                        Checklist para publicar
                      </p>
                      {[
                        {
                          ok: (publishCheck.data?.activeProducts ?? 0) > 0,
                          label: 'Ao menos 1 produto ativo',
                          to: '/app/catalog/products',
                        },
                        {
                          ok: (publishCheck.data?.withStock ?? 0) > 0,
                          label: 'Estoque disponível em ao menos 1 produto',
                          to: '/app/inventory',
                        },
                      ].map((item) => (
                        <div key={item.label} className="flex items-center justify-between gap-2 text-sm">
                          <span className="flex items-center gap-2">
                            {item.ok ? (
                              <Check className="h-4 w-4 text-success" />
                            ) : (
                              <X className="h-4 w-4 text-muted-foreground" />
                            )}
                            {item.label}
                          </span>
                          {!item.ok && (
                            <Button asChild variant="link" size="sm" className="h-auto p-0">
                              <Link to={item.to}>Resolver</Link>
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {store.is_published && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-3">
                  <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{publicUrl}</span>
                  <CopyButton text={publicUrl} toastTitle="Link copiado" />
                  <Button asChild variant="outline" size="sm">
                    <a href={publicUrl} target="_blank" rel="noreferrer">
                      <ExternalLink /> Abrir
                    </a>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Zona de perigo */}
        {canArchive && (
          <Card className="border-destructive/40">
            <CardHeader>
              <CardTitle className="text-base text-destructive">Zona de perigo</CardTitle>
              <CardDescription>
                Arquivar a loja é irreversível pelo aplicativo. A vitrine sai do ar e o endereço
                atual fica reservado.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="destructive"
                onClick={() => {
                  setArchiveConfirm('')
                  setArchiveError(null)
                  setArchiveOpen(true)
                }}
              >
                <Trash2 /> Arquivar loja
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Confirmação de troca de slug */}
      <AlertDialog
        open={slugConfirmPatch !== null}
        onOpenChange={(open) => !open && setSlugConfirmPatch(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Alterar o endereço da loja?</AlertDialogTitle>
            <AlertDialogDescription>
              A URL pública passará a ser{' '}
              <span className="font-mono">
                {window.location.origin}/s/{slugConfirmPatch?.slug}
              </span>
              . Links de acompanhamento de pedidos já enviados com o endereço antigo deixarão de
              funcionar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancelar</AlertDialogCancel>
            <Button
              disabled={saving}
              onClick={() => {
                const patch = slugConfirmPatch
                setSlugConfirmPatch(null)
                if (patch) void doSave(patch)
              }}
            >
              {saving && <Loader2 className="animate-spin" />}
              Confirmar novo endereço
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmação de despublicação */}
      <AlertDialog open={unpublishOpen} onOpenChange={setUnpublishOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Despublicar a loja?</AlertDialogTitle>
            <AlertDialogDescription>
              A vitrine e o checkout sairão do ar (os visitantes verão “loja indisponível”). O
              acompanhamento de pedidos já feitos continua funcionando.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={publishing}>Cancelar</AlertDialogCancel>
            <Button
              disabled={publishing}
              onClick={() => {
                setUnpublishOpen(false)
                void doSetPublication(false)
              }}
            >
              {publishing && <Loader2 className="animate-spin" />}
              Despublicar
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Arquivamento com confirmação digitada */}
      <AlertDialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Arquivar “{store.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação é irreversível pelo aplicativo. Para confirmar, digite o endereço da loja:{' '}
              <span className="font-mono font-medium">{store.slug}</span>
            </AlertDialogDescription>
          </AlertDialogHeader>

          {archiveError === 'STORE_HAS_STOCK' && (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertTitle>Estoque com saldo</AlertTitle>
              <AlertDescription>
                Zere o estoque antes de arquivar a loja.{' '}
                <Link to="/app/inventory" className="font-medium underline">
                  Ir para o estoque
                </Link>
              </AlertDescription>
            </Alert>
          )}
          {archiveError === 'STORE_HAS_OPEN_ORDERS' && (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertTitle>Pedidos em aberto</AlertTitle>
              <AlertDescription>
                Resolva os pedidos pendentes, pagos ou enviados antes de arquivar.{' '}
                <Link to="/app/orders" className="font-medium underline">
                  Ir para os pedidos
                </Link>
              </AlertDescription>
            </Alert>
          )}

          <Input
            value={archiveConfirm}
            onChange={(e) => setArchiveConfirm(e.target.value)}
            placeholder={store.slug}
            className="font-mono"
            autoFocus
          />

          <AlertDialogFooter>
            <AlertDialogCancel disabled={archiving}>Cancelar</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={archiving || archiveConfirm.trim().toLowerCase() !== store.slug}
              onClick={() => void onArchive()}
            >
              {archiving && <Loader2 className="animate-spin" />}
              Arquivar definitivamente
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

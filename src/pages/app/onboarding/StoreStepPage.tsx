import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Check, Loader2, X } from 'lucide-react'
import { RESERVED_SLUGS, storesService } from '@/services/stores.service'
import { BackendError } from '@/lib/rpc'
import { messageFor } from '@/lib/errors'
import { toastError, toastSuccess } from '@/lib/feedback'
import { maskPhoneInput, slugify, SLUG_RE, toE164 } from '@/lib/format'
import { useAccessStore } from '@/stores/access'
import { ONBOARDING_PLAN_KEY } from '@/pages/app/onboarding/PlanStepPage'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FormField, CharCount } from '@/components/shared/form'
import { ForbiddenState } from '@/components/shared/page-state'
import { cn } from '@/lib/utils'
import type { CreateStoreInput, SocialLinks } from '@/types'

type SlugStatus = 'idle' | 'checking' | 'available' | 'unavailable' | 'invalid'
type FieldErrors = Partial<Record<string, string>>

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const SOCIAL_FIELDS = [
  { key: 'instagram', label: 'Instagram', placeholder: 'https://instagram.com/sualoja' },
  { key: 'facebook', label: 'Facebook', placeholder: 'https://facebook.com/sualoja' },
  { key: 'tiktok', label: 'TikTok', placeholder: 'https://tiktok.com/@sualoja' },
  { key: 'youtube', label: 'YouTube', placeholder: 'https://youtube.com/@sualoja' },
  { key: 'website', label: 'Site', placeholder: 'https://www.sualoja.com.br' },
] as const satisfies ReadonlyArray<{ key: keyof SocialLinks; label: string; placeholder: string }>

/** Formato local do slug (espelha o CHECK do banco, guia 8.2). */
function slugFormatOk(s: string): boolean {
  return s.length >= 3 && s.length <= 63 && SLUG_RE.test(s) && !RESERVED_SLUGS.includes(s)
}

/** Passo 2 do onboarding (guia 8.2): dados da loja + validações espelhando o backend. */
export default function StoreStepPage() {
  const navigate = useNavigate()
  const [planId] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(ONBOARDING_PLAN_KEY)
    } catch {
      return null
    }
  })

  useEffect(() => {
    if (!planId) navigate('/app/onboarding/plan', { replace: true })
  }, [planId, navigate])

  const [name, setName] = useState('')
  const [title, setTitle] = useState('')
  const [subtitle, setSubtitle] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [slugStatus, setSlugStatus] = useState<SlugStatus>('idle')
  const [whatsapp, setWhatsapp] = useState('')
  const [cnpj, setCnpj] = useState('')
  const [email, setEmail] = useState('')
  const [primaryColor, setPrimaryColor] = useState('#6750A4')
  const [secondaryColor, setSecondaryColor] = useState('#03A9F4')
  const [socials, setSocials] = useState<Record<keyof SocialLinks, string>>({
    instagram: '',
    facebook: '',
    tiktok: '',
    youtube: '',
    website: '',
  })
  const [errors, setErrors] = useState<FieldErrors>({})
  const [saving, setSaving] = useState(false)
  const [forbidden, setForbidden] = useState<string | null>(null)

  // Disponibilidade do slug com debounce de 400 ms (guia 8.2).
  const slugSeq = useRef(0)
  useEffect(() => {
    const s = slug.trim().toLowerCase()
    const seq = ++slugSeq.current
    if (!s) {
      setSlugStatus('idle')
      return
    }
    if (!slugFormatOk(s)) {
      setSlugStatus('invalid')
      return
    }
    setSlugStatus('checking')
    const timer = setTimeout(() => {
      storesService
        .checkSlug(s)
        .then((r) => {
          if (slugSeq.current !== seq) return
          setSlugStatus(r.valid && r.available ? 'available' : 'unavailable')
        })
        .catch(() => {
          if (slugSeq.current === seq) setSlugStatus('idle')
        })
    }, 400)
    return () => clearTimeout(timer)
  }, [slug])

  if (!planId) return null
  if (forbidden) return <ForbiddenState />

  function validate(): FieldErrors {
    const errs: FieldErrors = {}
    const n = name.trim()
    if (n.length < 2 || n.length > 120) errs.name = 'Informe o nome da loja (2 a 120 caracteres).'
    const t = title.trim()
    if (t && (t.length < 2 || t.length > 160))
      errs.title = 'O título deve ter entre 2 e 160 caracteres (ou fique vazio).'
    if (subtitle.trim().length > 300) errs.subtitle = 'Máximo de 300 caracteres.'
    const s = slug.trim().toLowerCase()
    if (!s) errs.slug = 'Informe o endereço da loja.'
    else if (s.length < 3 || s.length > 63) errs.slug = 'Use de 3 a 63 caracteres.'
    else if (!SLUG_RE.test(s)) errs.slug = 'Use apenas letras minúsculas, números e hífens.'
    else if (RESERVED_SLUGS.includes(s)) errs.slug = 'Este endereço é reservado.'
    if (!toE164(whatsapp)) errs.whatsapp = 'Informe o WhatsApp com DDD, ex.: (11) 99999-9999.'
    const c = cnpj.trim()
    if (c.length > 32) errs.cnpj = 'Máximo de 32 caracteres.'
    const em = email.trim()
    if (em && (em.length > 254 || !EMAIL_RE.test(em))) errs.email = 'E-mail inválido.'
    const invalidSocial = SOCIAL_FIELDS.some(({ key }) => {
      const v = socials[key].trim()
      return v !== '' && (v.length > 2048 || !/^https:\/\/\S+$/.test(v))
    })
    if (invalidSocial) errs.social = 'Use links completos começando com https://.'
    return errs
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (saving) return
    const errs = validate()
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    const s = slug.trim().toLowerCase()
    if (slugStatus === 'unavailable') {
      setErrors((p) => ({ ...p, slug: 'Este endereço de loja já está em uso.' }))
      return
    }
    if (slugStatus === 'checking') {
      setErrors((p) => ({ ...p, slug: 'Aguarde a verificação do endereço.' }))
      return
    }

    const socialLinks: SocialLinks = {}
    for (const { key } of SOCIAL_FIELDS) {
      const v = socials[key].trim()
      if (v) socialLinks[key] = v
    }
    const input: CreateStoreInput = {
      name: name.trim(),
      title: title.trim() || null,
      subtitle: subtitle.trim() || null,
      slug: s,
      whatsapp_number: toE164(whatsapp)!,
      cnpj: cnpj.trim() || null,
      email: email.trim().toLowerCase() || null,
      primary_color: primaryColor,
      secondary_color: secondaryColor,
      social_links: socialLinks,
    }

    setSaving(true)
    try {
      await storesService.createStore(planId!, input)
      try {
        sessionStorage.removeItem(ONBOARDING_PLAN_KEY)
      } catch {
        /* noop */
      }
      toastSuccess('Loja criada!', 'Agora complete a vitrine para começar a vender.')
      await useAccessStore.getState().reload()
      navigate('/app/store/settings?welcome=1', { replace: true })
    } catch (err) {
      if (err instanceof BackendError) {
        switch (err.code) {
          case 'SLUG_ALREADY_EXISTS':
            setSlugStatus('unavailable')
            setErrors((p) => ({ ...p, slug: 'Este endereço de loja já está em uso. Sugestão: ajuste o endereço.' }))
            break
          case 'INVALID_STORE_SLUG':
            setErrors((p) => ({ ...p, slug: messageFor(err.code) }))
            break
          case 'INVALID_WHATSAPP_NUMBER':
            setErrors((p) => ({ ...p, whatsapp: messageFor(err.code) }))
            break
          case 'INVALID_SOCIAL_LINKS':
            setErrors((p) => ({ ...p, social: messageFor(err.code) }))
            break
          case 'INVALID_STORE_NAME_OR_TITLE':
            setErrors((p) => ({ ...p, name: messageFor(err.code), title: messageFor(err.code) }))
            break
          case 'ACTIVE_STORE_ALREADY_EXISTS':
            // Outra aba já criou a loja: recarrega o acesso e vai para o painel.
            await useAccessStore.getState().reload()
            navigate('/app', { replace: true })
            return
          case 'PLAN_UNAVAILABLE':
            toastError(err)
            navigate('/app/onboarding/plan', { replace: true })
            return
          case 'STORE_CREATE_FORBIDDEN':
          case 'ACCOUNT_UNAVAILABLE':
            setForbidden(err.code)
            return
          case 'ONBOARDING_ALREADY_ARCHIVED':
            toastError(err, 'Cadastro descartado')
            break
          default:
            if (err.code.startsWith('23514:stores_email'))
              setErrors((p) => ({ ...p, email: 'E-mail inválido.' }))
            else if (err.code.startsWith('23514:stores_whatsapp'))
              setErrors((p) => ({ ...p, whatsapp: messageFor('INVALID_WHATSAPP_NUMBER') }))
            else if (err.code.startsWith('23514:stores_social'))
              setErrors((p) => ({ ...p, social: messageFor('INVALID_SOCIAL_LINKS') }))
            else toastError(err)
        }
      } else {
        toastError(err)
      }
    } finally {
      setSaving(false)
    }
  }

  const slugPreview = slug.trim().toLowerCase()

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold">Dados da sua loja</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Essas informações aparecem na sua vitrine pública.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-6" noValidate>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Identificação</CardTitle>
            <CardDescription>Nome, endereço e textos da vitrine.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField label="Nome da loja" htmlFor="name" required error={errors.name}>
              <Input
                id="name"
                value={name}
                maxLength={140}
                autoFocus
                onChange={(e) => {
                  setName(e.target.value)
                  if (!slugTouched) setSlug(slugify(e.target.value))
                }}
                placeholder="Ex.: Ateliê da Maria"
              />
            </FormField>

            <FormField
              label="Endereço da loja (slug)"
              htmlFor="slug"
              required
              error={errors.slug}
              hint="Letras minúsculas, números e hífens."
            >
              <Input
                id="slug"
                value={slug}
                maxLength={63}
                className="font-mono"
                onChange={(e) => {
                  setSlugTouched(true)
                  setSlug(e.target.value.toLowerCase())
                }}
                placeholder="atelie-da-maria"
              />
              <div className="flex items-center justify-between gap-2 pt-0.5">
                <span className="truncate font-mono text-xs text-muted-foreground">
                  {window.location.origin}/s/{slugPreview || 'sua-loja'}
                </span>
                {slugStatus === 'checking' && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Verificando…
                  </span>
                )}
                {slugStatus === 'available' && (
                  <span className="flex items-center gap-1 text-xs font-medium text-success">
                    <Check className="h-3.5 w-3.5" /> Endereço disponível
                  </span>
                )}
                {slugStatus === 'unavailable' && (
                  <span className="flex items-center gap-1 text-xs font-medium text-destructive">
                    <X className="h-3.5 w-3.5" /> Endereço em uso
                  </span>
                )}
              </div>
            </FormField>

            <FormField
              label="Título da vitrine"
              htmlFor="title"
              error={errors.title}
              hint="Se vazio, usamos o nome da loja."
            >
              <Input
                id="title"
                value={title}
                maxLength={180}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex.: Ateliê da Maria — artesanato feito à mão"
              />
            </FormField>

            <FormField label="Subtítulo" htmlFor="subtitle" error={errors.subtitle}>
              <Textarea
                id="subtitle"
                value={subtitle}
                rows={2}
                onChange={(e) => setSubtitle(e.target.value)}
                placeholder="Um resumo curto do que você vende (opcional)"
              />
              <div className="flex justify-end pt-0.5">
                <CharCount value={subtitle} max={300} />
              </div>
            </FormField>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Contato</CardTitle>
            <CardDescription>O WhatsApp recebe os pedidos da vitrine.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField label="WhatsApp" htmlFor="whatsapp" required error={errors.whatsapp}>
              <Input
                id="whatsapp"
                inputMode="tel"
                value={whatsapp}
                onChange={(e) => setWhatsapp(maskPhoneInput(e.target.value))}
                placeholder="(11) 99999-9999"
              />
            </FormField>
            <FormField label="E-mail de contato" htmlFor="email" error={errors.email}>
              <Input
                id="email"
                type="email"
                value={email}
                maxLength={254}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="contato@sualoja.com.br"
              />
            </FormField>
            <FormField label="CNPJ" htmlFor="cnpj" error={errors.cnpj} hint="Opcional, texto livre.">
              <Input
                id="cnpj"
                value={cnpj}
                maxLength={32}
                onChange={(e) => setCnpj(e.target.value)}
                placeholder="00.000.000/0000-00"
              />
            </FormField>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Aparência</CardTitle>
            <CardDescription>Cores da vitrine pública.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField label="Cor primária" htmlFor="primaryColor">
              <div className="flex items-center gap-2">
                <Input
                  id="primaryColor"
                  type="color"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="h-10 w-16 cursor-pointer p-1"
                />
                <span className="font-mono text-xs text-muted-foreground">{primaryColor}</span>
              </div>
            </FormField>
            <FormField label="Cor secundária" htmlFor="secondaryColor">
              <div className="flex items-center gap-2">
                <Input
                  id="secondaryColor"
                  type="color"
                  value={secondaryColor}
                  onChange={(e) => setSecondaryColor(e.target.value)}
                  className="h-10 w-16 cursor-pointer p-1"
                />
                <span className="font-mono text-xs text-muted-foreground">{secondaryColor}</span>
              </div>
            </FormField>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Redes sociais</CardTitle>
            <CardDescription>Opcionais — deixe em branco as que não usar.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {SOCIAL_FIELDS.map(({ key, label, placeholder }) => (
                <FormField key={key} label={label} htmlFor={`social-${key}`}>
                  <Input
                    id={`social-${key}`}
                    inputMode="url"
                    value={socials[key]}
                    onChange={(e) => setSocials((p) => ({ ...p, [key]: e.target.value }))}
                    placeholder={placeholder}
                    className={cn(errors.social && socials[key].trim() && 'border-destructive')}
                  />
                </FormField>
              ))}
            </div>
            {errors.social && (
              <p className="text-xs font-medium text-destructive" role="alert">
                {errors.social}
              </p>
            )}
          </CardContent>
        </Card>

        <div className="flex items-center justify-between gap-3 pb-4">
          <Button
            type="button"
            variant="ghost"
            onClick={() => navigate('/app/onboarding/plan')}
            disabled={saving}
          >
            <ArrowLeft /> Voltar
          </Button>
          <Button type="submit" size="lg" disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            Criar minha loja
          </Button>
        </div>
      </form>
    </div>
  )
}

import { useContext, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import {
    AlertTriangle,
    CheckCircle2,
    Loader2,
    MessageCircle,
    Timer,
} from 'lucide-react'
import { toast } from 'sonner'
import { storefrontApi, StorefrontError } from '@/services/storefront.service'
import { useStorefrontStore } from '@/layouts/StorefrontLayout'
import { cartSubtotal, useCartItems, useCartStore } from '@/stores/cart'
import { submitCheckout } from '@/stores/checkout'
import { UFS } from '@/lib/constants'
import { brl } from '@/lib/money'
import { formatDateTime, maskCepInput, maskPhoneInput, toE164 } from '@/lib/format'
import { errorMessage, toastError } from '@/lib/feedback'
import { messageFor } from '@/lib/errors'
import { productImageUrl } from '@/lib/media'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { CharCount, FormField } from '@/components/shared/form'
import { CopyButton } from '@/components/shared/copy-button'
import type { CheckoutData, CheckoutInput } from '@/types/storefront'
import type { PublicProduct } from '@/types/storefront'
import type { Uuid } from '@/types/backend'
import { LoadContext } from '@/router'

/**
 * Checkout público (guia 19.5): SEM login e SEM lookup por telefone
 * (não existe endpoint, por privacidade). Idempotência (request_id +
 * client_secret por intenção, retry com a MESMA chave) fica no store
 * `submitCheckout` — a página só trata erros e reexibe o botão.
 */

interface FormState {
    full_name: string
    phone: string
    postal_code: string
    street: string
    number: string
    complement: string
    district: string
    city: string
    state: string
    note: string
}

const EMPTY_FORM: FormState = {
    full_name: '',
    phone: '',
    postal_code: '',
    street: '',
    number: '',
    complement: '',
    district: '',
    city: '',
    state: '',
    note: '',
}

type FieldErrors = Partial<Record<keyof FormState | 'address', string>>

/** Validação no cliente espelhando a Edge (guia 19.5). */
function validate(form: FormState): FieldErrors {
    const errors: FieldErrors = {}
    const name = form.full_name.trim()
    if (name.length < 2 || name.length > 120) errors.full_name = 'Informe seu nome completo (2 a 120 caracteres).'
    if (!toE164(form.phone)) errors.phone = messageFor('INVALID_PHONE')
    if (form.postal_code.replace(/\D/g, '').length !== 8) errors.postal_code = 'CEP inválido (8 dígitos).'
    for (const key of ['street', 'number', 'district', 'city'] as const) {
        const v = form[key].trim()
        if (v.length < 1 || v.length > 160)
            errors[key] = 'Obrigatório (até 160 caracteres).'
    }
    if (!(UFS as readonly string[]).includes(form.state)) errors.state = 'Selecione a UF.'
    if (form.complement.trim().length > 160) errors.complement = 'Máximo de 160 caracteres.'
    if (form.note.length > 1000) errors.note = 'Máximo de 1000 caracteres.'
    return errors
}

function useCountdown(until: number | null): number {
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

export default function StorefrontCheckoutPage() {
    const { slug } = useStorefrontStore()
    const navigate = useNavigate()
    const items = useCartItems(slug)
    const applyRevalidation = useCartStore((s) => s.applyRevalidation)
    const { setLoading } = useContext(LoadContext)

    const [form, setForm] = useState<FormState>(EMPTY_FORM)
    const [errors, setErrors] = useState<FieldErrors>({})
    const [submitting, setSubmitting] = useState(false)
    const [networkError, setNetworkError] = useState<string | null>(null)
    const [blockedUntil, setBlockedUntil] = useState<number | null>(null)
    const retryLeft = useCountdown(blockedUntil)
    const blocked = retryLeft > 0

    // busca endereço pelo CEP (guia 19.5) e preenche os campos do formulário.
    useEffect(() => {
        const cleanCep = form.postal_code?.replace(/\D/g, '') || ''

        // Só prossegue se tiver exatamente 8 dígitos
        if (cleanCep.length !== 8) return

        const controller = new AbortController()

        // 1. Agenda a busca para 400ms após a última digitação
        const timeoutId = setTimeout(async () => {
            setLoading(true)

            // Limpa erro anterior ao disparar a busca
            setErrors((prev) => {
                if (!prev.postal_code) return prev
                const { postal_code, ...rest } = prev
                return rest
            })

            try {
                const res = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`, {
                    signal: controller.signal,
                })

                if (!res.ok) throw new Error(`HTTP ${res.status}`)

                const data = await res.json()

                if (data.erro) {
                    setErrors((prev) => ({ ...prev, postal_code: 'CEP não encontrado.' }))
                    return
                }

                setForm((prev) => ({
                    ...prev,
                    street: data.logradouro || '',
                    district: data.bairro || '',
                    city: data.localidade || '',
                    state: data.uf || '',
                }))
            } catch (err: any) {
                if (err.name === 'AbortError') return
                setErrors((prev) => ({ ...prev, postal_code: 'Falha ao buscar o CEP.' }))
            } finally {
                if (!controller.signal.aborted) {
                    setLoading(false)
                }
            }
        }, 400) // 400ms de atraso

        // 2. Limpeza: se o usuário digitar outro caractere antes dos 400ms, cancela o timer e a requisição
        return () => {
            clearTimeout(timeoutId)
            controller.abort()
        }
    }, [form.postal_code])


    const subtotal = useMemo(() => cartSubtotal(items), [items])

    const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        let v = e.target.value
        if (key === 'phone') v = maskPhoneInput(v)
        if (key === 'postal_code') v = maskCepInput(v)
        setForm((f) => ({ ...f, [key]: v }))
        setErrors((prev) => ({ ...prev, [key]: undefined, address: undefined }))
        setNetworkError(null)
    }

    /** 409: revalida o carrinho contra a Edge e volta para a tela do carrinho. */
    const revalidateAndGoBack = async () => {
        const snapshot = useCartStore.getState().byStore[slug] ?? []
        const results = await Promise.allSettled(
            snapshot.map((item) => storefrontApi.product(slug, item.slug)),
        )
        const fresh = new Map<Uuid, PublicProduct>()
        results.forEach((r) => {
            if (r.status === 'fulfilled') fresh.set(r.value.id, r.value)
        })
        applyRevalidation(slug, fresh)
        navigate(`/s/${slug}/carrinho`)
    }

    const onSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (submitting || blocked) return
        const fieldErrors = validate(form)
        setErrors(fieldErrors)
        if (Object.values(fieldErrors).some(Boolean)) return

        const phone = toE164(form.phone)
        if (!phone) return // já coberto por validate

        const input: CheckoutInput = {
            customer: { full_name: form.full_name.trim(), phone },
            address: {
                postal_code: form.postal_code.replace(/\D/g, ''),
                street: form.street.trim(),
                number: form.number.trim(),
                ...(form.complement.trim() ? { complement: form.complement.trim() } : {}),
                district: form.district.trim(),
                city: form.city.trim(),
                state: form.state,
            },
            items: items.map((i) => ({ product_id: i.product_id, quantity: i.quantity })),
            ...(form.note.trim() ? { note: form.note.trim() } : {}),
        }

        setSubmitting(true)
        setNetworkError(null)
        try {
            const data = await submitCheckout(slug, input)
            // Sucesso — inclusive replayed=true (a reserva NÃO é renovada).
            navigate(`/s/${slug}/pedido/sucesso`, {
                state: data,
            })
        } catch (err) {
            if (err instanceof StorefrontError) {
                if (err.status === 429) {
                    // Aguardar Retry-After; o retry usa a MESMA chave (o store já garante).
                    setBlockedUntil(Date.now() + (err.retryAfter ?? 30) * 1000)
                    toast.error('Muitas tentativas', {
                        description: `Aguarde ${err.retryAfter ?? 30}s para tentar novamente.`,
                    })
                } else if (err.status === 400 && err.code === 'INVALID_PHONE') {
                    setErrors({ phone: messageFor('INVALID_PHONE') })
                } else if (err.status === 400 && err.code === 'INVALID_ADDRESS') {
                    setErrors({ address: messageFor('INVALID_ADDRESS') })
                } else if (err.status === 409 && err.code === 'PRODUCT_UNAVAILABLE') {
                    toastError(err, 'Um produto ficou indisponível')
                    await revalidateAndGoBack()
                } else if (err.status === 409 && err.code === 'INSUFFICIENT_AVAILABLE_STOCK') {
                    toast.error('Quantidade indisponível em estoque', {
                        description: 'Reduza as quantidades no carrinho e tente novamente.',
                    })
                    await revalidateAndGoBack()
                } else if (err.status === 0 || err.status === 503) {
                    // Rede / serviço indisponível: "Tentar novamente" usa a MESMA chave (store).
                    setNetworkError(errorMessage(err))
                } else {
                    toastError(err)
                }
            } else {
                toastError(err)
            }
        } finally {
            setSubmitting(false)
        }
    }


    // Carrinho vazio (e sem confirmação em tela) → volta para o carrinho.
    if (items.length === 0) return <Navigate to={`/s/${slug}/carrinho`} replace />

    return (
        <div className="container max-w-4xl py-8">
            <h1 className="mb-6 font-display text-2xl font-bold">Finalizar pedido</h1>
            <div className="grid gap-6 md:grid-cols-[1fr_320px]">
                {/* Formulário */}
                <form onSubmit={onSubmit} className="space-y-5 rounded-xl border bg-card p-5 shadow-sm" noValidate>
                    <section className="space-y-4">
                        <h2 className="font-display text-base font-semibold">Seus dados</h2>
                        <FormField label="Nome completo" htmlFor="ck-name" error={errors.full_name} required>
                            <Input
                                id="ck-name"
                                value={form.full_name}
                                onChange={set('full_name')}
                                maxLength={120}
                                autoComplete="name"
                                placeholder="Como devemos te chamar?"
                            />
                        </FormField>
                        <FormField
                            label="Telefone (WhatsApp)"
                            htmlFor="ck-phone"
                            error={errors.phone}
                            hint="Usado pela loja para combinar frete e pagamento."
                            required
                        >
                            <Input
                                id="ck-phone"
                                value={form.phone}
                                onChange={set('phone')}
                                inputMode="tel"
                                autoComplete="tel"
                                placeholder="(11) 99999-9999"
                            />
                        </FormField>
                    </section>

                    <Separator />

                    <section className="space-y-4">
                        <h2 className="font-display text-base font-semibold">Endereço de entrega</h2>
                        {errors.address && (
                            <Alert variant="destructive">
                                <AlertTriangle />
                                <AlertDescription>{errors.address}</AlertDescription>
                            </Alert>
                        )}
                        <div className="grid gap-4 sm:grid-cols-2">
                            <FormField label="CEP" htmlFor="ck-cep" error={errors.postal_code} required>
                                <Input
                                    id="ck-cep"
                                    value={form.postal_code}
                                    onChange={set('postal_code')}
                                    inputMode="numeric"
                                    autoComplete="postal-code"
                                    placeholder="00000-000"
                                />
                            </FormField>
                            <FormField label="Bairro" htmlFor="ck-district" error={errors.district} required>
                                <Input
                                    id="ck-district"
                                    value={form.district}
                                    onChange={set('district')}
                                    maxLength={160}
                                />
                            </FormField>
                        </div>
                        <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
                            <FormField label="Rua" htmlFor="ck-street" error={errors.street} required>
                                <Input
                                    id="ck-street"
                                    value={form.street}
                                    onChange={set('street')}
                                    maxLength={160}
                                    autoComplete="address-line1"
                                />
                            </FormField>
                            <FormField label="Número" htmlFor="ck-number" error={errors.number} required>
                                <Input
                                    id="ck-number"
                                    value={form.number}
                                    onChange={set('number')}
                                    maxLength={160}
                                />
                            </FormField>
                        </div>
                        <FormField label="Complemento" htmlFor="ck-complement" error={errors.complement}>
                            <Input
                                id="ck-complement"
                                value={form.complement}
                                onChange={set('complement')}
                                maxLength={160}
                                placeholder="Apto, bloco, ponto de referência… (opcional)"
                            />
                        </FormField>
                        <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
                            <FormField label="Cidade" htmlFor="ck-city" error={errors.city} required>
                                <Input id="ck-city" value={form.city} onChange={set('city')} maxLength={160} />
                            </FormField>
                            <FormField label="UF" htmlFor="ck-state" error={errors.state} required>
                                <Select
                                    value={form.state}
                                    onValueChange={(v) => {
                                        setForm((f) => ({ ...f, state: v }))
                                        setErrors((prev) => ({ ...prev, state: undefined }))
                                    }}
                                >
                                    <SelectTrigger id="ck-state" aria-label="UF">
                                        <SelectValue placeholder="UF" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {UFS.map((uf) => (
                                            <SelectItem key={uf} value={uf}>
                                                {uf}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </FormField>
                        </div>
                    </section>

                    <Separator />

                    <section className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h2 className="font-display text-base font-semibold">Observação</h2>
                            <CharCount value={form.note} max={1000} />
                        </div>
                        <FormField label="" error={errors.note}>
                            <Textarea
                                value={form.note}
                                onChange={set('note')}
                                maxLength={1000}
                                rows={3}
                                placeholder="Algo que a loja deva saber? (opcional)"
                                aria-label="Observação do pedido"
                            />
                        </FormField>
                    </section>

                    {networkError && (
                        <Alert variant="destructive">
                            <AlertTriangle />
                            <AlertTitle>Falha ao enviar</AlertTitle>
                            <AlertDescription>{networkError} Seus dados foram mantidos.</AlertDescription>
                        </Alert>
                    )}
                    {blocked && (
                        <Alert variant="warning">
                            <Timer />
                            <AlertDescription>
                                Muitas tentativas. Você poderá reenviar em {retryLeft}s.
                            </AlertDescription>
                        </Alert>
                    )}

                    <Button type="submit" size="lg" className="w-full" disabled={submitting || blocked}>
                        {submitting && <Loader2 className="animate-spin" />}
                        {blocked
                            ? `Aguarde ${retryLeft}s`
                            : networkError
                                ? 'Tentar novamente'
                                : 'Confirmar pedido'}
                    </Button>
                    <p className="text-center text-xs text-muted-foreground">
                        Frete e pagamento combinados pelo WhatsApp após o pedido.
                    </p>
                </form>

                {/* Resumo */}
                <aside className="h-fit space-y-3 rounded-xl border bg-card p-5 shadow-sm md:sticky md:top-20">
                    <h2 className="font-display text-base font-semibold">Resumo</h2>
                    <ul className="space-y-3">
                        {items.map((item) => {
                            const url = productImageUrl(item.image_path)
                            return (
                                <li key={item.product_id} className="flex items-center gap-3">
                                    <div className="h-11 w-11 shrink-0 overflow-hidden rounded-md border bg-muted">
                                        {url && <img src={url} alt="" className="h-full w-full object-cover" />}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-medium">{item.name}</p>
                                        <p className="font-mono text-xs text-muted-foreground">
                                            {item.quantity} × {brl(item.price)}
                                        </p>
                                    </div>
                                    <p className="text-sm font-semibold">{brl(item.price * item.quantity)}</p>
                                </li>
                            )
                        })}
                    </ul>
                    <Separator />
                    <div className="flex items-baseline justify-between">
                        <span className="text-sm text-muted-foreground">Subtotal</span>
                        <span className="font-display text-lg font-bold">{brl(subtotal)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Valor estimado — o valor final é confirmado no pedido.
                    </p>
                </aside>
            </div>
        </div>
    )
}

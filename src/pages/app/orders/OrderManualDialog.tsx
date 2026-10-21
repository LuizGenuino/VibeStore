import React, { useContext, useEffect, useState } from 'react'
import PropTypes from 'prop-types'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { CharCount, FormField } from '@/components/shared/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@radix-ui/react-switch'
import { Button } from '@/components/ui/button'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { maskCepInput, maskPhoneInput, toE164 } from '@/lib/format'
import { messageFor } from '@/lib/errors'
import { submitCheckout } from '@/stores/checkout'
import { CheckoutInput } from '@/types'
import { StorefrontError } from '@/services/storefront.service'
import { toast } from 'sonner'
import { errorMessage, toastError } from '@/lib/feedback'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { UFS } from '@/lib/constants'
import { Textarea } from '@/components/ui/textarea'
import { LoadContext } from '@/router'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { catalogService } from '@/services/catalog.service'
import { useStoreId } from '@/stores/access'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'


interface OrderForm {
    product_id: string;
    quantity: number;
}
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

function OrderManualDialog(props: any) {
    console.log('OrderManualDialog props:', props); // Debugging line
    const storeId = useStoreId()
    const { setLoading } = useContext(LoadContext)
    const [dialogOpen, setDialogOpen] = useState<boolean>(false);
    const [isAnonymous, setIsAnonymous] = useState<boolean>(true);
    const [form, setForm] = useState<FormState>(EMPTY_FORM)
    const [orderItems, setOrderItems] = useState<OrderForm[]>([]);
    const [orderSelected, setOrderSelected] = useState<OrderForm>({ product_id: '', quantity: 1 });
    const [pedidosErrors, setPedidosErrors] = useState<string[]>([]);
    const [errors, setErrors] = useState<FieldErrors>({})
    const [submitting, setSubmitting] = useState(false)
    const [networkError, setNetworkError] = useState<string | null>(null)

    const productsQuery = useQuery({
        queryKey: ['catalog', 'products', storeId],
        queryFn: () => catalogService.listProducts(storeId!, { page: 1, pageSize: 100 }),
        enabled: !!storeId,
        placeholderData: keepPreviousData,
    })

    const items = productsQuery.data?.items ?? []

    console.log('Fetched products:', items); // Debugging line

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

    function onClose() {
        setDialogOpen(false)
        setForm(EMPTY_FORM)
        setErrors({})
        setNetworkError(null)
        setSubmitting(false)
        setOrderItems([])
        setOrderSelected({ product_id: '', quantity: 1 });
        setPedidosErrors([]);
    }

    const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        let v = e.target.value
        if (key === 'phone') v = maskPhoneInput(v)
        if (key === 'postal_code') v = maskCepInput(v)
        setForm((f) => ({ ...f, [key]: v }))
        setErrors((prev) => ({ ...prev, [key]: undefined, address: undefined }))
        setNetworkError(null)
    }

    const onSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (submitting) return
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
            // items: items.map((i) => ({ product_id: i.product_id, quantity: i.quantity })),
            // ...(form.note.trim() ? { note: form.note.trim() } : {}),
            items: [], // Placeholder for items, as they are not defined in this context
        }

        setSubmitting(true)
        setNetworkError(null)
        try {
            const data = await submitCheckout('', input)
            // Sucesso — inclusive replayed=true (a reserva NÃO é renovada).

        } catch (err) {
            if (err instanceof StorefrontError) {
                if (err.status === 429) {
                    // Aguardar Retry-After; o retry usa a MESMA chave (o store já garante).
                    toast.error('Muitas tentativas', {
                        description: `Aguarde ${err.retryAfter ?? 30}s para tentar novamente.`,
                    })
                } else if (err.status === 400 && err.code === 'INVALID_PHONE') {
                    setErrors({ phone: messageFor('INVALID_PHONE') })
                } else if (err.status === 400 && err.code === 'INVALID_ADDRESS') {
                    setErrors({ address: messageFor('INVALID_ADDRESS') })
                } else if (err.status === 409 && err.code === 'PRODUCT_UNAVAILABLE') {
                    toastError(err, 'Um produto ficou indisponível')
                } else if (err.status === 409 && err.code === 'INSUFFICIENT_AVAILABLE_STOCK') {
                    toast.error('Quantidade indisponível em estoque', {
                        description: 'Reduza as quantidades no carrinho e tente novamente.',
                    })
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

    return (
        <>
            <Button onClick={() => setDialogOpen(true)}>Adicionar Manual</Button>
            {dialogOpen && (
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <DialogContent className="max-h-[98vh] overflow-y-auto">
                        <DialogHeader>
                            <DialogTitle>Adicionar Pedido Manualmente</DialogTitle>
                            <DialogDescription>
                                Adicione um pedido manualmente preenchendo os campos abaixo.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="space-y-4 border rounded-xl bg-card p-5 shadow-sm">
                            <div className="grid gap-4 sm:grid-cols-[1fr_120px] ">
                                <FormField
                                    label="Produtos"
                                    error={pedidosErrors.length > 0 ? 'Selecione pelo menos um produto.' : undefined}
                                >
                                    <Select
                                        value={orderSelected.product_id}
                                        onValueChange={(v) => setOrderSelected((f) => ({ ...f, product_id: !v ? '' : v }))}
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder="Selecione um produto" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {items.map((r) => (
                                                <SelectItem key={r.id} value={r.id}>
                                                    {r.name} (R$ {r.price.toFixed(2)})
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </FormField>
                                <FormField label="Quantidade" required>
                                    <Input
                                        inputMode="numeric"
                                        value={orderSelected.quantity}
                                        onChange={(e) => setOrderSelected({ ...orderSelected, quantity: Number(e.target.value) })}
                                        className="tabular-nums"
                                        autoFocus
                                    />
                                </FormField>
                            </div>
                            <Button className='mx-auto' onClick={() => {
                                if (!orderSelected.product_id || orderSelected.quantity < 1) {
                                    setPedidosErrors(['Selecione pelo menos um produto.']);
                                    return;
                                }
                                setOrderItems([...orderItems, orderSelected]);
                                setOrderSelected({ product_id: '', quantity: 1 });
                                setPedidosErrors([]);
                            }}>
                                Adicionar Produto
                            </Button>
                            <div className="space-y-2">
                                {orderItems.map((item, index) => {
                                    const product = items.find(p => p.id === item.product_id);
                                    return (
                                        <div key={index} className="flex justify-between items-center border p-2 rounded">
                                            <span>{product ? product.name : 'Produto não encontrado'} - Qtn: {item.quantity}</span>
                                            <Button variant="destructive" size="sm" onClick={() => {
                                                setOrderItems(orderItems.filter((_, i) => i !== index));
                                            }}>
                                                Remover
                                            </Button>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                        <div className="space-y-4">

                            <p className='text-sm font-bold mt-2' >Deseja Inserir os Dados do Cliente?</p>
                            <RadioGroup defaultValue="comfortable" onValueChange={(value) => setIsAnonymous(value === 'true')} className="space-y-2">
                                <div className="flex items-center gap-3">
                                    <RadioGroupItem checked value="true" id="r2" />
                                    <Label htmlFor="r2">Cliente Anônimo</Label>
                                </div>
                                <div>
                                    <RadioGroupItem  value="false" id="r1" />
                                    <Label htmlFor="r1" className="ml-3">Inserir Cliente</Label>

                                    {!isAnonymous && (
                                        <form onSubmit={onSubmit} className="space-y-5 rounded-xl border bg-card p-5 shadow-sm mt-2" noValidate>
                                            <section className="space-y-4">
                                                <h2 className="font-display text-base font-semibold">Dados do Cliente</h2>
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
                                        </form>
                                    )}
                                </div>

                            </RadioGroup>



                        </div>

                        <DialogFooter>
                            <Button variant="outline" onClick={onClose} disabled={submitting}>
                                Cancelar
                            </Button>
                            <Button onClick={onSubmit} disabled={submitting}>
                                {submitting && <RefreshCw className="animate-spin" />}
                                Salvar
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog >)
            }
        </>
    )
}



export default OrderManualDialog

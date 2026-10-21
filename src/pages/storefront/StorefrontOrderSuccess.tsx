import { CopyButton } from '@/components/shared/copy-button'
import { Button } from '@/components/ui/button'
import { formatDateTime } from '@/lib/format'
import { brl } from '@/lib/money'
import { Separator } from '@radix-ui/react-dropdown-menu'
import { CheckCircle2, MessageCircle, Timer } from 'lucide-react'
import { Link, Navigate, useLocation } from 'react-router-dom'

interface OrderResponse {
    code: string
    status: string
    order_id: string
    replayed: boolean
    subtotal: number
    whatsapp_number: string
    reservation_expires_at: string
    token: string
    tracking_url: string
    whatsapp_url: string
    shipping_included: boolean
}

function StorefrontOrderSuccess() {
    const location = useLocation()
    const data = location.state as OrderResponse

    if (!data) {
        return <Navigate to="/" replace />
    }
    return (
        <div className="container max-w-xl py-10">
            <div className="space-y-5 rounded-2xl border bg-card p-6 text-center shadow-sm sm:p-8">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success/10 text-success">
                    <CheckCircle2 className="h-7 w-7" />
                </div>
                <div>
                    <h1 className="font-display text-2xl font-bold">Pedido recebido!</h1>
                    <p className="mt-2 font-mono text-3xl font-bold tracking-tight text-primary">
                        {data.code}
                    </p>
                </div>
                <div className="rounded-lg bg-muted/60 p-4 text-sm">
                    <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Subtotal</span>
                        <span className="font-display text-lg font-bold">{brl(data.subtotal)}</span>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                        Frete e pagamento a combinar pelo WhatsApp.
                    </p>
                    <p className="mt-1 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                        <Timer className="h-3.5 w-3.5" />
                        Reserva do estoque válida até {formatDateTime(data.reservation_expires_at)} (24h).
                    </p>
                </div>
                <Button asChild variant="whatsapp" size="lg" className="w-full">
                    <a href={data.whatsapp_url} target="_blank" rel="noopener noreferrer">
                        <MessageCircle />
                        Enviar pedido no WhatsApp
                    </a>
                </Button>
                <div className="space-y-2">
                    <CopyButton
                        text={data.tracking_url}
                        label="Copiar link de acompanhamento"
                        toastTitle="Link copiado"
                        className="w-full"
                    />
                    <p className="text-xs text-muted-foreground">
                        Guarde este link; ele é a única forma de acompanhar o pedido.
                    </p>
                </div>
                <Separator />
                <Button asChild variant="ghost" size="sm">
                    <Link to={data.tracking_url} target="_blank" rel="noopener noreferrer" replace>
                        Acompanhar pedido agora
                    </Link>
                </Button>
            </div>
        </div>
    )
}

export default StorefrontOrderSuccess
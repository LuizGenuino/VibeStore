import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, BadgeCheck } from 'lucide-react'
import { plansService } from '@/services/plans.service'
import { brl } from '@/lib/money'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState, ErrorRetryState } from '@/components/shared/page-state'

/** Chave do wizard (guia 8.1): plano escolhido no passo 1, consumido no passo 2. */
export const ONBOARDING_PLAN_KEY = 'vibestore:onboarding-plan'

/** Passo 1 do onboarding (guia 8.1): plano FREE único, sem comparativo de pagos. */
export default function PlanStepPage() {
  const navigate = useNavigate()
  const plans = useQuery({
    queryKey: ['plans', 'active-free'],
    queryFn: () => plansService.listActiveFree(),
    staleTime: 60_000,
  })

  if (plans.isLoading) {
    return (
      <div className="mx-auto w-full max-w-xl space-y-4" aria-busy="true" aria-label="Carregando">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-44 w-full" />
      </div>
    )
  }

  if (plans.isError) {
    return (
      <div className="mx-auto w-full max-w-xl">
        <ErrorRetryState onRetry={() => plans.refetch()} retrying={plans.isRefetching} />
      </div>
    )
  }

  const plan = plans.data?.[0]
  if (!plan) {
    // 0 linhas: create_store retornaria PLAN_UNAVAILABLE (guia 8.1).
    return (
      <div className="mx-auto w-full max-w-xl">
        <EmptyState
          title="Cadastro de lojas indisponível"
          description="Não foi possível carregar o plano de cadastro no momento. Tente novamente mais tarde."
          action={
            <Button variant="outline" size="sm" onClick={() => plans.refetch()}>
              Tentar novamente
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-xl">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold">Escolha seu plano</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Comece gratuitamente e publique sua vitrine em minutos.
        </p>
      </div>

      <Card className="border-primary/40">
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-lg">{plan.name}</CardTitle>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary">
              <BadgeCheck className="h-4 w-4" />
              Gratuito — {brl(plan.price)}
            </span>
          </div>
          {plan.description && <CardDescription>{plan.description}</CardDescription>}
        </CardHeader>
        <CardContent>
          <Button
            className="w-full"
            size="lg"
            onClick={() => {
              try {
                sessionStorage.setItem(ONBOARDING_PLAN_KEY, plan.id)
              } catch {
                /* sem storage: o passo 2 redireciona de volta para cá */
              }
              navigate('/app/onboarding/store')
            }}
          >
            Continuar
            <ArrowRight />
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

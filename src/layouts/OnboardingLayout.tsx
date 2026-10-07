import { Outlet, useLocation, Link } from 'react-router-dom'
import { Check, Store } from 'lucide-react'
import { cn } from '@/lib/utils'

const STEPS = [
  { path: '/app/onboarding/plan', label: 'Plano', step: 1 },
  { path: '/app/onboarding/store', label: 'Sua loja', step: 2 },
]

/** Wizard de onboarding (guia 8): plano → loja. */
export function OnboardingLayout() {
  const { pathname } = useLocation()
  const current = STEPS.findIndex((s) => pathname.startsWith(s.path))

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b bg-card">
        <div className="container flex h-16 items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <Store className="h-4 w-4 text-white" />
            </span>
            <span className="font-display text-lg font-bold">VibeStore</span>
          </Link>
          <ol className="flex items-center gap-2 text-sm">
            {STEPS.map((s, i) => {
              const done = i < current
              const active = i === current
              return (
                <li key={s.path} className="flex items-center gap-2">
                  <span
                    className={cn(
                      'flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold',
                      done && 'bg-success text-white',
                      active && 'bg-primary text-primary-foreground',
                      !done && !active && 'bg-muted text-muted-foreground',
                    )}
                  >
                    {done ? <Check className="h-3.5 w-3.5" /> : s.step}
                  </span>
                  <span className={cn('hidden sm:inline', active ? 'font-medium' : 'text-muted-foreground')}>
                    {s.label}
                  </span>
                  {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-border" />}
                </li>
              )
            })}
          </ol>
        </div>
      </header>
      <main className="container flex flex-1 flex-col py-10">
        <Outlet />
      </main>
    </div>
  )
}

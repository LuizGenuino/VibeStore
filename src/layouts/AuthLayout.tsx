import { Link, Outlet } from 'react-router-dom'
import { Store } from 'lucide-react'

/** Layout das telas de autenticação: cartão central sobre fundo de marca. */
export function AuthLayout() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#14101d] px-4 py-10">
      {/* atmosfera: brilhos violeta/ciano */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-40 -top-40 h-[480px] w-[480px] rounded-full opacity-30 blur-3xl"
        style={{ background: 'radial-gradient(circle, #6750A4 0%, transparent 65%)' }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-48 -right-32 h-[420px] w-[420px] rounded-full opacity-20 blur-3xl"
        style={{ background: 'radial-gradient(circle, #03A9F4 0%, transparent 65%)' }}
      />
      <Link to="/" className="relative mb-8 flex items-center gap-2 text-white">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary">
          <Store className="h-5 w-5 text-white" />
        </span>
        <span className="font-display text-xl font-bold tracking-tight">VibeStore</span>
      </Link>
      <div className="relative w-full max-w-md">
        <Outlet />
      </div>
      <p className="relative mt-8 text-xs text-white/40">
        Venda pelo WhatsApp. Gerencie de verdade.
      </p>
    </div>
  )
}

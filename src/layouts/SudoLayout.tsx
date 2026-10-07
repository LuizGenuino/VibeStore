import { NavLink, Outlet, Link } from 'react-router-dom'
import { ArrowLeft, History, KeyRound, ShieldCheck, Users, Grid3X3 } from 'lucide-react'
import { cn } from '@/lib/utils'

const SUDO_NAV = [
  { to: '/sudo', label: 'Auditoria', icon: History, end: true },
  { to: '/sudo/users', label: 'Usuários', icon: Users },
  { to: '/sudo/roles', label: 'Papéis', icon: ShieldCheck },
  { to: '/sudo/permissions', label: 'Permissões', icon: KeyRound },
  { to: '/sudo/role-permissions', label: 'Matriz', icon: Grid3X3 },
]

/** Painel SUDO (guia 18) — exige can_manage_security (guard SudoOnly). */
export function SudoLayout() {
  return (
    <div className="min-h-screen bg-[#12101a] text-white">
      <header className="border-b border-white/10">
        <div className="container flex h-14 items-center gap-4">
          <Link
            to="/app"
            className="flex items-center gap-1.5 text-sm text-white/60 transition-colors hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" /> Voltar ao app
          </Link>
          <span className="h-4 w-px bg-white/15" />
          <p className="flex items-center gap-2 font-display text-sm font-semibold">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Painel SUDO
          </p>
        </div>
      </header>
      <div className="container flex flex-col gap-6 py-6 md:flex-row">
        <nav className="flex shrink-0 gap-1 overflow-x-auto md:w-48 md:flex-col">
          {SUDO_NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-white/60 transition-colors hover:bg-white/5 hover:text-white',
                  isActive && 'bg-primary/20 text-white',
                )
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

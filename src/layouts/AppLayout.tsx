import { useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  BarChart3,
  Boxes,
  ClipboardList,
  ExternalLink,
  LayoutDashboard,
  ListOrdered,
  LogOut,
  Menu,
  Package,
  Settings,
  ShieldCheck,
  Store,
  Tags,
  Users,
  Wallet,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { APP_URL } from '@/lib/constants'
import { useAuthStore } from '@/stores/auth'
import { useAccessStore, useIsSudo } from '@/stores/access'
import type { PermissionCode } from '@/types/backend'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

interface NavItem {
  to: string
  label: string
  icon: typeof LayoutDashboard
  perm: PermissionCode // permissão de loja necessária
  end?: boolean
}

const NAV: NavItem[] = [
  { to: '/app', label: 'Visão geral', icon: LayoutDashboard, perm: 'store.read', end: true },
  { to: '/app/orders', label: 'Pedidos', icon: ClipboardList, perm: 'orders.read' },
  { to: '/app/catalog/products', label: 'Produtos', icon: Package, perm: 'catalog.read' },
  { to: '/app/catalog/categories', label: 'Categorias', icon: Tags, perm: 'catalog.read' },
  { to: '/app/inventory', label: 'Estoque', icon: Boxes, perm: 'inventory.read' },
  { to: '/app/customers', label: 'Clientes', icon: Users, perm: 'customers.read' },
  { to: '/app/expenses', label: 'Despesas', icon: Wallet, perm: 'expenses.read' },
  { to: '/app/reports', label: 'Relatórios', icon: BarChart3, perm: 'reports.read' },
  { to: '/app/store/settings', label: 'Minha loja', icon: Settings, perm: 'store.read' },
]

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const storeAccess = useAccessStore((s) => s.storeAccess)
  const store = useAccessStore((s) => s.store)
  const isSudo = useIsSudo()
  const items = NAV.filter((i) => storeAccess?.permissions.includes(i.perm))

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center gap-2 border-b border-white/10 px-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
          <Store className="h-4 w-4 text-white" />
        </span>
        <span className="font-display text-lg font-bold text-white">VibeStore</span>
      </div>
      {store && (
        <div className="border-b border-white/10 px-5 py-3">
          <p className="truncate text-sm font-medium text-white">{store.name}</p>
          <div className="mt-1 flex items-center gap-2">
            <Badge
              className={cn(
                'border-transparent text-[10px]',
                store.is_published
                  ? 'bg-success/20 text-emerald-300'
                  : 'bg-white/10 text-white/60',
              )}
            >
              {store.is_published ? 'Publicada' : 'Rascunho'}
            </Badge>
            {store.is_published && (
              <a
                href={`${APP_URL}/s/${store.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-white/60 hover:text-white"
              >
                Ver vitrine <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
      )}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-white/65 transition-colors hover:bg-white/5 hover:text-white',
                isActive && 'bg-primary/20 text-white',
              )
            }
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {item.label}
          </NavLink>
        ))}
        {isSudo && (
          <>
            <p className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-widest text-white/35">
              Administração
            </p>
            <NavLink
              to="/sudo"
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-white/65 transition-colors hover:bg-white/5 hover:text-white',
                  isActive && 'bg-primary/20 text-white',
                )
              }
            >
              <ShieldCheck className="h-4 w-4 shrink-0" />
              Painel SUDO
            </NavLink>
          </>
        )}
      </nav>
      <div className="border-t border-white/10 p-3">
        <NavLink
          to="/app/orders"
          onClick={onNavigate}
          className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-white/50 hover:bg-white/5 hover:text-white"
        >
          <ListOrdered className="h-4 w-4" />
          <span className="font-mono text-xs">Operação manual via WhatsApp</span>
        </NavLink>
      </div>
    </div>
  )
}

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const user = useAuthStore((s) => s.user)
  const signOut = useAuthStore((s) => s.signOut)
  const resetAccess = useAccessStore((s) => s.reset)
  const navigate = useNavigate()

  const initials = (user?.user_metadata?.full_name as string | undefined)
    ?.split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar desktop — superfície escura contínua, separação por borda */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 bg-sidebar lg:block">
        <SidebarContent />
      </aside>

      {/* Sidebar mobile */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-sidebar shadow-xl">
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-4 text-white/70 hover:bg-white/10 hover:text-white"
              onClick={() => setMobileOpen(false)}
              aria-label="Fechar menu"
            >
              <X className="h-5 w-5" />
            </Button>
            <SidebarContent onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-card/80 px-4 backdrop-blur lg:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Abrir menu"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="flex-1" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 rounded-full p-1 pr-2 transition-colors hover:bg-muted">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-primary/10 text-primary">
                    {initials || 'VS'}
                  </AvatarFallback>
                </Avatar>
                <span className="hidden max-w-[160px] truncate text-sm font-medium sm:inline">
                  {(user?.user_metadata?.full_name as string) || user?.email}
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <p className="truncate text-sm font-medium text-foreground">
                  {(user?.user_metadata?.full_name as string) || 'Minha conta'}
                </p>
                <p className="truncate text-xs">{user?.email}</p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/app/profile">Meu perfil</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/app/store/settings">Configurações da loja</Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={async () => {
                  await signOut()
                  resetAccess()
                  navigate('/auth/login', { replace: true })
                }}
              >
                <LogOut />
                Sair
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <main className="flex-1 px-4 py-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

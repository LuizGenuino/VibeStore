import { Link } from 'react-router-dom'
import {
  ArrowRight,
  BarChart3,
  Check,
  ClipboardList,
  MessageCircle,
  Package,
  Palette,
  ShoppingBag,
  Store,
  Wallet,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Landing page do SaaS — pública, magnética, tema escuro próprio.
 * Assinatura: a cascata de pedidos "PED-000…" com status coloridos —
 * o produto inteiro em um glifo (pedido → WhatsApp → ERP).
 */

const ORDER_CASCADE = [
  { code: 'PED-000128', customer: 'Ana Souza', total: 'R$ 129,90', status: 'Pendente', tone: 'text-amber-300 border-amber-300/30 bg-amber-300/10' },
  { code: 'PED-000127', customer: 'Bruno Lima', total: 'R$ 89,00', status: 'Pago', tone: 'text-sky-300 border-sky-300/30 bg-sky-300/10' },
  { code: 'PED-000126', customer: 'Carla Mendes', total: 'R$ 214,50', status: 'Enviado', tone: 'text-violet-300 border-violet-300/30 bg-violet-300/10' },
  { code: 'PED-000125', customer: 'Diego Ramos', total: 'R$ 57,90', status: 'Entregue', tone: 'text-emerald-300 border-emerald-300/30 bg-emerald-300/10' },
]

const FEATURES = [
  {
    icon: Palette,
    title: 'Vitrine com a sua cara',
    text: 'Endereço próprio, logo, banner e cores da sua marca. Sem programar nada: você edita, a loja atualiza.',
  },
  {
    icon: MessageCircle,
    title: 'Fechamento pelo WhatsApp',
    text: 'O cliente monta o carrinho, faz o pedido e conversa com você no WhatsApp para combinar frete e pagamento.',
  },
  {
    icon: Package,
    title: 'Estoque com custo médio',
    text: 'Entradas, saídas e contagens registradas em um histórico imutável. Cada baixa sabe exatamente quanto custou.',
  },
  {
    icon: ClipboardList,
    title: 'Pedidos sob controle',
    text: 'Do pendente ao entregue: confirme pagamento, envie, cancele ou registre devoluções — tudo com histórico.',
  },
  {
    icon: Wallet,
    title: 'Despesas e caixa',
    text: 'Registre o que pagou, vincule compras de mercadoria e veja o dinheiro que entrou e saiu.',
  },
  {
    icon: BarChart3,
    title: 'Lucro de verdade',
    text: 'Receita, custo das mercadorias, margem e resultado operacional estimado por período — sem planilha.',
  },
]

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#0e0b16] text-white antialiased">
      {/* Nav */}
      <header className="sticky top-0 z-50 border-b border-white/5 bg-[#0e0b16]/80 backdrop-blur">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#6750A4]">
              <Store className="h-4 w-4 text-white" />
            </span>
            <span className="font-display text-lg font-bold tracking-tight">VibeStore</span>
          </div>
          <nav className="hidden items-center gap-6 text-sm text-white/60 md:flex">
            <a href="#recursos" className="transition-colors hover:text-white">Recursos</a>
            <a href="#como-funciona" className="transition-colors hover:text-white">Como funciona</a>
            <a href="#plano" className="transition-colors hover:text-white">Plano</a>
          </nav>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" className="text-white/80 hover:bg-white/10 hover:text-white">
              <Link to="/auth/login">Entrar</Link>
            </Button>
            <Button asChild className="bg-[#6750A4] hover:bg-[#7a63bd]">
              <Link to="/auth/signup">Criar loja grátis</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-[-320px] h-[640px] w-[900px] -translate-x-1/2 rounded-full opacity-25 blur-3xl"
          style={{ background: 'radial-gradient(ellipse, #6750A4 0%, #03A9F4 55%, transparent 75%)' }}
        />
        <div className="container relative grid items-center gap-12 py-20 lg:grid-cols-[1.1fr_0.9fr] lg:py-28">
          <div className="animate-fade-up">
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-white/70">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Grátis para começar — todos os recursos liberados
            </p>
            <h1 className="font-display text-6xl font-extrabold leading-[1.08] tracking-tight text-balance sm:text-5xl lg:text-8xl">
              Sua loja no ar hoje.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-white/60">
              Monte uma vitrine personalizada, receba pedidos pelo WhatsApp e gerencie estoque,
              custos e lucros em um só lugar. Feito para pequenos negócios que vendem de verdade.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg" className="bg-[#6750A4] text-base hover:bg-[#7a63bd]">
                <Link to="/auth/signup">
                  Começar agora <ArrowRight />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="border-white/15 bg-transparent text-base text-white hover:bg-white/5 hover:text-white"
              >
                <a href="#como-funciona">Ver como funciona</a>
              </Button>
            </div>
            <dl className="mt-10 flex flex-wrap gap-8 text-sm">
              {[
                ['2 min', 'para publicar a vitrine'],
                ['24 h', 'de reserva de estoque por pedido'],
                ['R$ 0', 'para usar todos os recursos'],
              ].map(([v, l]) => (
                <div key={l}>
                  <dt className="font-display text-2xl font-bold tabular-nums">{v}</dt>
                  <dd className="mt-0.5 text-white/50">{l}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Assinatura: cascata de pedidos */}
          <div className="relative animate-fade-up [animation-delay:150ms]">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-2xl backdrop-blur">
              <div className="mb-4 flex items-center justify-between">
                <p className="font-display text-sm font-semibold text-white/80">Pedidos de hoje</p>
                <span className="flex items-center gap-1.5 text-xs text-emerald-300">
                  <MessageCircle className="h-3.5 w-3.5" /> fechados no WhatsApp
                </span>
              </div>
              <ul className="space-y-2.5">
                {ORDER_CASCADE.map((o, i) => (
                  <li
                    key={o.code}
                    className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-[#171325] px-4 py-3"
                    style={{ transform: `translateX(${i * 10}px)` }}
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-xs font-semibold text-white/85">{o.code}</span>
                      <span className="text-sm text-white/50">{o.customer}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-sm font-medium tabular-nums">{o.total}</span>
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${o.tone}`}>
                        {o.status}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-4 text-sm">
                <span className="text-white/50">Resultado estimado do mês</span>
                <span className="font-display text-lg font-bold text-emerald-300">+ R$ 3.482,10</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Recursos */}
      <section id="recursos" className="border-t border-white/5 py-20">
        <div className="container">
          <p className="text-sm font-semibold uppercase tracking-widest text-[#a78bfa]">Vitrine + ERP</p>
          <h2 className="mt-2 max-w-2xl font-display text-3xl font-bold tracking-tight text-balance sm:text-4xl">
            A frente da loja encanta o cliente. Os fundos organizam o seu dinheiro.
          </h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="group rounded-2xl border border-white/8 bg-white/[0.03] p-6 transition-colors hover:border-[#6750A4]/50 hover:bg-white/[0.05]"
              >
                <div className="mb-4 inline-flex rounded-xl bg-[#6750A4]/20 p-2.5 text-[#a78bfa] transition-colors group-hover:bg-[#6750A4]/35">
                  <f.icon className="h-5 w-5" />
                </div>
                <h3 className="font-display text-lg font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/55">{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Como funciona */}
      <section id="como-funciona" className="border-t border-white/5 bg-white/[0.02] py-20">
        <div className="container">
          <h2 className="max-w-xl font-display text-3xl font-bold tracking-tight text-balance sm:text-4xl">
            Do cadastro ao pedido em três passos
          </h2>
          <ol className="mt-12 grid gap-10 md:grid-cols-3">
            {[
              {
                n: '01',
                t: 'Crie sua loja',
                d: 'Nome, endereço próprio (sualoja.vibestore), cores, banner e o WhatsApp que recebe os pedidos.',
              },
              {
                n: '02',
                t: 'Cadastre produtos e estoque',
                d: 'Fotos, preço, custo e quantidade. Cada entrada de estoque já alimenta o custo médio do seu ERP.',
              },
              {
                n: '03',
                t: 'Compartilhe o link e venda',
                d: 'O cliente escolhe, pede e chama no WhatsApp. Você confirma pagamento e acompanha o lucro por período.',
              },
            ].map((s) => (
              <li key={s.n} className="relative">
                <span className="font-mono text-sm font-semibold text-[#38bdf8]">{s.n}</span>
                <div className="mt-2 h-px w-full bg-gradient-to-r from-[#6750A4]/60 to-transparent" />
                <h3 className="mt-4 font-display text-xl font-semibold">{s.t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/55">{s.d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Plano */}
      <section id="plano" className="border-t border-white/5 py-20">
        <div className="container flex flex-col items-center text-center">
          <div className="w-full max-w-md rounded-2xl border border-[#6750A4]/40 bg-gradient-to-b from-[#6750A4]/15 to-transparent p-8">
            <ShoppingBag className="mx-auto h-8 w-8 text-[#a78bfa]" />
            <h2 className="mt-4 font-display text-2xl font-bold">Plano Gratuito</h2>
            <p className="mt-1 font-display text-5xl font-extrabold tabular-nums">
              R$ 0<span className="text-base font-medium text-white/50">/mês</span>
            </p>
            <ul className="mt-6 space-y-2.5 text-left text-sm text-white/70">
              {[
                'Vitrine personalizada com seu link e suas cores',
                'Pedidos com fechamento manual pelo WhatsApp',
                'Estoque com custo médio e histórico imutável',
                'Despesas, caixa e relatórios de lucro',
                'Acompanhamento de pedido pelo cliente',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                  {item}
                </li>
              ))}
            </ul>
            <Button asChild size="lg" className="mt-8 w-full bg-[#6750A4] hover:bg-[#7a63bd]">
              <Link to="/auth/signup">
                Criar minha loja <ArrowRight />
              </Link>
            </Button>
          </div>
          <p className="mt-4 text-xs text-white/40">Sem cartão de crédito. Sem pegadinha.</p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 py-10">
        <div className="container flex flex-col items-center justify-between gap-4 text-sm text-white/40 sm:flex-row">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#6750A4]">
              <Store className="h-3 w-3 text-white" />
            </span>
            <span className="font-display font-semibold text-white/70">VibeStore</span>
          </div>
          <p>Venda pelo WhatsApp. Gerencie de verdade.</p>
          <div className="flex gap-4">
            <Link to="/auth/login" className="hover:text-white">Entrar</Link>
            <Link to="/auth/signup" className="hover:text-white">Criar conta</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}

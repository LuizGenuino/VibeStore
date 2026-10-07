# VibeStore — Front-end

Vitrine personalizável com fechamento manual via WhatsApp + ERP para pequenos negócios.
**React 18 · TypeScript · Vite · Tailwind CSS · shadcn/ui · React Router 6 · TanStack Query 5 · Zustand 5 · Supabase**

## Como rodar

```bash
npm install
cp .env.example .env    # preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY
npm run dev
```

Variáveis (`.env`) — só a chave **anon/publishable** vai para o navegador:

| Variável | Exemplo | Uso |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://xyz.supabase.co` | Auth, PostgREST, Storage |
| `VITE_SUPABASE_ANON_KEY` | chave anon | única chave permitida no browser |
| `VITE_APP_URL` | `http://localhost:5173` | base de `redirectTo`/`emailRedirectTo` (igual ao `APP_URL` da Edge) |
| `VITE_STOREFRONT_API_URL` | `${VITE_SUPABASE_URL}/functions/v1/storefront-api` | opcional; derivada se omitida |

Scripts: `npm run dev` · `npm run build` · `npm run preview` · `npm run typecheck`.

## Estrutura

```
src/
├── lib/        supabase · rpc · errors · ids · pending · money · media · safeRedirect · format · constants · feedback
├── types/      backend.ts · rpc.ts · storefront.ts   (contrato do backend — não alterar)
├── services/   1 arquivo por domínio (auth, access, profile, plans, stores, catalog, inventory,
│               orders, customers, expenses, reports, dashboard, sudo, storefront)
├── stores/     zustand: auth · access · cart · checkout
├── router/     index.tsx + guards.tsx
├── layouts/    AuthLayout · OnboardingLayout · AppLayout · SudoLayout · StorefrontLayout
├── components/ ui/ (shadcn) + shared/ (estados, KPI, inputs mascarados, badges)
└── pages/      auth · app/{onboarding,store,catalog,inventory,orders,customers,expenses,reports} · sudo · storefront
```

Regras de arquitetura e padrões de código: **`CONVENTIONS.md`**.

## Rotas

**Públicas** — `/` (landing) · `/auth/{login,signup,forgot-password,reset-password,callback}` ·
`/s/:storeSlug` · `/s/:storeSlug/produto/:productSlug` · `/carrinho` · `/checkout` · `/pedido/:orderId`

**Lojista (autenticado)** — `/app` · `/app/profile` · `/app/onboarding/{plan,store}` · `/app/store/settings` ·
`/app/catalog/{categories,products,products/new,products/:productId}` · `/app/inventory` · `/app/inventory/movements` ·
`/app/orders` · `/app/orders/:orderId` · `/app/customers` · `/app/expenses` · `/app/expenses/categories` · `/app/reports`

**SUDO** — `/sudo` · `/sudo/users` · `/sudo/roles` · `/sudo/permissions` · `/sudo/role-permissions`

## Fluxos implementados

**Lojista:** cadastro por e-mail/senha → escolha do plano (FREE) → criação da loja (slug, cores, WhatsApp,
redes) → catálogo (categorias de 2 níveis, produtos com atributos e até 4 imagens) → estoque (entrada, saída,
contagem individual e em lote, ledger imutável com reversão) → pedidos (máquina de estados PENDING → PAID →
SHIPPED → DELIVERED, com cancelamento e devolução) → clientes (somente leitura) → despesas (operacionais e
compras de estoque, correção/reembolso) → relatórios ERP (receita, CMV, margem, resultado estimado, caixa,
top produtos) → publicação da vitrine.

**Cliente:** acessa o link da loja → catálogo com busca e filtros → página do produto → carrinho em
`localStorage` → checkout com nome/telefone/endereço (sem login) → pedido criado com reserva de estoque de
24 h → botão "Enviar pedido no WhatsApp" → acompanhamento pelo link com token no fragmento (`#token=`),
removido da barra de endereço logo após a leitura.

## Convenções críticas (detalhe em `CONVENTIONS.md`)

- **Escrita só por RPC.** Exceções: `stores` (13 colunas), `profiles` (própria linha) e o CRUD de
  `roles`/`permissions`/`role_permissions`/`plans` no painel SUDO.
- **Idempotência:** todo `request_id` vem de `stablePending(key, payload)` e é reutilizado nos retries da
  mesma intenção; `replayed: true` / `created: false` é sucesso.
- **Concorrência otimista:** `p_expected_revision` em contagens de estoque e em todas as ações de pedido;
  `STALE_*_REVISION` → recarregar e pedir nova confirmação.
- **Vitrine pública** fala **somente** com a Edge `storefront-api` (POST). Nunca chama as RPCs
  service-only, nunca lê tabelas, nunca envia o JWT do lojista.
- **Dinheiro** sempre em BRL via `Intl`, com no máximo 2 casas no envio; custo médio (6 casas) é
  somente exibição.

## Configuração do Supabase Auth

- **Site URL** = `VITE_APP_URL`.
- **Redirect URLs:** `{APP_URL}/auth/callback**` (e equivalentes de desenvolvimento).
- Templates de e-mail usando `{{ .ConfirmationURL }}`.
- O fluxo usa **PKCE** (`detectSessionInUrl: false`), com troca explícita do `?code=` em `/auth/callback`.

## Deploy

Build estático (`npm run build` → `dist/`). Configure rewrite de SPA para `index.html` (todas as rotas).

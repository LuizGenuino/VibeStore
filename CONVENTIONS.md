# VibeStore Web — Convenções do projeto

Stack: React 18 + TypeScript + Vite + Tailwind 3 + componentes shadcn/ui (locais em `src/components/ui`) + React Router 6 + TanStack Query 5 + Zustand 5 + Supabase JS 2. Idioma da UI: **pt-BR**.

## Regras de ouro (vêm do guia de implementação do backend)

1. **Escrita só por RPC.** Catálogo, estoque, pedidos, despesas e loja (criar/publicar/arquivar) escrevem SOMENTE via `rpc()` (`@/lib/rpc`). Exceções de escrita direta: `stores` (13 colunas via `storesService.updateStore`), `profiles` (própria linha) e, no SUDO, `roles`/`permissions`/`role_permissions`/`plans`.
2. **Idempotência:** toda mutação usa `stablePending(key, payload)` → `p_request_id: op.requestId` → `clearPending(key)` no sucesso. `replayed: true` / `created: false` é SUCESSO (mesmo toast). Os services já encapsulam isso — páginas apenas chamam o service.
3. **Concorrência otimista:** contagens de estoque e TODAS as ações de pedido enviam `p_expected_revision` lido da tela. `BackendError` com `isStale` → recarregar dados e avisar "Os dados mudaram. Recarregamos os valores atuais."
4. **Erros:** capturar com `toastError(e)` de `@/lib/feedback`. Mensagens de campo via `messageFor(err.code)` de `@/lib/errors`. `err instanceof BackendError && err.code === '...'` para tratamento específico.
5. **Dinheiro:** exibir com `brl()` de `@/lib/money`; inputs monetários usam `<MoneyInput>`; nunca recalcular custo no cliente; nunca enviar mais de 2 casas.
6. **Datas:** exibir com `formatDateTime`/`formatDate` de `@/lib/format` (fuso America/Sao_Paulo).
7. **Sempre filtrar `.eq('store_id', storeId)`** nas listas (já encapsulado nos services).
8. **PII:** telefone/endereço de cliente só em telas autenticadas; nunca em URLs/logs.
9. **Vitrine pública:** fala SÓ com `storefrontApi` (`@/services/storefront.service`) — nunca `supabase.from`, nunca RPC pública. Token de pedido via `#token=` no fragmento, movido para sessionStorage e removido da barra de endereço.

## Padrões de código

- **Dados:** TanStack Query. `useQuery({ queryKey: ['dominio', storeId, ...filtros], queryFn })`; mutações com `useMutation` + `queryClient.invalidateQueries`. `storeId` vem de `useStoreId()` (`@/stores/access`).
- **Permissões:** `useHasStorePerm('orders.pay')` etc. Esconder ação quando não permitida. Guards de rota já aplicam o mínimo; botões respeitam permissões finas.
- **Estados de tela (obrigatório em toda lista/detalhe):** loading → `<TableSkeleton/>` ou `Skeleton`; vazio → `<EmptyState title description action/>`; filtrado vazio → `<EmptyFilteredState onClear/>`; erro → `<ErrorRetryState onRetry={refetch}/>`; sem permissão → `<ForbiddenState/>` (de `@/components/shared/page-state`).
- **Cabeçalho de página:** `<PageHeader title description actions/>`.
- **Paginação:** `<DataPagination page total pageSize onPage/>` (20/página).
- **Status de pedido:** `<OrderStatusBadge status/>`; códigos com `<CodeChip code/>`; produto com `<ProductStatusBadge/>`.
- **Campos de formulário:** `<FormField label hint error required>` de `@/components/shared/form`.
- **Moeda em input:** `<MoneyInput value onChange/>` (number|null).
- **Toasts:** `toastSuccess('Título')` / `toastError(e)`.
- **Labels:** usar `@/lib/constants` (ORDER_STATUS_LABELS, PAYMENT_METHOD_LABELS, MOVEMENT_TYPE_LABELS, UFS, etc.).
- **Ícones:** somente `lucide-react`.
- **Imagens:** URLs via `storeLogoUrl`, `storeBannerUrl`, `productImageUrl` de `@/lib/media` (o banco guarda só o path).
- **Classes:** `cn()` de `@/lib/utils`. Tipografia: `font-display` (Sora) em títulos/números hero, `font-mono` (JetBrains) em códigos/quantidades.

## Estrutura

```
src/
├── lib/        # supabase, rpc, errors, ids, pending, money, media, safeRedirect, format, constants, utils, feedback
├── types/      # backend.ts, rpc.ts, storefront.ts (contrato oficial — NÃO alterar)
├── services/   # 1 arquivo por domínio (auth, access, profile, plans, stores, catalog, inventory, orders, customers, expenses, reports, dashboard, sudo, storefront)
├── stores/     # zustand: auth, access, cart, checkout
├── router/     # index.tsx + guards.tsx
├── layouts/    # AuthLayout, OnboardingLayout, AppLayout, SudoLayout, StorefrontLayout
├── components/ui/       # shadcn
├── components/shared/   # page-state, page-header, pagination, kpi-card, form, money-input, copy-button, order-status-badge
└── pages/      # auth, app/{onboarding,store,catalog,inventory,orders,customers,expenses,reports}, sudo, storefront
```

## Rotas (fixas — guia seção 3)

Públicas: `/` (landing), `/auth/{login,signup,forgot-password,reset-password,callback}`, `/s/:storeSlug` + `/produto/:productSlug` + `/carrinho` + `/checkout` + `/pedido/:orderId`.
Autenticadas: `/app` (dashboard), `/app/profile`, `/app/onboarding/{plan,store}`, `/app/store/settings`, `/app/catalog/{categories,products,products/new,products/:productId}`, `/app/inventory` + `/movements`, `/app/orders` + `/:orderId`, `/app/customers`, `/app/expenses` + `/categories`, `/app/reports`.
SUDO: `/sudo`, `/sudo/{users,roles,permissions,role-permissions}`.

## Máquina de estados do pedido (guia 13.1)

PENDING → [confirmar frete (repetível)] → [confirmar pagamento: exige frete confirmado] → PAID → [enviar] → SHIPPED → [entregar] → DELIVERED. Cancelar: PENDING (só nota) ou PAID (nota + método de reembolso + checkbox "Já devolvi integralmente"). Devolução: SHIPPED/DELIVERED (disposição por item RESTOCKED/DAMAGED + checkboxes + reembolso). CANCELLED/RETURNED são terminais.

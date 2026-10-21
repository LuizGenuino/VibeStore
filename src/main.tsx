import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { AppRouter } from '@/router'
import { useAuthStore } from '@/stores/auth'
import './index.css'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: (failureCount, error) => {
        // Erros de negócio/permissão não fazem retry; rede faz até 2.
        const code = (error as { code?: string })?.code ?? ''
        if (/^[A-Z][A-Z0-9_]{2,80}$/.test(code) && code !== 'NETWORK_ERROR') return false
        return failureCount < 2
      },
    },
  },
})

// Inicializa a sessão ANTES de renderizar as rotas protegidas (guia 6.2).
void useAuthStore.getState().init()

ReactDOM.createRoot(document.getElementById('root')!).render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={200}>
        <AppRouter />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
)

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

/**
 * Code splitting manual.
 *
 * O objetivo é separar os vendors grandes em chunks estáveis (com hash próprio),
 * para que uma mudança no código da aplicação não invalide o cache dos vendors —
 * e para que a vitrine pública não baixe bibliotecas que só o painel usa.
 *
 * A ordem dos testes importa: o primeiro padrão que casar vence, então os pacotes
 * mais específicos vêm antes dos genéricos.
 */
function manualChunks(id: string): string | undefined {
  if (!id.includes('node_modules')) return undefined

  // React e seus companheiros inseparáveis (react-router usa react; @radix também).
  // Ficam juntos para não criar ciclos entre chunks.
  if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom|@remix-run)[\\/]/.test(id))
    return 'vendor-react'

  // Cliente Supabase (Auth + PostgREST + Storage) — grande e raramente atualizado.
  if (id.includes('@supabase')) return 'vendor-supabase'

  // Camada de dados e formulários.
  if (id.includes('@tanstack')) return 'vendor-query'
  if (/[\\/]node_modules[\\/](zod|react-hook-form|@hookform)[\\/]/.test(id)) return 'vendor-forms'

  // Gráficos: só a página de relatórios importa, então o chunk é carregado sob demanda.
  if (/[\\/]node_modules[\\/](recharts|victory-vendor|d3-[a-z-]+|internmap|decimal\.js-light)[\\/]/.test(id))
    return 'vendor-charts'

  // Base do design system (Radix + ícones + utilitários de classe).
  if (
    /[\\/]node_modules[\\/](@radix-ui|lucide-react|class-variance-authority|clsx|tailwind-merge|sonner)[\\/]/.test(id)
  )
    return 'vendor-ui'

  if (id.includes('date-fns')) return 'vendor-date'

  return undefined
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks,
        // Nomes previsíveis ajudam a depurar o split em produção.
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
})

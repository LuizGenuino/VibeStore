import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL || '' as string
const anonKey =  import.meta.env.SUPABASE_PUBLISHABLE_KEY || import.meta.env.SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || '' as string

if (!url || !anonKey) {
  // Falha cedo e com mensagem clara em desenvolvimento.
  // eslint-disable-next-line no-console
  console.error(
    '[VibeStore] Falha ao inicializar o Supabase: variáveis de ambiente SUPABASE_URL e SUPABASE_ANON_KEY não definidas.',
  )
}

export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'missing', {
  auth: {
    flowType: 'pkce', // links de e-mail retornam ?code=... para /auth/callback
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false, // a troca do code é EXPLÍCITA em /auth/callback
  },
})

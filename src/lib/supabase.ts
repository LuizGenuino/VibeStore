import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!url || !anonKey) {
  // Falha cedo e com mensagem clara em desenvolvimento.
  // eslint-disable-next-line no-console
  console.error(
    '[VibeStore] Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no .env (ver .env.example).',
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

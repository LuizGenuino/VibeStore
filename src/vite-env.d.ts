/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_APP_URL: string
  readonly VITE_STOREFRONT_API_URL?: string
  readonly SUPABASE_URL: string
  readonly SUPABASE_PUBLISHABLE_KEY: string
  readonly SUPABASE_ANON_KEY: string
  // mais variáveis de ambiente definidas pelo Vite...
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

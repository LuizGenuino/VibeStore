import { supabase } from '@/lib/supabase'
import { APP_URL } from '@/lib/constants'

const callbackUrl = (next: string) => `${APP_URL}/auth/callback?next=${encodeURIComponent(next)}`

/** Wrapper do SDK Auth (guia 6.1) — autenticação NÃO usa RPC. */
export const authService = {
  signIn: (email: string, password: string) =>
    supabase.auth.signInWithPassword({ email, password }),

  signUp: (email: string, password: string, fullName: string) =>
    supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName.trim().slice(0, 120) }, // lido pelo trigger handle_new_auth_user
        emailRedirectTo: callbackUrl('/app/onboarding/plan'),
      },
    }),

  resendSignupConfirmation: (email: string) =>
    supabase.auth.resend({ type: 'signup', email }),

  requestPasswordReset: (email: string) =>
    supabase.auth.resetPasswordForEmail(email, { redirectTo: callbackUrl('/auth/reset-password') }),

  updatePassword: (password: string) => supabase.auth.updateUser({ password }),

  /** Troca de e-mail: Supabase envia confirmação; o e-mail muda só após o clique. */
  updateEmail: (email: string) =>
    supabase.auth.updateUser({ email }, { emailRedirectTo: callbackUrl('/app/profile') }),

  signOut: () => supabase.auth.signOut(), // escopo 'global' por padrão
  getSession: () => supabase.auth.getSession(), // leitura local (pode estar expirada)
  getUser: () => supabase.auth.getUser(), // valida o JWT no servidor Auth
}

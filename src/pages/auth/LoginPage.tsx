import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { authService } from '@/services/auth.service'
import { useAccessStore } from '@/stores/access'
import { safeRedirect } from '@/lib/safeRedirect'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FormField } from '@/components/shared/form'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

/** /auth/login (guia 6.5) — trata invalid_credentials, email_not_confirmed e conta inativa. */
export default function LoginPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsConfirmation, setNeedsConfirmation] = useState(false)
  const [resent, setResent] = useState(false)

  const reason = params.get('reason')

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setNeedsConfirmation(false)
    setLoading(true)
    try {
      const { error } = await authService.signIn(email.trim(), password)
      if (error) {
        if (error.code === 'invalid_credentials') setError('E-mail ou senha inválidos.')
        else if (error.code === 'email_not_confirmed') {
          setError('Confirme seu e-mail antes de entrar.')
          setNeedsConfirmation(true)
        } else setError('Não foi possível entrar. Tente novamente em instantes.')
        return
      }
      // Conta inativa (get_my_access.account_active=false) → signOut + aviso
      await useAccessStore.getState().reload()
      if (!useAccessStore.getState().my?.account_active) {
        await authService.signOut()
        setError('Sua conta está inativa. Fale com o suporte.')
        return
      }
      navigate(safeRedirect(params.get('redirect'), '/app'), { replace: true })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="border-white/10 bg-white/[0.04] text-white shadow-2xl backdrop-blur">
      <CardHeader>
        <CardTitle className="text-xl">Entrar na sua conta</CardTitle>
        <CardDescription className="text-white/50">
          Gerencie sua loja, estoque e pedidos.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {reason === 'inactive' && (
          <Alert variant="warning" className="mb-4 border-amber-400/30 bg-amber-400/10 text-amber-200">
            <AlertTitle>Conta inativa</AlertTitle>
            <AlertDescription className="text-amber-200/80">
              Sua conta foi desativada. Fale com o suporte.
            </AlertDescription>
          </Alert>
        )}
        <form onSubmit={onSubmit} className="space-y-4">
          <FormField label="E-mail" htmlFor="email" required>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="border-white/15 bg-white/5 text-white placeholder:text-white/30"
              placeholder="voce@exemplo.com"
            />
          </FormField>
          <FormField label="Senha" htmlFor="password" required>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="border-white/15 bg-white/5 text-white placeholder:text-white/30"
              placeholder="••••••••"
            />
          </FormField>
          {error && (
            <Alert variant="destructive" className="border-red-400/30 bg-red-400/10 text-red-200">
              <AlertDescription className="text-red-200/90">
                {error}{' '}
                {needsConfirmation && !resent && (
                  <button
                    type="button"
                    className="font-medium underline"
                    onClick={async () => {
                      await authService.resendSignupConfirmation(email.trim())
                      setResent(true)
                    }}
                  >
                    Reenviar confirmação
                  </button>
                )}
                {resent && 'Link reenviado — verifique sua caixa de entrada.'}
              </AlertDescription>
            </Alert>
          )}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="animate-spin" />}
            Entrar
          </Button>
        </form>
        <div className="mt-4 flex items-center justify-between text-sm">
          <Link to="/auth/forgot-password" className="text-white/60 hover:text-white">
            Esqueci a senha
          </Link>
          <Link to="/auth/signup" className="font-medium text-[#a78bfa] hover:text-white">
            Criar conta
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}

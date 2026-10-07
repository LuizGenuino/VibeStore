import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, MailCheck } from 'lucide-react'
import { authService } from '@/services/auth.service'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FormField } from '@/components/shared/form'

/** /auth/forgot-password — sempre mensagem neutra (anti-enumeração). */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      await authService.requestPasswordReset(email.trim())
      setSent(true) // mensagem neutra mesmo se a conta não existir
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="border-white/10 bg-white/[0.04] text-white shadow-2xl backdrop-blur">
      <CardHeader>
        <CardTitle className="text-xl">Recuperar senha</CardTitle>
        <CardDescription className="text-white/50">
          Informe o e-mail da sua conta.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {sent ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <MailCheck className="h-10 w-10 text-emerald-400" />
            <p className="text-sm text-white/70">
              Se existir uma conta com este e-mail, enviaremos um link para redefinir a senha.
            </p>
            <Link to="/auth/login" className="text-sm font-medium text-[#a78bfa] hover:text-white">
              Voltar para o login
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <FormField label="E-mail" htmlFor="email" required>
              <Input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="border-white/15 bg-white/5 text-white placeholder:text-white/30"
                placeholder="voce@exemplo.com"
              />
            </FormField>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="animate-spin" />}
              Enviar link de recuperação
            </Button>
            <p className="text-center text-sm text-white/60">
              Lembrou a senha?{' '}
              <Link to="/auth/login" className="font-medium text-[#a78bfa] hover:text-white">
                Entrar
              </Link>
            </p>
          </form>
        )}
      </CardContent>
    </Card>
  )
}

import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { authService } from '@/services/auth.service'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FormField } from '@/components/shared/form'

/** /auth/signup (guia 6.5) — nome 2..120, senha ≥ 8, confirmação; mensagem neutra anti-enumeração. */
export default function SignupPage() {
  const navigate = useNavigate()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [checkEmail, setCheckEmail] = useState(false)

  function validate(): boolean {
    const errs: Record<string, string> = {}
    const name = fullName.trim()
    if (name.length < 2 || name.length > 120) errs.fullName = 'Informe seu nome (2 a 120 caracteres).'
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) errs.email = 'Informe um e-mail válido.'
    if (password.length < 8) errs.password = 'Use pelo menos 8 caracteres.'
    if (confirm !== password) errs.confirm = 'As senhas não conferem.'
    setFieldErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!validate()) return
    setError(null)
    setLoading(true)
    try {
      const { data, error } = await authService.signUp(email.trim(), password, fullName)
      if (error) {
        if (error.code === 'weak_password') setError('Senha fraca. Use letras, números e ao menos 8 caracteres.')
        else if (error.code === 'user_already_exists' || error.code === 'email_exists')
          setError('Se este e-mail já tem conta, tente entrar ou recuperar a senha.')
        else setError('Não foi possível criar a conta. Tente novamente.')
        return
      }
      if (data.session) {
        // Confirmação desligada no projeto → segue direto para o onboarding
        navigate('/app/onboarding/plan', { replace: true })
      } else {
        setCheckEmail(true)
      }
    } finally {
      setLoading(false)
    }
  }

  if (checkEmail) {
    return (
      <Card className="border-white/10 bg-white/[0.04] text-white shadow-2xl backdrop-blur">
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <CheckCircle2 className="h-10 w-10 text-emerald-400" />
          <CardTitle className="text-xl">Verifique seu e-mail</CardTitle>
          <CardDescription className="max-w-xs text-white/60">
            Enviamos um link de confirmação para <strong className="text-white">{email}</strong>.
            Abra o link neste mesmo navegador para continuar.
          </CardDescription>
          <p className="text-sm text-white/50">
            Já confirmou?{' '}
            <Link to="/auth/login" className="font-medium text-[#a78bfa] hover:text-white">
              Entrar
            </Link>
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-white/10 bg-white/[0.04] text-white shadow-2xl backdrop-blur">
      <CardHeader>
        <CardTitle className="text-xl">Criar sua conta</CardTitle>
        <CardDescription className="text-white/50">
          Grátis. Em 2 minutos sua vitrine está no ar.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <FormField label="Nome completo" htmlFor="fullName" required error={fieldErrors.fullName}>
            <Input
              id="fullName"
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="border-white/15 bg-white/5 text-white placeholder:text-white/30"
              placeholder="Maria Silva"
            />
          </FormField>
          <FormField label="E-mail" htmlFor="email" required error={fieldErrors.email}>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="border-white/15 bg-white/5 text-white placeholder:text-white/30"
              placeholder="voce@exemplo.com"
            />
          </FormField>
          <FormField label="Senha" htmlFor="password" required error={fieldErrors.password} hint="Mínimo de 8 caracteres.">
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="border-white/15 bg-white/5 text-white placeholder:text-white/30"
              placeholder="••••••••"
            />
          </FormField>
          <FormField label="Confirmar senha" htmlFor="confirm" required error={fieldErrors.confirm}>
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="border-white/15 bg-white/5 text-white placeholder:text-white/30"
              placeholder="••••••••"
            />
          </FormField>
          {error && <p className="text-sm text-red-300" role="alert">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="animate-spin" />}
            Criar conta grátis
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-white/60">
          Já tem conta?{' '}
          <Link to="/auth/login" className="font-medium text-[#a78bfa] hover:text-white">
            Entrar
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}

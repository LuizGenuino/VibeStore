import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { authService } from '@/services/auth.service'
import { useAuthStore } from '@/stores/auth'
import { toastSuccess } from '@/lib/feedback'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FormField } from '@/components/shared/form'

/** /auth/reset-password — exige sessão de recuperação (PASSWORD_RECOVERY / troca do code). */
export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const session = useAuthStore((s) => s.session)
  const ready = useAuthStore((s) => s.ready)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (password.length < 8) return setError('Use pelo menos 8 caracteres.')
    if (password !== confirm) return setError('As senhas não conferem.')
    setError(null)
    setLoading(true)
    try {
      const { error } = await authService.updatePassword(password)
      if (error) {
        if (error.code === 'same_password') setError('A nova senha não pode ser igual à anterior.')
        else if (error.code === 'weak_password') setError('Senha fraca. Use letras, números e ao menos 8 caracteres.')
        else setError('Não foi possível redefinir. O link pode ter expirado.')
        return
      }
      toastSuccess('Senha atualizada', 'Você já pode usar a nova senha.')
      navigate('/app', { replace: true })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="border-white/10 bg-white/[0.04] text-white shadow-2xl backdrop-blur">
      <CardHeader>
        <CardTitle className="text-xl">Definir nova senha</CardTitle>
        <CardDescription className="text-white/50">Escolha uma senha forte.</CardDescription>
      </CardHeader>
      <CardContent>
        {ready && !session ? (
          <div className="space-y-3 text-sm text-white/70">
            <p>O link expirou ou já foi usado. Solicite um novo.</p>
            <Button asChild variant="outline" className="border-white/15 bg-transparent text-white hover:bg-white/10">
              <Link to="/auth/forgot-password">Solicitar novo link</Link>
            </Button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <FormField label="Nova senha" htmlFor="password" required>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="border-white/15 bg-white/5 text-white"
              />
            </FormField>
            <FormField label="Confirmar nova senha" htmlFor="confirm" required>
              <Input
                id="confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="border-white/15 bg-white/5 text-white"
              />
            </FormField>
            {error && <p className="text-sm text-red-300" role="alert">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="animate-spin" />}
              Salvar nova senha
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}

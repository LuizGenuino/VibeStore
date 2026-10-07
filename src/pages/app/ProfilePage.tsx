import { useEffect, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Loader2, Mail } from 'lucide-react'
import { authService } from '@/services/auth.service'
import { profileService } from '@/services/profile.service'
import { useAuthStore } from '@/stores/auth'
import { BackendError } from '@/lib/rpc'
import { messageFor } from '@/lib/errors'
import { toastError, toastSuccess } from '@/lib/feedback'
import { formatPhone, maskPhoneInput, toE164 } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/shared/page-header'
import { FormField } from '@/components/shared/form'
import { ErrorRetryState } from '@/components/shared/page-state'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function initials(name: string, email: string): string {
  const base = name.trim() || email
  const parts = base.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  return base.slice(0, 2).toUpperCase()
}

/** /app/profile (guia 7.2): dados do perfil + segurança. Funciona também sem loja. */
export default function ProfilePage() {
  const user = useAuthStore((s) => s.user)
  const userId = user?.id ?? null
  const userEmail = user?.email ?? ''
  const queryClient = useQueryClient()

  const profile = useQuery({
    queryKey: ['profile', userId],
    queryFn: () => profileService.getMyProfile(userId!),
    enabled: !!userId,
  })

  // ---- Dados pessoais -----------------------------------------------------
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [savingProfile, setSavingProfile] = useState(false)

  useEffect(() => {
    if (profile.data) {
      setFullName(profile.data.full_name)
      setPhone(profile.data.phone ? formatPhone(profile.data.phone) : '')
    }
  }, [profile.data])

  async function onSaveProfile(e: FormEvent) {
    e.preventDefault()
    if (!userId || savingProfile) return
    setNameError(null)
    setPhoneError(null)
    const n = fullName.trim()
    if (n.length < 2 || n.length > 120) {
      setNameError('Informe seu nome completo (2 a 120 caracteres).')
      return
    }
    let phoneE164: string | null = null
    if (phone.trim()) {
      phoneE164 = toE164(phone)
      if (!phoneE164) {
        setPhoneError('Telefone inválido. Informe DDD + número.')
        return
      }
    }
    setSavingProfile(true)
    try {
      await profileService.updateMyProfile(userId, { full_name: n, phone: phoneE164 })
      toastSuccess('Perfil atualizado')
      await queryClient.invalidateQueries({ queryKey: ['profile', userId] })
    } catch (err) {
      if (err instanceof BackendError && err.code.startsWith('23514:profiles_phone'))
        setPhoneError(messageFor('INVALID_PHONE'))
      else if (err instanceof BackendError && err.code.startsWith('23514:profiles_full_name'))
        setNameError('Informe seu nome completo (2 a 120 caracteres).')
      else toastError(err)
    } finally {
      setSavingProfile(false)
    }
  }

  // ---- Segurança: e-mail ---------------------------------------------------
  const [newEmail, setNewEmail] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [savingEmail, setSavingEmail] = useState(false)

  async function onChangeEmail(e: FormEvent) {
    e.preventDefault()
    if (savingEmail) return
    setEmailError(null)
    const em = newEmail.trim().toLowerCase()
    if (!EMAIL_RE.test(em) || em.length > 254) {
      setEmailError('Informe um e-mail válido.')
      return
    }
    if (em === userEmail.toLowerCase()) {
      setEmailError('Este já é o e-mail da sua conta.')
      return
    }
    setSavingEmail(true)
    try {
      const { error } = await authService.updateEmail(em)
      if (error) {
        setEmailError('Não foi possível alterar o e-mail. Tente novamente.')
        return
      }
      toastSuccess('Confirme no novo e-mail', 'Enviamos um link de confirmação para o novo endereço.')
      setNewEmail('')
    } finally {
      setSavingEmail(false)
    }
  }

  // ---- Segurança: senha ----------------------------------------------------
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [savingPassword, setSavingPassword] = useState(false)

  async function onChangePassword(e: FormEvent) {
    e.preventDefault()
    if (savingPassword) return
    setPasswordError(null)
    if (password.length < 6) {
      setPasswordError('A senha deve ter pelo menos 6 caracteres.')
      return
    }
    if (password !== passwordConfirm) {
      setPasswordError('As senhas não coincidem.')
      return
    }
    setSavingPassword(true)
    try {
      const { error } = await authService.updatePassword(password)
      if (error) {
        if (error.code === 'same_password')
          setPasswordError('A nova senha deve ser diferente da senha atual.')
        else if (error.code === 'weak_password')
          setPasswordError('Use uma senha mais forte (mínimo de 6 caracteres).')
        else setPasswordError('Não foi possível alterar a senha. Tente novamente.')
        return
      }
      toastSuccess('Senha alterada')
      setPassword('')
      setPasswordConfirm('')
    } finally {
      setSavingPassword(false)
    }
  }

  if (!userId) return null

  return (
    <div className="mx-auto w-full max-w-2xl">
      <PageHeader title="Meu perfil" description="Seus dados de conta e segurança de acesso." />

      {profile.isLoading ? (
        <div className="space-y-4" aria-busy="true" aria-label="Carregando">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : profile.isError ? (
        <ErrorRetryState onRetry={() => profile.refetch()} retrying={profile.isRefetching} />
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-4">
                <Avatar className="h-14 w-14">
                  <AvatarFallback className="bg-primary/10 text-lg font-semibold text-primary">
                    {initials(fullName, userEmail)}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <CardTitle className="text-base">Dados pessoais</CardTitle>
                  <CardDescription>Como você aparece na equipe da loja.</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={onSaveProfile} className="space-y-4" noValidate>
                <FormField label="E-mail" htmlFor="profile-email" hint="Para trocar, use a seção Segurança abaixo.">
                  <Input id="profile-email" value={userEmail} readOnly disabled />
                </FormField>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label="Nome completo" htmlFor="fullName" required error={nameError}>
                    <Input
                      id="fullName"
                      value={fullName}
                      maxLength={140}
                      autoComplete="name"
                      onChange={(e) => setFullName(e.target.value)}
                    />
                  </FormField>
                  <FormField
                    label="Telefone"
                    htmlFor="phone"
                    error={phoneError}
                    hint="Opcional. Formato (11) 99999-9999."
                  >
                    <Input
                      id="phone"
                      inputMode="tel"
                      value={phone}
                      autoComplete="tel"
                      onChange={(e) => setPhone(maskPhoneInput(e.target.value))}
                      placeholder="(11) 99999-9999"
                    />
                  </FormField>
                </div>
                <div className="flex justify-end">
                  <Button type="submit" disabled={savingProfile}>
                    {savingProfile && <Loader2 className="animate-spin" />}
                    Salvar perfil
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Segurança</CardTitle>
              <CardDescription>Credenciais de acesso à sua conta.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <form onSubmit={onChangeEmail} className="space-y-3" noValidate>
                <FormField
                  label="Alterar e-mail"
                  htmlFor="newEmail"
                  error={emailError}
                  hint="O e-mail muda somente após você confirmar o link enviado ao novo endereço."
                >
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      id="newEmail"
                      type="email"
                      value={newEmail}
                      autoComplete="email"
                      onChange={(e) => setNewEmail(e.target.value)}
                      placeholder="novo@email.com"
                    />
                    <Button type="submit" variant="outline" disabled={savingEmail} className="shrink-0">
                      {savingEmail ? <Loader2 className="animate-spin" /> : <Mail />}
                      Alterar e-mail
                    </Button>
                  </div>
                </FormField>
              </form>

              <Separator />

              <form onSubmit={onChangePassword} className="space-y-3" noValidate>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label="Nova senha" htmlFor="password" error={passwordError}>
                    <Input
                      id="password"
                      type="password"
                      value={password}
                      autoComplete="new-password"
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </FormField>
                  <FormField label="Confirmar nova senha" htmlFor="passwordConfirm">
                    <Input
                      id="passwordConfirm"
                      type="password"
                      value={passwordConfirm}
                      autoComplete="new-password"
                      onChange={(e) => setPasswordConfirm(e.target.value)}
                    />
                  </FormField>
                </div>
                <div className="flex justify-end">
                  <Button type="submit" variant="outline" disabled={savingPassword}>
                    {savingPassword ? <Loader2 className="animate-spin" /> : <KeyRound />}
                    Alterar senha
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

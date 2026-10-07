import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { safeRedirect } from '@/lib/safeRedirect'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * /auth/callback (guia 6.4): troca explícita do ?code= (PKCE) —
 * o cliente usa detectSessionInUrl:false para não haver troca dupla.
 */
export default function AuthCallbackPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const q = new URLSearchParams(window.location.search)
      const h = new URLSearchParams(window.location.hash.slice(1))
      const err = q.get('error_description') ?? h.get('error_description')
      if (err) {
        if (alive) setError('Link inválido ou expirado. Solicite um novo.')
        return
      }
      const code = q.get('code')
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) {
          if (alive)
            setError(
              'Não foi possível validar o link. Ele pode ter expirado ou sido aberto em outro navegador.',
            )
          return
        }
      }
      const { data } = await supabase.auth.getSession()
      if (!alive) return
      if (!data.session) {
        navigate('/auth/login', { replace: true })
        return
      }
      navigate(safeRedirect(params.get('next'), '/app'), { replace: true }) // limpa ?code da URL
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Card className="border-white/10 bg-white/[0.04] text-white shadow-2xl backdrop-blur">
      <CardHeader>
        <CardTitle className="text-xl">{error ? 'Link inválido' : 'Validando seu acesso…'}</CardTitle>
        <CardDescription className="text-white/50">
          {error ?? 'Aguarde um instante.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4 py-4">
        {error ? (
          <>
            <p className="text-center text-sm text-white/60">
              Abra o link no mesmo navegador em que fez o pedido, ou faça login normalmente.
            </p>
            <div className="flex gap-2">
              <Button asChild variant="outline" className="border-white/15 bg-transparent text-white hover:bg-white/10">
                <Link to="/auth/login">Ir para o login</Link>
              </Button>
              <Button asChild className="bg-[#6750A4] hover:bg-[#7a63bd]">
                <Link to="/auth/forgot-password">Novo link</Link>
              </Button>
            </div>
          </>
        ) : (
          <Loader2 className="h-8 w-8 animate-spin text-[#a78bfa]" />
        )}
      </CardContent>
    </Card>
  )
}

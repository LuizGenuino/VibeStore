import { Link } from 'react-router-dom'
import { NotFoundState } from '@/components/shared/page-state'

export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md">
        <NotFoundState title="Página não encontrada" backTo="/" backLabel="Voltar ao início" />
        <p className="mt-4 text-center text-sm text-muted-foreground">
          Procurando uma loja? Confira se o link está completo.{' '}
          <Link to="/" className="text-primary hover:underline">
            Conhecer o VibeStore
          </Link>
        </p>
      </div>
    </div>
  )
}

/** UUID v4 minúsculo — uma vez por intenção do usuário, reutilizado nos retries da MESMA intenção. */
export const newRequestId = (): string => crypto.randomUUID()

/** 32 bytes aleatórios → base64url sem padding = exatamente 43 caracteres (client_secret do checkout). */
export function newClientSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let bin = ''
  bytes.forEach((b) => {
    bin += String.fromCharCode(b)
  })
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

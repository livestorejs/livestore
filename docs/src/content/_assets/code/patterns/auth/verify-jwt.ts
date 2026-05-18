export type Claims = {
  sub?: string
}

export const verifyJwt = (token: string): Claims => {
  if (token.length === 0) {
    throw new Error('Missing token')
  }

  // Replace with real JWT verification (e.g. via `jose`)
  return { sub: token }
}

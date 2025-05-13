import { clerkMiddleware, createRouteMatcher } from '@clerk/astro/server'

const isProtectedRoute = createRouteMatcher(['/sponsor'])

export const onRequest = clerkMiddleware((auth, context) => {
  // console.log('TMP: Middleware running for:', context.url.pathname)
  const { userId } = auth()
  // console.log('TMP: userId:', userId)

  if (!userId && isProtectedRoute(context.request)) {
    // console.log('TMP: Unauthenticated user on protected route, rewriting to /sponsor/auth')
    // return context.rewrite(new URL('/sponsor/auth', context.url))
    return context.redirect('/sponsor/auth')
  }
})

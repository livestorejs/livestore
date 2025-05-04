import { ClerkProvider, SignIn } from '@clerk/clerk-react'
import React from 'react'

export const SponsorAuth = () => {
  return (
    <div className="flex justify-center items-center h-screen w-full">
      <ClerkProvider publishableKey={import.meta.env.PUBLIC_CLERK_PUBLISHABLE_KEY}>
        <SignIn path="/sponsor/auth" routing="path" forceRedirectUrl="/sponsor" fallbackRedirectUrl="/sponsor" />
      </ClerkProvider>
    </div>
  )
}

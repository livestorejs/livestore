import { ClerkProvider, useUser } from '@clerk/clerk-react'
import * as React from 'react'

export const Sponsor: React.FC = () => (
  <ClerkProvider publishableKey={import.meta.env.PUBLIC_CLERK_PUBLISHABLE_KEY}>
    <SponsorInner />
  </ClerkProvider>
)

const SponsorInner = () => {
  const { user } = useUser()
  console.log('TMP: user:', user)

  if (user == null) {
    return <div className="p-4">Please sign in to continue</div>
  }

  return <div className="p-4">Thank you for being a sponsor of LiveStore, {user.firstName}!</div>
}

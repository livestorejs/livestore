import { createHash } from 'node:crypto'

import { MEETING_PAGE_URL } from '@local/shared/contributor-meeting'

export const verifySiteReceipt = (receipt: unknown, source: string, now: Date): void => {
  const revision = createHash('sha256').update(source).digest('hex')
  if (
    typeof receipt !== 'object' ||
    receipt === null ||
    !('revision' in receipt) ||
    receipt.revision !== revision ||
    !('url' in receipt) ||
    receipt.url !== MEETING_PAGE_URL ||
    !('verifiedAt' in receipt) ||
    typeof receipt.verifiedAt !== 'number' ||
    Number.isFinite(receipt.verifiedAt) === false ||
    Number.isFinite(now.getTime()) === false ||
    now.getTime() - receipt.verifiedAt > 900000 ||
    receipt.verifiedAt > now.getTime()
  )
    throw new Error('A fresh successful production-page check is required before publishing')
}

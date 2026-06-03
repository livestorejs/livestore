import { queryDb } from '@livestore/livestore'

import { mailboxTables } from './schema.ts'

export const mailboxUiState$ = queryDb(
  mailboxTables.uiState
    .select('selectedThreadId', 'selectedLabelId')
    .where({ id: 'default' })
    .first({ behaviour: 'fallback', fallback: () => ({ selectedThreadId: null, selectedLabelId: null }) }),
  { label: 'mailboxUiState' },
)

import { queryDb } from '@livestore/livestore'

import { mailboxTables } from './schema.ts'

/** Navigation fallback is read-only; the first selection event creates the persisted row. */
export const mailboxUiStateQuery = (id: string) =>
  queryDb(
    mailboxTables.uiState.where({ id }).first({
      behaviour: 'fallback',
      fallback: () => ({ id, selectedLabelId: null, selectedThreadId: null }),
    }),
    { label: `mailboxUiState:${id}`, deps: id },
  )

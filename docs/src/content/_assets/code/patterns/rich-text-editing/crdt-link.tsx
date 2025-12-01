import type { AutomergeUrl } from '@automerge/react'
import { updateText, useDocument } from '@automerge/react'
import { Events, Schema, State, type Store } from '@livestore/livestore'

declare const store: Store

type NoteDoc = { body: string }

// ---cut---

export const note = State.SQLite.table({
  name: 'note',
  columns: {
    id: State.SQLite.text({ primaryKey: true }),
    title: State.SQLite.text({ default: '' }),
    crdtDocUrl: State.SQLite.text({ nullable: false, default: '' }),
  },
})

export type Note = typeof note.Type
export const tables = { note }

export const events = {
  createNote: Events.synced({
    name: 'v1.CreateNote',
    schema: Schema.Struct({
      noteId: Schema.String,
      title: Schema.String,
      crdtDocUrl: Schema.String,
    }),
  }),
}

export const getNoteCrdtRef = (noteId: string): string | undefined => {
  return store.query(tables.note.select('crdtDocUrl').where({ id: noteId }))[0]
}

function Editor({ noteCrdtUrl }: { noteCrdtUrl: string }) {
  const docUrl = noteCrdtUrl as AutomergeUrl
  const [doc, changeDoc] = useDocument<NoteDoc>(docUrl, { suspense: true })

  return (
    <textarea
      value={doc?.body ?? ''}
      onChange={(event) =>
        changeDoc((draft: NoteDoc) => {
          updateText(draft, ['body'], event.target.value)
        })
      }
    />
  )
}

export function RichTextNoteEditor({ noteId }: { noteId: string }) {
  const noteCrdtUrl = getNoteCrdtRef(noteId)
  if (!noteCrdtUrl) return null

  return <Editor noteCrdtUrl={noteCrdtUrl} />
}

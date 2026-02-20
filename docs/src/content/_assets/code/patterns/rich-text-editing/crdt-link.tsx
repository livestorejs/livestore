import { updateText, useDocument } from '@automerge/react'
import { Events, Schema, State, type Store } from '@livestore/livestore'
import type { ChangeEvent } from 'react'
import { useCallback } from 'react'

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

const Editor = ({ noteCrdtUrl }: { noteCrdtUrl: string }) => {
  const [doc, changeDoc] = useDocument<NoteDoc>(noteCrdtUrl, { suspense: true })

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      changeDoc((draft: NoteDoc) => {
        updateText(draft, ['body'], event.target.value)
      })
    },
    [changeDoc],
  )

  return <textarea value={doc?.body ?? ''} onChange={handleChange} />
}

export const RichTextNoteEditor = ({ noteId }: { noteId: string }) => {
  const noteCrdtUrl = getNoteCrdtRef(noteId)
  if (noteCrdtUrl == null) return null

  return <Editor noteCrdtUrl={noteCrdtUrl} />
}

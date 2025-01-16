import Placeholder from '@tiptap/extension-placeholder'
import Table from '@tiptap/extension-table'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import TableRow from '@tiptap/extension-table-row'
import { BubbleMenu, EditorContent, useEditor, type Extensions } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import React, { useEffect, useRef } from 'react'
import { Markdown } from 'tiptap-markdown'
import EditorMenu from './editor-menu'

const Editor = ({
  value,
  onChange,
  className = '',
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  className?: string
  placeholder?: string
}) => {
  const markdownValue = useRef<string | null>(null)
  const extensions: Extensions = [StarterKit, Markdown, Table, TableRow, TableHeader, TableCell]
  const editor = useEditor({
    extensions,
    editorProps: {
      attributes: {
        class: `input prose text-gray-600 prose-sm prose-strong:text-gray-600 prose-p:my-2 prose-ol:my-2 prose-ul:my-2 prose-pre:my-2 w-full max-w-xl font-normal focus:outline-none appearance-none editor ${className}`,
      },
    },
    content: value || undefined,
    onUpdate: ({ editor }) => {
      markdownValue.current = editor.storage.markdown.getMarkdown()
      onChange(markdownValue.current || '')
    },
  })

  if (placeholder) extensions.push(Placeholder.configure({ placeholder }))

  useEffect(() => {
    if (editor && markdownValue.current !== value) editor.commands.setContent(value)
  }, [value, editor])

  return (
    <>
      <EditorContent editor={editor} />
      {editor && (
        <BubbleMenu updateDelay={100} editor={editor}>
          <EditorMenu editor={editor} />
        </BubbleMenu>
      )}
    </>
  )
}

export default Editor

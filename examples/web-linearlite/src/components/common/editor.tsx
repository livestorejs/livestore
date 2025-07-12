import Placeholder from '@tiptap/extension-placeholder'
import Table from '@tiptap/extension-table'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import TableRow from '@tiptap/extension-table-row'
import { BubbleMenu, EditorContent, type Extensions, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect, useRef } from 'react'
import { Markdown } from 'tiptap-markdown'
import EditorMenu from '@/components/common/editor-menu'

const Editor = ({
  value,
  onBlur,
  onChange,
  className = '',
  placeholder,
}: {
  value: string
  onBlur?: (value: string) => void
  onChange?: (value: string) => void
  className?: string
  placeholder?: string
}) => {
  const markdownValue = useRef<string | null>(null)
  const extensions: Extensions = [StarterKit, Markdown, Table, TableRow, TableHeader, TableCell]
  const editor = useEditor({
    extensions,
    editorProps: {
      attributes: {
        class: `input prose text-neutral-600 dark:text-neutral-200 prose-sm prose-strong:text-neutral-600 dark:prose-strong:text-neutral-200 prose-p:my-2 prose-ol:my-2 prose-ul:my-2 prose-pre:my-2 w-full max-w-xl font-normal focus:outline-none appearance-none editor ${className}`,
      },
    },
    content: value || undefined,
    onBlur: onBlur
      ? ({ editor }) => {
          markdownValue.current = editor.storage.markdown.getMarkdown()
          onBlur(markdownValue.current || '')
        }
      : undefined,
    onUpdate: onChange
      ? ({ editor }) => {
          markdownValue.current = editor.storage.markdown.getMarkdown()
          onChange(markdownValue.current || '')
        }
      : undefined,
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

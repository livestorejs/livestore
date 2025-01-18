import { ItalicIcon } from '@heroicons/react/16/solid'
import { CodeBracketIcon, ListBulletIcon, NumberedListIcon, StrikethroughIcon } from '@heroicons/react/20/solid'
import { CodeBracketSquareIcon } from '@heroicons/react/24/outline'
import { BoldIcon } from '@heroicons/react/24/solid'
import type { Editor as TipTapEditor } from '@tiptap/react'
import React from 'react'
import { Button } from 'react-aria-components'

export interface EditorMenuProps {
  editor: TipTapEditor
}

const EditorMenu = ({ editor }: EditorMenuProps) => {
  return (
    <div className="bg-white flex items-center shadow-md rounded-lg border border-neutral-200 text-neutral-500">
      <div className="flex items-center gap-px p-1 border-r border-neutral-200">
        <Button
          onPress={() => editor.chain().focus().toggleBold().run()}
          isDisabled={!editor.can().chain().focus().toggleBold().run()}
          className={`rounded-md size-7 shrink-0 flex items-center justify-center hover:bg-neutral-100 hover:text-neutral-800 focus:text-neutral-800 focus:outline-none focus:bg-neutral-100 ${editor.isActive('bold') ? 'bg-neutral-100 text-neutral-800' : ''}`}
        >
          <BoldIcon className="size-4" />
        </Button>
        <Button
          onPress={() => editor.chain().focus().toggleItalic().run()}
          isDisabled={!editor.can().chain().focus().toggleItalic().run()}
          className={`rounded-md size-7 shrink-0 flex items-center justify-center hover:bg-neutral-100 hover:text-neutral-800 focus:text-neutral-800 focus:outline-none focus:bg-neutral-100 ${editor.isActive('italic') ? 'bg-neutral-100 text-neutral-800' : ''}`}
        >
          <ItalicIcon className="size-4" />
        </Button>
        <Button
          onPress={() => editor.chain().focus().toggleStrike().run()}
          isDisabled={!editor.can().chain().focus().toggleStrike().run()}
          className={`rounded-md size-7 shrink-0 flex items-center justify-center hover:bg-neutral-100 hover:text-neutral-800 focus:text-neutral-800 focus:outline-none focus:bg-neutral-100 ${editor.isActive('strike') ? 'bg-neutral-100 text-neutral-800' : ''}`}
        >
          <StrikethroughIcon className="size-4" />
        </Button>
        <Button
          onPress={() => editor.chain().focus().toggleCode().run()}
          isDisabled={!editor.can().chain().focus().toggleCode().run()}
          className={`rounded-md size-7 shrink-0 flex items-center justify-center hover:bg-neutral-100 hover:text-neutral-800 focus:text-neutral-800 focus:outline-none focus:bg-neutral-100 ${editor.isActive('code') ? 'bg-neutral-100 text-neutral-800' : ''}`}
        >
          <CodeBracketIcon className="size-4" />
        </Button>
      </div>
      <div className="flex items-center gap-px p-1">
        <Button
          onPress={() => editor.chain().focus().toggleBulletList().run()}
          isDisabled={!editor.can().chain().focus().toggleBulletList().run()}
          className={`rounded-md size-7 shrink-0 flex items-center justify-center hover:bg-neutral-100 hover:text-neutral-800 focus:text-neutral-800 focus:outline-none focus:bg-neutral-100 ${editor.isActive('bulletList') ? 'bg-neutral-100 text-neutral-800' : ''}`}
        >
          <ListBulletIcon className="size-4" />
        </Button>
        <Button
          onPress={() => editor.chain().focus().toggleOrderedList().run()}
          isDisabled={!editor.can().chain().focus().toggleOrderedList().run()}
          className={`rounded-md size-7 shrink-0 flex items-center justify-center hover:bg-neutral-100 hover:text-neutral-800 focus:text-neutral-800 focus:outline-none focus:bg-neutral-100 ${editor.isActive('orderedList') ? 'bg-neutral-100 text-neutral-800' : ''}`}
        >
          <NumberedListIcon className="size-4" />
        </Button>
        <Button
          onPress={() => editor.chain().focus().toggleCodeBlock().run()}
          isDisabled={!editor.can().chain().focus().toggleCodeBlock().run()}
          className={`rounded-md size-7 shrink-0 flex items-center justify-center hover:bg-neutral-100 hover:text-neutral-800 focus:text-neutral-800 focus:outline-none focus:bg-neutral-100 ${editor.isActive('codeBlock') ? 'bg-neutral-100 text-neutral-800' : ''}`}
        >
          <CodeBracketSquareIcon className="size-5" />
        </Button>
      </div>
    </div>
  )
}

export default EditorMenu

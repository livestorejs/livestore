import { useStore } from '@livestore/react'
import { useRouter } from 'expo-router'
import {
  Clock3Icon,
  EllipsisIcon,
  LinkIcon,
  MoveLeftIcon,
  PencilIcon,
  ShareIcon,
  Trash2Icon,
} from 'lucide-react-native'
import * as React from 'react'
import { Pressable, TextInput, useColorScheme, View } from 'react-native'

import { Colors } from '@/constants/Colors.ts'
import { events } from '@/livestore/schema.ts'

import { Modal } from './Modal.tsx'
import { ThemedText } from './ThemedText.tsx'

interface IssueDetailsBottomTabProps {
  issueId: string
}

export const IssueDetailsBottomTab = ({ issueId }: IssueDetailsBottomTabProps) => {
  const theme = useColorScheme()
  const router = useRouter()
  const { store } = useStore()

  const [visible, setVisible] = React.useState(false)

  const handleDelete = () => {
    store.commit(events.issueDeleted({ id: issueId, deletedAt: new Date() }))
    setVisible(false)
  }

  const IconSize = 22
  const IconStrokeWidth = 2.5
  return (
    <>
      <Modal
        onClose={() => setVisible(false)}
        visible={visible}
        children={
          <View className="pb-7 gap-3">
            <Pressable className="flex-row items-center gap-2 active:bg-zinc-100 dark:active:bg-zinc-800">
              <PencilIcon color={Colors[theme!].text} size={14} />
              <ThemedText style={{ fontSize: 14 }}>Edit issue</ThemedText>
            </Pressable>
            <Pressable
              onPress={handleDelete}
              className="flex-row items-center gap-2 active:bg-zinc-100 dark:active:bg-zinc-800"
            >
              <Trash2Icon color={'red'} size={14} />
              <ThemedText style={{ color: 'red', fontSize: 14 }}>Delete issue</ThemedText>
            </Pressable>
          </View>
        }
      />
      <TextInput placeholder="Comment" className="bg-zinc-100 dark:bg-zinc-800 mx-4 p-3 rounded-lg mt-4" />
      <View className="h-[80px] w-full flex-row justify-between px-6 pt-4 ">
        <Pressable onPress={() => router.back()} className="px-3 pb-3">
          <MoveLeftIcon color={Colors[theme!].tint} size={IconSize} strokeWidth={IconStrokeWidth} />
        </Pressable>
        <LinkIcon color={Colors[theme!].tint} size={IconSize} strokeWidth={IconStrokeWidth} />
        <ShareIcon color={Colors[theme!].tint} size={IconSize} strokeWidth={IconStrokeWidth} />
        <Clock3Icon color={Colors[theme!].tint} size={IconSize} strokeWidth={IconStrokeWidth} />
        <Pressable onPress={() => setVisible(true)} className="px-3 pb-3">
          <EllipsisIcon color={Colors[theme!].tint} size={IconSize} strokeWidth={IconStrokeWidth} />
        </Pressable>
      </View>
    </>
  )
}

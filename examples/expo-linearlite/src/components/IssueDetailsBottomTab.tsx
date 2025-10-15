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
import { Pressable, StyleSheet, TextInput, useColorScheme, View } from 'react-native'

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
  const isDark = theme === 'dark'

  const [visible, setVisible] = React.useState(false)

  const handleDelete = () => {
    store.commit(events.issueDeleted({ id: issueId, deletedAt: new Date() }))
    setVisible(false)
  }

  const IconSize = 22
  const IconStrokeWidth = 2.5

  const styles = StyleSheet.create({
    commentInput: {
      backgroundColor: isDark ? '#27272a' : '#f4f4f5', // zinc-800 : zinc-100
      marginHorizontal: 16,
      padding: 12,
      borderRadius: 8,
      marginTop: 16,
    },
    bottomTabContainer: {
      height: 80,
      width: '100%',
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: 24,
      paddingTop: 16,
    },
    iconButton: {
      paddingHorizontal: 12,
      paddingBottom: 12,
    },
    modalContent: {
      paddingBottom: 28,
      gap: 12,
    },
    modalItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    modalItemPressed: {
      backgroundColor: isDark ? '#27272a' : '#f4f4f5', // zinc-800 : zinc-100
    },
    smallText: {
      fontSize: 14,
    },
    deleteText: {
      color: 'red',
      fontSize: 14,
    },
  })

  return (
    <>
      <Modal onClose={() => setVisible(false)} visible={visible}>
        <View style={styles.modalContent}>
          <Pressable style={({ pressed }) => [styles.modalItem, pressed && styles.modalItemPressed]}>
            <PencilIcon color={Colors[theme!].text} size={14} />
            <ThemedText style={styles.smallText}>Edit issue</ThemedText>
          </Pressable>
          <Pressable
            onPress={handleDelete}
            style={({ pressed }) => [styles.modalItem, pressed && styles.modalItemPressed]}
          >
            <Trash2Icon color={'red'} size={14} />
            <ThemedText style={styles.deleteText}>Delete issue</ThemedText>
          </Pressable>
        </View>
      </Modal>
      <TextInput placeholder="Comment" style={styles.commentInput} />
      <View style={styles.bottomTabContainer}>
        <Pressable onPress={() => router.back()} style={styles.iconButton}>
          <MoveLeftIcon color={Colors[theme!].tint} size={IconSize} strokeWidth={IconStrokeWidth} />
        </Pressable>
        <LinkIcon color={Colors[theme!].tint} size={IconSize} strokeWidth={IconStrokeWidth} />
        <ShareIcon color={Colors[theme!].tint} size={IconSize} strokeWidth={IconStrokeWidth} />
        <Clock3Icon color={Colors[theme!].tint} size={IconSize} strokeWidth={IconStrokeWidth} />
        <Pressable onPress={() => setVisible(true)} style={styles.iconButton}>
          <EllipsisIcon color={Colors[theme!].tint} size={IconSize} strokeWidth={IconStrokeWidth} />
        </Pressable>
      </View>
    </>
  )
}

import { nanoid } from '@livestore/livestore'
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
import { Keyboard, Pressable, StyleSheet, TextInput, useColorScheme, View } from 'react-native'

import { Colors } from '@/constants/Colors.ts'
import { useUser } from '@/hooks/useUser.ts'
import { events } from '@/livestore/schema.ts'

import { Modal } from './Modal.tsx'
import { ThemedText } from './ThemedText.tsx'

interface IssueDetailsBottomTabProps {
  issueId: number
}

export const IssueDetailsBottomTab = ({ issueId }: IssueDetailsBottomTabProps) => {
  const theme = useColorScheme()
  const router = useRouter()
  const { store } = useStore()
  const isDark = theme === 'dark'
  const user = useUser()
  const [commentText, setCommentText] = React.useState('')

  const [visible, setVisible] = React.useState(false)

  const handleDelete = () => {
    store.commit(events.deleteIssue({ id: issueId, deleted: new Date() }))
    setVisible(false)
  }

  const submitComment = () => {
    const text = commentText.trim()
    if (!text) return
    store.commit(
      events.createComment({
        id: nanoid(),
        body: text,
        issueId,
        creator: user.name,
        created: new Date(),
      }),
    )
    setCommentText('')
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
      <TextInput
        placeholder="Comment"
        style={styles.commentInput}
        value={commentText}
        onChangeText={setCommentText}
        returnKeyType="send"
        onSubmitEditing={() => {
          submitComment()
          Keyboard.dismiss()
        }}
        onKeyPress={(e) => {
          // Ensure Enter/Return submits when supported (e.g., hardware keyboards, web)
          if (e.nativeEvent.key === 'Enter') submitComment()
        }}
      />
      <View style={styles.bottomTabContainer}>
        <Pressable
          onPress={() => {
            if (router.canGoBack()) {
              router.back()
            } else {
              // Fallback when screen was opened via replace or as initial route
              router.replace({ pathname: '/(tabs)', params: { storeId: store.storeId } })
            }
          }}
          style={styles.iconButton}
        >
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

import { useQuery, useStore } from '@livestore/react'
import { Stack, useRouter } from 'expo-router'
import { Fragment } from 'react'
import { Pressable, StyleSheet, Text, TextInput, useColorScheme, View } from 'react-native'

import { useUser } from '@/hooks/useUser.ts'
import { uiState$ } from '@/livestore/queries.ts'
import { events } from '@/livestore/schema.ts'
import { makeNextIssueId } from '@/utils/generate-fake-data.ts'

const NewIssueScreen = () => {
  const user = useUser()
  const router = useRouter()
  const { store } = useStore()
  const { newIssueText, newIssueDescription } = useQuery(uiState$)
  const colorScheme = useColorScheme()
  const isDark = colorScheme === 'dark'

  const handleCreateIssue = () => {
    if (!newIssueText) return

    const idNum = makeNextIssueId(store)()
    store.commit(
      events.createIssueWithDescription({
        id: idNum,
        title: newIssueText,
        description: newIssueDescription,
        creator: user.name,
        status: 0,
        priority: 0,
        created: new Date(),
        modified: new Date(),
        kanbanorder: 'a1',
      }),
      // reset state
      events.uiStateSet({ newIssueText: '', newIssueDescription: '' }),
    )
    router.push({ pathname: '/issue-details', params: { issueId: String(idNum), storeId: store.storeId } })
  }

  return (
    <Fragment>
      <Stack.Screen
        options={{
          title: 'New Issue',
          headerRight: () => (
            <Pressable onPress={handleCreateIssue}>
              <Text style={styles.actionButton}>Create</Text>
            </Pressable>
          ),
          headerLeft: () => (
            <Pressable
              onPress={() => {
                if (router.canGoBack()) router.back()
                else router.replace({ pathname: '/(tabs)', params: { storeId: store.storeId } })
              }}
            >
              <Text style={styles.actionButton}>Cancel</Text>
            </Pressable>
          ),
          freezeOnBlur: false,
        }}
      />
      <View style={styles.container}>
        <TextInput
          value={newIssueText}
          style={[styles.titleInput, isDark && styles.darkText]}
          onChangeText={(text: string) => store.commit(events.uiStateSet({ newIssueText: text }))}
          placeholder="Issue title"
          placeholderTextColor={isDark ? '#a1a1aa' : '#71717a'}
        />
        <TextInput
          value={newIssueDescription}
          onChangeText={(text: string) => store.commit(events.uiStateSet({ newIssueDescription: text }))}
          style={isDark ? styles.darkText : null}
          placeholder="Description..."
          placeholderTextColor={isDark ? '#a1a1aa' : '#71717a'}
          multiline
        />
      </View>
    </Fragment>
  )
}

const styles = StyleSheet.create({
  actionButton: {
    color: '#3b82f6', // blue-500
    paddingHorizontal: 16,
  },
  container: {
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  titleInput: {
    fontWeight: 'bold',
    fontSize: 24,
    marginBottom: 12,
  },
  darkText: {
    color: '#fafafa', // zinc-50
  },
})

export default NewIssueScreen

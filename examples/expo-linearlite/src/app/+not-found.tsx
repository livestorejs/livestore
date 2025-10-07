import { useStore } from '@livestore/react'
import { Link, Stack } from 'expo-router'
import { StyleSheet, View } from 'react-native'

import { ThemedText } from '@/components/ThemedText.tsx'

const NotFoundScreen = () => {
  const { store } = useStore()
  return (
    <>
      <Stack.Screen options={{ title: 'Oops!', freezeOnBlur: false }} />
      <View style={styles.container}>
        <ThemedText type="title">This screen doesn't exist.</ThemedText>
        <Link href={{ pathname: '/', params: { storeId: store.storeId } }} style={styles.link}>
          <ThemedText type="link">Go to home screen!</ThemedText>
        </Link>
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  link: {
    marginTop: 15,
    paddingVertical: 15,
  },
})

export default NotFoundScreen

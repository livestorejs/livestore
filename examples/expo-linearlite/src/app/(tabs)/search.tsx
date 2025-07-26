import { StyleSheet, View } from 'react-native'

import { ThemedText } from '@/components/ThemedText.tsx'

const SearchScreen = () => {
  return (
    <View style={styles.container}>
      <ThemedText type="title">Search</ThemedText>
      <ThemedText>This screen is not implemented yet</ThemedText>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12, // equivalent to gap-3 in tailwind (3*4)
  },
})

export default SearchScreen

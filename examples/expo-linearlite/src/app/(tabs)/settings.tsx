import { StyleSheet, View } from 'react-native'

import { ThemedText } from '../../components/ThemedText.tsx'

const SettingsScreen = () => {
  return (
    <View style={styles.container}>
      <ThemedText type="title">Settings</ThemedText>
      <ThemedText>This screen is not implemented yet</ThemedText>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
export default SettingsScreen

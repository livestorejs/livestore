import { ActivityIndicator, StyleSheet, Text } from 'react-native'
import Animated, { FadeOut } from 'react-native-reanimated'

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activityIndicator: {
    marginBottom: 16,
  },
  text: {
    color: '#737373', // neutral-500 equivalent
    fontSize: 14, // text-sm equivalent
  },
})

export const LoadingLiveStore = ({ stage }: { stage: string }) => {
  return (
    <Animated.View exiting={FadeOut} style={styles.container}>
      <ActivityIndicator style={styles.activityIndicator} />
      <Text style={styles.text}>{stage}</Text>
    </Animated.View>
  )
}

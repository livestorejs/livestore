// Minimal React Native stubs for Twoslash type-checking
import type * as React from 'react'

declare module 'react-native' {
  export const View: React.ComponentType<any>
  export const Text: React.ComponentType<any>
  export const TextInput: React.ComponentType<any>
  export const Button: React.ComponentType<any>
  export const SafeAreaView: React.ComponentType<any>
  export const ScrollView: React.ComponentType<any>
  export const StyleSheet: { create<T extends Record<string, any>>(styles: T): T }
  export const TouchableOpacity: React.ComponentType<any>
  export const TouchableWithoutFeedback: React.ComponentType<any>
  export const Keyboard: { dismiss(): void }
  export const unstable_batchedUpdates: (fn: () => void) => void
}

declare module 'expo-status-bar' {
  export const StatusBar: React.ComponentType<{ style?: 'auto' | 'light' | 'dark' }>
}
export {}

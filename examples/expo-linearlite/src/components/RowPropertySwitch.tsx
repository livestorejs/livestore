import { Pressable, StyleSheet, useColorScheme } from 'react-native'

import { ThemedText } from './ThemedText.tsx'

interface RowPropertySwitchProps {
  onPress: () => void
  label: string
  isSelected: boolean
}

export const RowPropertySwitch = ({ onPress, label, isSelected }: RowPropertySwitchProps) => {
  const colorScheme = useColorScheme()
  const isDark = colorScheme === 'dark'

  const styles = StyleSheet.create({
    button: {
      flex: 1,
      alignItems: 'center',
      padding: 16,
      borderRadius: 8,
      backgroundColor: isDark ? '#27272a' : '#e4e4e7',
      opacity: isSelected ? 1 : 0.5,
    },
  })

  return (
    <Pressable onPress={onPress} style={styles.button}>
      <ThemedText>{label}</ThemedText>
    </Pressable>
  )
}

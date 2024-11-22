import React from 'react'
import { View } from 'react-native'

import { ThemedText } from '@/components/ThemedText.tsx'

const SearchScreen = () => {
  return (
    <View className="flex-1 items-center justify-center gap-3">
      <ThemedText type="title">Search</ThemedText>
      <ThemedText>This screen is not implemented yet</ThemedText>
    </View>
  )
}

export default SearchScreen

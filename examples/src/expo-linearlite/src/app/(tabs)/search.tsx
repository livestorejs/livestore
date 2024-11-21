import { ThemedText } from '@/components/ThemedText';
import React from 'react';
import { View } from 'react-native';

export default function SearchScreen() {
  return (
    <View className="flex-1 items-center justify-center gap-3">
      <ThemedText type="title">Search</ThemedText>
      <ThemedText>This screen is not implemented yet</ThemedText>
    </View>
  );
}

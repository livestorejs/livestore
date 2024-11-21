import { ThemedText } from '@/components/ThemedText';
import { View } from 'react-native';

export default function SettingsScreen() {
  return (
    <View className="flex-1 items-center justify-center gap-3">
      <ThemedText type="title">Settings</ThemedText>
      <ThemedText>This screen is not implemented yet</ThemedText>
    </View>
  );
}

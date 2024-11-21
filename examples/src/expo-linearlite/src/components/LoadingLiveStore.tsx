import { ActivityIndicator, Text } from 'react-native';
import Animated, { FadeOut } from 'react-native-reanimated';

export default function LoadingLiveStore({ stage }: { stage: string }) {
  return (
    <Animated.View
      exiting={FadeOut}
      className="flex-1 items-center justify-center "
    >
      <ActivityIndicator className="mb-4" />
      <Text className="text-neutral-500 text-sm">{stage}</Text>
    </Animated.View>
  );
}

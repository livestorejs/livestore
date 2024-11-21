import { Pressable } from 'react-native';
import { ThemedText } from './ThemedText';

interface RowPropertySwitchProps {
  onPress: () => void;
  label: string;
  isSelected: boolean;
}
export function RowPropertySwitch({
  onPress,
  label,
  isSelected,
}: RowPropertySwitchProps) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        opacity: isSelected ? 1 : 0.5,
      }}
      className="flex-1 items-center rounded-lg p-4 bg-zinc-200 dark:bg-zinc-800"
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
}

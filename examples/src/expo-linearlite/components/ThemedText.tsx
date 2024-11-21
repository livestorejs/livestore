import React from 'react';
import { Text, type TextProps, StyleSheet, type TextStyle } from 'react-native';
import { useMemo } from 'react';

import { useThemeColor } from '@/hooks/useThemeColor';

export type ThemedTextProps = TextProps & {
  lightColor?: string;
  darkColor?: string;
  type?: 'default' | 'title' | 'defaultSemiBold' | 'subtitle' | 'link';
  className?: string;
};

const styles = StyleSheet.create({
  default: {
    fontSize: 16,
    lineHeight: 24,
  },
  defaultSemiBold: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '600',
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    lineHeight: 32,
  },
  subtitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  link: {
    lineHeight: 30,
    fontSize: 16,
    color: '#0a7ea4',
  },
});

const styleMap: Record<NonNullable<ThemedTextProps['type']>, TextStyle> = {
  default: styles.default,
  title: styles.title,
  defaultSemiBold: styles.defaultSemiBold,
  subtitle: styles.subtitle,
  link: styles.link,
};

export const ThemedText = React.memo(
  ({
    style,
    lightColor,
    darkColor,
    type = 'default',
    ...rest
  }: ThemedTextProps) => {
    const color = useThemeColor({ light: lightColor, dark: darkColor }, 'text');

    // Pre-calculate base style
    const baseStyle = useMemo(() => ({ color }), [color]);

    // Memoize the combined style with dependency on all inputs
    const combinedStyle = useMemo(() => {
      return [baseStyle, styleMap[type], style];
    }, [baseStyle, type, style]);

    return <Text style={combinedStyle} {...rest} />;
  },
);

ThemedText.displayName = 'ThemedText';

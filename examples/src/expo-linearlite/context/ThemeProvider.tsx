import { darkBackground, darkText, nordicGray } from '@/constants/Colors';
import { mercuryWhite } from '@/constants/Colors';
import { magicBlue } from '@/constants/Colors';
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider as NavigationThemeProvider,
} from '@react-navigation/native';
import { Platform, StatusBar, useColorScheme } from 'react-native';

export default function ThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const isDarkMode = useColorScheme() === 'dark';
  const androidStatusBarStyle = isDarkMode ? 'light-content' : 'dark-content';
  const isIos = Platform.OS === 'ios';
  const statusBarStyle = isIos ? 'default' : androidStatusBarStyle;

  return (
    <NavigationThemeProvider
      value={
        isDarkMode
          ? {
              ...DarkTheme,
              colors: {
                ...DarkTheme.colors,
                primary: mercuryWhite,
                card: darkBackground,
                notification: magicBlue,
                background: darkBackground,
                text: darkText,
              },
            }
          : {
              ...DefaultTheme,
              colors: {
                ...DefaultTheme.colors,
                primary: nordicGray,
                background: 'white',
                card: 'white',
                notification: magicBlue,
                text: nordicGray,
              },
            }
      }
    >
      {children}
      <StatusBar barStyle={statusBarStyle} />
    </NavigationThemeProvider>
  );
}

import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider } from '@react-navigation/native'
import { Platform, StatusBar, useColorScheme } from 'react-native'

import { darkBackground, darkText, magicBlue, mercuryWhite, nordicGray } from '../constants/Colors.ts'

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const isDarkMode = useColorScheme() === 'dark'
  const androidStatusBarStyle = isDarkMode ? 'light-content' : 'dark-content'
  const isIos = Platform.OS === 'ios'
  const statusBarStyle = isIos ? 'default' : androidStatusBarStyle

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
  )
}

export default ThemeProvider

if (typeof window !== 'undefined') {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const storedTheme = window.localStorage.getItem('theme')
  const enableDark = storedTheme === 'dark' || (storedTheme === null && prefersDark)

  document.documentElement.classList.toggle('dark', enableDark)
}

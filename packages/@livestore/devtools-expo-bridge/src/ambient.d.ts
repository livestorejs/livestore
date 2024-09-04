// NOTE `expo` doesn't properly declare `exports` in its `package.json`
// so we need to manually declare it here
declare module 'expo/devtools' {
  export * from 'expo/build/devtools/index.d.ts'
}

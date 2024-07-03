export const objectToString = (error: any): string => {
  const str = error?.toString()
  if (str !== '[object Object]') return str

  try {
    return JSON.stringify(error, null, 2)
  } catch (e: any) {
    console.log(error)

    return 'Error while printing error: ' + e
  }
}

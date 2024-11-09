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

export const tryAsFunctionAndNew = <TArg, TResult>(
  fnOrConstructor: ((arg: TArg) => TResult) | (new (arg: TArg) => TResult),
  arg: TArg,
): TResult => {
  try {
    // @ts-expect-error try out as constructor
    return new fnOrConstructor(arg)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (e) {
    // @ts-expect-error try out as function
    return fnOrConstructor(arg)
  }
}

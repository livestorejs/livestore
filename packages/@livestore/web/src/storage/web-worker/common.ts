export const getAppDbFileName = (prefix: string | undefined = 'livestore', schemaHash: number) => {
  return `${prefix}-${schemaHash}.db`
}

export const getMutationlogDbFileName = (prefix: string | undefined = 'livestore') => {
  return `${prefix}-mutationlog.db`
}

export const getAppDbIdbStoreName = (prefix: string | undefined = 'livestore', schemaHash: number) => {
  return `${prefix}-${schemaHash}`
}

export const getMutationlogDbIdbStoreName = (prefix: string | undefined = 'livestore') => {
  return `${prefix}-mutationlog`
}

const rootHandlePromise = navigator.storage.getDirectory()

export const getOpfsDirHandle = async (directory: string | undefined) => {
  const rootHandle = await rootHandlePromise
  if (directory === undefined) return rootHandle

  let dirHandle = rootHandle
  const directoryStack = directory?.split('/').filter(Boolean)
  while (directoryStack.length > 0) {
    dirHandle = await dirHandle.getDirectoryHandle(directoryStack.shift()!)
  }

  return dirHandle
}

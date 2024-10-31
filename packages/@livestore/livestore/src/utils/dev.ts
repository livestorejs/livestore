/* eslint-disable unicorn/prefer-global-this */
export const downloadBlob = (
  data: Uint8Array | Blob | string,
  fileName: string,
  mimeType = 'application/octet-stream',
) => {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mimeType })

  const url = window.URL.createObjectURL(blob)

  downloadURL(url, fileName)

  setTimeout(() => window.URL.revokeObjectURL(url), 1000)
}

export const downloadURL = (data: string, fileName: string) => {
  const a = document.createElement('a')
  a.href = data
  a.download = fileName
  document.body.append(a)
  a.style.display = 'none'
  a.click()
  a.remove()
}

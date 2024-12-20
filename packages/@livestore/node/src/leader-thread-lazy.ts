const run = async () => {
  const start = Date.now()
  // @ts-expect-error todo
  const _module = await import('./leader-thread.bundle.js')
  const end = Date.now()
  console.log(`[@livestore/node:leader] Loaded in ${end - start}ms`)
}

run()

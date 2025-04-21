// NOTE This file isn't currently used but was part of an experiment to see whether we can improve
// the Node startup time by lazy loading the leader thread bundle.
// This indeed provided a nice speedup but it takes quite a bit of tooling to set up and comes with
// other downsides (e.g. treeshaking).

const run = async () => {
  const start = Date.now()
  // @ts-expect-error todo
  const _module = await import('./leader-thread.bundle.js')
  const end = Date.now()
  console.log(`[@livestore/adapter-node:leader] Loaded in ${end - start}ms`)
}

run()

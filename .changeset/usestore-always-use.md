---
'@livestore/react': patch
---

Call `React.use` on every `useStore` render instead of tracking the suspended attempt in a ref. A loaded store is passed as an already-fulfilled thenable that React reads synchronously, so replayed renders see the same sequence of `use` calls without writing a ref during render. This removes the extra `release`/`retain` cycle that followed a cold store switch or an abandoned transition.

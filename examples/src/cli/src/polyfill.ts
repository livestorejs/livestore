Object.defineProperty(import.meta, 'env', {
  value: {
    DEV: process.env.NODE_ENV !== 'production',
    PROD: process.env.NODE_ENV === 'production',
  },
  writable: false,
})

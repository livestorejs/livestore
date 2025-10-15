/**
 * Generates a random store ID using UUID v4.
 * This is used when a user visits the root path without a store ID.
 */
export const generateStoreId = (): string => {
  return crypto.randomUUID()
}

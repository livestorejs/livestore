import { useCallback, useRef } from 'react'
import type { SearchResult } from './Search.tsx'

interface ActiveRequest {
  controller: AbortController
  timestamp: number
}

interface SearchState {
  results: SearchResult[]
  isLoading: boolean
  error: string | null
}

interface UseDedupeSearchOptions {
  onStateChange: (state: SearchState) => void
}

const CONSTANTS = {
  MAX_REQUEST_TIMEOUT: 30000,
  DEDUPLICATION_WINDOW: 1000,
}

export function useDedupeSearch({ onStateChange }: UseDedupeSearchOptions) {
  const activeRequests = useRef<Map<string, ActiveRequest>>(new Map())
  const lastSearchTerm = useRef('')

  const clearActiveRequests = useCallback(() => {
    activeRequests.current.forEach((req) => {
      req.controller.abort()
    })
    activeRequests.current.clear()
    lastSearchTerm.current = ''
  }, [])

  const abortRequestsExcept = useCallback((keepQuery: string) => {
    activeRequests.current.forEach((req, query) => {
      if (query !== keepQuery) {
        req.controller.abort()
        activeRequests.current.delete(query)
      }
    })
  }, [])

  const executeSearch = useCallback(
    async (query: string) => {
      try {
        const abortController = new AbortController()
        const requestInfo: ActiveRequest = {
          controller: abortController,
          timestamp: Date.now(),
        }

        activeRequests.current.set(query, requestInfo)

        // Update loading state
        onStateChange({
          results: [],
          isLoading: true,
          error: null,
        })

        const timeoutId = setTimeout(() => {
          if (activeRequests.current.has(query)) {
            abortController.abort()
            activeRequests.current.delete(query)
            onStateChange({
              results: [],
              isLoading: false,
              error: 'Search request timed out. Please try again.',
            })
          }
        }, CONSTANTS.MAX_REQUEST_TIMEOUT)

        const response = await fetch(`/api/search?query=${encodeURIComponent(query)}`, {
          signal: abortController.signal,
        })

        clearTimeout(timeoutId)

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }

        const results = await response.json()

        if (results.error) {
          throw new Error(results.error)
        }

        // Only update results if this request is still active and current
        if (activeRequests.current.has(query) && query === lastSearchTerm.current) {
          onStateChange({
            results,
            isLoading: false,
            error: null,
          })
        }

        activeRequests.current.delete(query)
      } catch (err) {
        activeRequests.current.delete(query)

        if (err instanceof Error && err.name !== 'AbortError') {
          if (query === lastSearchTerm.current) {
            onStateChange({
              results: [],
              isLoading: false,
              error: 'Search failed. Please try again.',
            })
          }
        }
      }
    },
    [onStateChange],
  )

  const searchWithDeduplication = useCallback(
    async (query: string) => {
      if (!query) {
        clearActiveRequests()
        onStateChange({
          results: [],
          isLoading: false,
          error: null,
        })
        return
      }

      // Check for recent duplicate request
      const existingRequest = activeRequests.current.get(query)
      if (existingRequest && Date.now() - existingRequest.timestamp < CONSTANTS.DEDUPLICATION_WINDOW) {
        return
      }

      // Abort other requests if search term changed
      if (lastSearchTerm.current && query !== lastSearchTerm.current) {
        abortRequestsExcept(query)
      }

      lastSearchTerm.current = query
      await executeSearch(query)
    },
    [clearActiveRequests, abortRequestsExcept, executeSearch, onStateChange],
  )

  return {
    searchWithDeduplication,
    clearActiveRequests,
  }
}

import { useCallback, useEffect, useRef, useState } from 'react'

interface SearchResult {
  id: string
  type: 'page' | 'heading'
  title: string
  description: string
  url: string
}

interface GroupedResult {
  page: SearchResult
  headings: SearchResult[]
}

interface ActiveRequest {
  controller: AbortController
  timestamp: number
}

const CONSTANTS = {
  BASE_SEARCH_DELAY: 300,
  MAX_REQUEST_TIMEOUT: 30000,
  MODAL_ANIMATION_DELAY: 150,
  ABORT_DELAY: 100,
  ANNOUNCEMENT_TIMEOUT: 1000,
}

export function Search() {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [groupedResults, setGroupedResults] = useState<GroupedResult[]>([])
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [isKeyboardNavigating, setIsKeyboardNavigating] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showClearButton, setShowClearButton] = useState(false)
  const [isMac, setIsMac] = useState(false)

  const modalRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const clearButtonRef = useRef<HTMLButtonElement>(null)
  const activeRequests = useRef<Map<string, ActiveRequest>>(new Map())
  const lastSearchTerm = useRef('')
  const typingTimer = useRef<number | null>(null)
  const focusableLinksRef = useRef<HTMLAnchorElement[]>([])

  useEffect(() => {
    const detectPlatform = () => {
      const platform = (navigator as any).userAgentData?.platform || navigator.platform || ''
      const userAgent = navigator.userAgent || ''
      return (
        platform.toLowerCase().includes('mac') ||
        userAgent.toLowerCase().includes('mac') ||
        userAgent.toLowerCase().includes('darwin')
      )
    }
    setIsMac(detectPlatform())
  }, [])

  const groupResults = useCallback((results: SearchResult[]): GroupedResult[] => {
    const grouped: GroupedResult[] = []
    let currentGroup: GroupedResult | null = null

    for (const result of results) {
      if (result.type === 'page') {
        currentGroup = {
          page: result,
          headings: [],
        }
        grouped.push(currentGroup)
      } else if (result.type === 'heading' && currentGroup) {
        currentGroup.headings.push(result)
      }
    }

    return grouped
  }, [])

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
        setIsLoading(true)
        setError(null)

        const timeoutId = setTimeout(() => {
          if (activeRequests.current.has(query)) {
            abortController.abort()
            activeRequests.current.delete(query)
            setError('Search request timed out. Please try again.')
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

        if (activeRequests.current.has(query) && query === lastSearchTerm.current) {
          const grouped = groupResults(results)
          setGroupedResults(grouped)
          setSelectedIndex(-1)
          searchInputRef.current?.setAttribute('aria-expanded', results.length > 0 ? 'true' : 'false')
        }

        activeRequests.current.delete(query)
      } catch (err) {
        activeRequests.current.delete(query)

        if (err instanceof Error && err.name !== 'AbortError') {
          console.error('Search error:', err)

          if (query === lastSearchTerm.current) {
            let errorMessage = 'Search failed. Please try again.'

            if (err.message.includes('fetch')) {
              errorMessage = 'Unable to connect to search service. Please check your connection.'
            } else if (err.message.includes('timeout')) {
              errorMessage = 'Search request timed out. Please try again.'
            } else if (err.message.includes('500')) {
              errorMessage = 'Search service is temporarily unavailable.'
            }

            setError(errorMessage)
          }
        }
      } finally {
        setIsLoading(false)
      }
    },
    [groupResults],
  )

  const handleSearchWithDeduplication = useCallback(
    async (query: string) => {
      if (!query) {
        clearActiveRequests()
        setGroupedResults([])
        searchInputRef.current?.setAttribute('aria-expanded', 'false')
        return
      }

      const existingRequest = activeRequests.current.get(query)
      if (existingRequest && Date.now() - existingRequest.timestamp < 1000) {
        return
      }

      if (lastSearchTerm.current && query !== lastSearchTerm.current) {
        abortRequestsExcept(query)
      }

      lastSearchTerm.current = query
      await executeSearch(query)
    },
    [clearActiveRequests, abortRequestsExcept, executeSearch],
  )

  const handleSearchInput = useCallback(
    (value: string) => {
      const query = value.trim()
      setSearchQuery(value)

      if (typingTimer.current) {
        clearTimeout(typingTimer.current)
      }

      const isContinuation = query.startsWith(lastSearchTerm.current) || lastSearchTerm.current.startsWith(query)
      const delay = isContinuation ? CONSTANTS.BASE_SEARCH_DELAY : CONSTANTS.BASE_SEARCH_DELAY / 2

      setSelectedIndex(-1)
      setIsKeyboardNavigating(false)
      setShowClearButton(!!query)

      typingTimer.current = window.setTimeout(() => {
        handleSearchWithDeduplication(query)
      }, delay)
    },
    [handleSearchWithDeduplication],
  )

  const openModal = useCallback(() => {
    setIsModalOpen(true)
    document.body.classList.add('mixedbread-modal-open')

    setTimeout(() => {
      searchInputRef.current?.focus()
      searchInputRef.current?.setSelectionRange(searchQuery.length, searchQuery.length)
    }, CONSTANTS.MODAL_ANIMATION_DELAY)
  }, [searchQuery])

  const closeModal = useCallback(() => {
    setIsModalOpen(false)
    document.body.classList.remove('mixedbread-modal-open')
    setSearchQuery('')
    setGroupedResults([])
    setSelectedIndex(-1)
    setIsKeyboardNavigating(false)
    setShowClearButton(false)
    setError(null)

    if (typingTimer.current) {
      clearTimeout(typingTimer.current)
      typingTimer.current = null
    }

    setTimeout(() => {
      if (!isModalOpen) {
        clearActiveRequests()
      }
    }, CONSTANTS.ABORT_DELAY)
  }, [isModalOpen, clearActiveRequests])

  const clearSearch = useCallback(() => {
    setSearchQuery('')
    setGroupedResults([])
    setSelectedIndex(-1)
    setIsKeyboardNavigating(false)
    setShowClearButton(false)
    setError(null)

    if (typingTimer.current) {
      clearTimeout(typingTimer.current)
      typingTimer.current = null
    }

    searchInputRef.current?.focus()
  }, [])

  const announceToScreenReader = useCallback((message: string) => {
    const announcement = document.createElement('div')
    announcement.className = 'sr-only'
    announcement.setAttribute('role', 'status')
    announcement.setAttribute('aria-live', 'polite')
    announcement.textContent = message
    resultsRef.current?.appendChild(announcement)
    setTimeout(() => announcement.remove(), CONSTANTS.ANNOUNCEMENT_TIMEOUT)
  }, [])

  const navigateResults = useCallback(
    (direction: number) => {
      const links = focusableLinksRef.current
      if (links.length === 0) return

      setIsKeyboardNavigating(true)
      let newIndex = selectedIndex

      if (direction > 0) {
        if (selectedIndex === -1) {
          newIndex = 0
        } else if (selectedIndex < links.length - 1) {
          newIndex = selectedIndex + 1
        }
      } else {
        if (selectedIndex === -1) {
          newIndex = 0
        } else if (selectedIndex > 0) {
          newIndex = selectedIndex - 1
        }
      }

      if (newIndex !== selectedIndex) {
        setSelectedIndex(newIndex)
        links[newIndex]?.focus()
        links[newIndex]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })

        // Announce to screen readers
        const linkText = links[newIndex]?.textContent || ''
        const message = `${newIndex + 1} of ${links.length}: ${linkText}`
        announceToScreenReader(message)
      }
    },
    [selectedIndex, announceToScreenReader],
  )

  const selectResult = useCallback(() => {
    const focusedElement = document.activeElement as HTMLAnchorElement
    if (focusedElement?.tagName === 'A') {
      const href = focusedElement.getAttribute('href')
      if (href) {
        window.location.href = href
        closeModal()
        return
      }
    }

    const links = focusableLinksRef.current
    const selectedLink = links[selectedIndex]
    if (selectedLink && selectedIndex >= 0) {
      const href = selectedLink.getAttribute('href')
      if (href) {
        window.location.href = href
        closeModal()
      } else {
        selectedLink.click()
        closeModal()
      }
    }
  }, [selectedIndex, closeModal])

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        openModal()
      }
      if (e.key === 'Escape' && isModalOpen) {
        e.preventDefault()
        closeModal()
      }
    }

    document.addEventListener('keydown', handleGlobalKeyDown)
    return () => document.removeEventListener('keydown', handleGlobalKeyDown)
  }, [isModalOpen, openModal, closeModal])

  // biome-ignore lint/correctness/useExhaustiveDependencies: -
  useEffect(() => {
    if (resultsRef.current) {
      focusableLinksRef.current = Array.from(
        resultsRef.current.querySelectorAll('.mixedbread__result-link'),
      ) as HTMLAnchorElement[]
    }
  }, [groupedResults])

  const handleModalKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'Escape':
        e.preventDefault()
        closeModal()
        break
      case 'ArrowDown':
        e.preventDefault()
        navigateResults(1)
        break
      case 'ArrowUp':
        e.preventDefault()
        navigateResults(-1)
        break
      case 'Enter':
        e.preventDefault()
        selectResult()
        break
    }
  }

  const handleModalClick = (e: React.MouseEvent) => {
    if (e.target === modalRef.current) {
      closeModal()
    }
  }

  const handleMouseMove = () => {
    if (isKeyboardNavigating) {
      setIsKeyboardNavigating(false)
    }
  }

  const handleSearchInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Tab') {
      if (e.shiftKey) {
        e.preventDefault()
        closeModal()
      } else if (!showClearButton && focusableLinksRef.current.length > 0) {
        e.preventDefault()
        setSelectedIndex(0)
        focusableLinksRef.current[0]?.focus()
      }
    }
  }

  const handleClearButtonKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      if (e.shiftKey) {
        searchInputRef.current?.focus()
      } else if (focusableLinksRef.current.length > 0) {
        setSelectedIndex(0)
        focusableLinksRef.current[0]?.focus()
      } else {
        closeModal()
      }
    }
  }

  const renderHeading = (heading: SearchResult) => {
    const title = heading.title
    const description = heading.description || ''
    const href = heading.url

    return (
      <a
        key={heading.id}
        className="mixedbread__result-link mixedbread__result-nested"
        href={href}
        onClick={() => closeModal()}
      >
        <span className="mixedbread__result-title">{title}</span>
        <span className="mixedbread__result-description">{description}</span>
      </a>
    )
  }

  const renderGroupedResult = (group: GroupedResult) => {
    const title = group.page.title
    const description = group.page.description || ''
    const href = group.page.url.endsWith('/') ? group.page.url : `${group.page.url}/`

    return (
      <li key={group.page.id} className="mixedbread__result">
        <div className="mixedbread__result-inner">
          <a className="mixedbread__result-link mixedbread__result-page" href={href} onClick={() => closeModal()}>
            <span className="mixedbread__result-title">{title}</span>
            <span className="mixedbread__result-description">{description}</span>
          </a>
          {group.headings.map((h) => renderHeading(h))}
        </div>
      </li>
    )
  }

  const renderResultsContent = () => {
    if (isLoading) {
      return (
        <output className="mixedbread-loading">
          <div>Searching...</div>
          <span className="sr-only">Loading search results</span>
        </output>
      )
    }

    if (error) {
      return (
        <div className="mixedbread-error" role="alert">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
              clipRule="evenodd"
            />
          </svg>
          <div>{error}</div>
        </div>
      )
    }

    if (groupedResults.length === 0 && searchQuery) {
      return <output className="mixedbread-no-results">No results found for "{searchQuery}"</output>
    }

    if (groupedResults.length === 0) {
      return (
        <div className="mixedbread-empty">
          <div className="mixedbread-empty-icon" aria-hidden="true">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.5"
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
          <div className="mixedbread-empty-text">Enter a query to search the documentation</div>
        </div>
      )
    }

    const resultsText = groupedResults.length === 1 ? '1 result found' : `${groupedResults.length} results found`

    return (
      <>
        <output className="sr-only">{resultsText}</output>
        <ol className="mixedbread__results">{groupedResults.map(renderGroupedResult)}</ol>
      </>
    )
  }

  return (
    <>
      <button
        type="button"
        className="mixedbread-search mixedbread-search-button"
        onClick={openModal}
        aria-label="Search"
      >
        <span className="mixedbread-button-container">
          <svg width="20" height="20" className="mixedbread-search-icon" viewBox="0 0 20 20" aria-hidden="true">
            <path
              d="M14.386 14.386l4.0877 4.0877-4.0877-4.0877c-2.9418 2.9419-7.7115 2.9419-10.6533 0-2.9419-2.9418-2.9419-7.7115 0-10.6533 2.9418-2.9419 7.7115-2.9419 10.6533 0 2.9419 2.9418 2.9419 7.7115 0 10.6533z"
              stroke="currentColor"
              fill="none"
              fillRule="evenodd"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="mixedbread-button-placeholder">Search</span>
        </span>
        <kbd className="mixedbread-button-kbd">
          {isMac ? (
            <>
              <kbd>⌘</kbd>
              <kbd>K</kbd>
            </>
          ) : (
            <>
              <kbd>Ctrl</kbd>
              <kbd>K</kbd>
            </>
          )}
        </kbd>
      </button>

      {isModalOpen && (
        <div
          ref={modalRef}
          className={`mixedbread-modal ${isModalOpen ? 'is-open' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-label="Search"
          onClick={handleModalClick}
          onKeyDown={handleModalKeyDown}
          onMouseMove={handleMouseMove}
        >
          <div className="mixedbread-modal-container" role="document">
            <div className="mixedbread-searchbox">
              <input
                ref={searchInputRef}
                type="search"
                placeholder="Search documentation..."
                aria-label="Search documentation"
                aria-describedby="search-instructions"
                aria-controls="search-results"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck="false"
                value={searchQuery}
                onChange={(e) => handleSearchInput(e.target.value)}
                onKeyDown={handleSearchInputKeyDown}
              />
              <button
                ref={clearButtonRef}
                className={`mixedbread-clear ${showClearButton ? 'show' : ''}`}
                aria-label="Clear search"
                type="button"
                tabIndex={showClearButton ? 0 : -1}
                onClick={clearSearch}
                onKeyDown={handleClearButtonKeyDown}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                </svg>
                <span className="sr-only">Clear</span>
              </button>
            </div>

            <section
              ref={resultsRef}
              id="search-results"
              className={`mixedbread-results ${isKeyboardNavigating ? 'keyboard-nav' : ''}`}
              aria-label="Search results"
              aria-live="polite"
            >
              {renderResultsContent()}
            </section>

            <div className="mixedbread-footer">
              <span id="search-instructions" className="sr-only">
                Type to search. Use arrow keys to navigate results. Press Enter to select. Press Escape to close.
              </span>
              <div className="mixedbread-powered-by">
                <svg
                  className="mixedbread-powered-by__logo"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 2020 1130"
                  aria-hidden="true"
                >
                  <path
                    fill="#e95a0f"
                    d="M398.167 621.992c-1.387-20.362-4.092-40.739-3.851-61.081.355-30.085 6.873-59.139 21.253-85.976 10.487-19.573 24.09-36.822 40.662-51.515 16.394-14.535 34.338-27.046 54.336-36.182 15.224-6.955 31.006-12.609 47.829-14.168 11.809-1.094 23.753-2.514 35.524-1.836 23.033 1.327 45.131 7.255 66.255 16.75 16.24 7.3 31.497 16.165 45.651 26.969 12.997 9.921 24.412 21.37 34.158 34.509 11.733 15.817 20.849 33.037 25.987 52.018 3.468 12.81 6.438 25.928 7.779 39.097 1.722 16.908 1.642 34.003 2.235 51.021.427 12.253.224 24.547 1.117 36.762 1.677 22.93 4.062 45.764 11.8 67.7 5.376 15.239 12.499 29.55 20.846 43.681l-18.282 20.328c-1.536 1.71-2.795 3.665-4.254 5.448l-19.323 23.533c-13.859-5.449-27.446-11.803-41.657-16.086-13.622-4.106-27.793-6.765-41.905-8.775-15.256-2.173-30.701-3.475-46.105-4.049-23.571-.879-47.178-1.056-70.769-1.029-10.858.013-21.723 1.116-32.57 1.926-5.362.4-10.69 1.255-16.464 1.477-2.758-7.675-5.284-14.865-7.367-22.181-3.108-10.92-4.325-22.554-13.16-31.095-2.598-2.512-5.069-5.341-6.883-8.443-6.366-10.884-12.48-21.917-18.571-32.959-4.178-7.573-8.411-14.375-17.016-18.559-10.34-5.028-19.538-12.387-29.311-18.611-3.173-2.021-6.414-4.312-9.952-5.297-5.857-1.63-11.98-2.301-17.991-3.376z"
                  />
                  <path
                    fill="#ed6d7b"
                    d="M1478.998 758.842c-12.025.042-24.05.085-36.537-.373-.14-8.536.231-16.569.453-24.607.033-1.179-.315-2.986-1.081-3.4-.805-.434-2.376.338-3.518.81-.856.354-1.562 1.069-3.589 2.521-.239-3.308-.664-5.586-.519-7.827.488-7.544 2.212-15.166 1.554-22.589-1.016-11.451 1.397-14.592-12.332-14.419-3.793.048-3.617-2.803-3.332-5.331.499-4.422 1.45-8.803 1.77-13.233.311-4.316.068-8.672.068-12.861-2.554-.464-4.326-.86-6.12-1.098-4.415-.586-6.051-2.251-5.065-7.31 1.224-6.279.848-12.862 1.276-19.306.19-2.86-.971-4.473-3.794-4.753-4.113-.407-8.242-1.057-12.352-.975-4.663.093-5.192-2.272-4.751-6.012.733-6.229 1.252-12.483 1.875-18.726l1.102-10.495c-5.905-.309-11.146-.805-16.385-.778-3.32.017-5.174-1.4-5.566-4.4-1.172-8.968-2.479-17.944-3.001-26.96-.26-4.484-1.936-5.705-6.005-5.774-9.284-.158-18.563-.594-27.843-.953-7.241-.28-10.137-2.764-11.3-9.899-.746-4.576-2.715-7.801-7.777-8.207-7.739-.621-15.511-.992-23.207-1.961-7.327-.923-14.587-2.415-21.853-3.777-5.021-.941-10.003-2.086-15.003-3.14 4.515-22.952 13.122-44.382 26.284-63.587 18.054-26.344 41.439-47.239 69.102-63.294 15.847-9.197 32.541-16.277 50.376-20.599 16.655-4.036 33.617-5.715 50.622-4.385 33.334 2.606 63.836 13.955 92.415 31.15 15.864 9.545 30.241 20.86 42.269 34.758 8.113 9.374 15.201 19.78 21.718 30.359 10.772 17.484 16.846 36.922 20.611 56.991 1.783 9.503 2.815 19.214 3.318 28.876.758 14.578.755 29.196.65 44.311l-51.545 20.013c-7.779 3.059-15.847 5.376-21.753 12.365-4.73 5.598-10.658 10.316-16.547 14.774-9.9 7.496-18.437 15.988-25.083 26.631-3.333 5.337-7.901 10.381-12.999 14.038-11.355 8.144-17.397 18.973-19.615 32.423l-6.988 41.011z"
                  />
                </svg>
                <span>
                  Search powered by{' '}
                  <a href="https://mixedbread.com" target="_blank" rel="noopener noreferrer">
                    Mixedbread
                  </a>
                </span>
              </div>
              <div className="mixedbread-shortcuts" aria-hidden="true">
                <span className="mixedbread-key">↑</span>
                <span className="mixedbread-key">↓</span>
                <span>to navigate</span>
                <span className="mixedbread-key">↵</span>
                <span>to select</span>
                <span className="mixedbread-key">esc</span>
                <span>to close</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

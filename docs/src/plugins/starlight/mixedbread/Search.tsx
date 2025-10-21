import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import MixedbreadLogo from "./mixedbread-logo.svg?url";
import { ResultContent } from "./ResultContent.tsx";
import { useDebounce } from "./use-debounce.ts";
import { useDedupeSearch } from "./use-dedupe-search.ts";

export interface SearchResult {
  id: string;
  type: "page" | "heading";
  title: string;
  description: string;
  url: string;
}

export interface GroupedResult {
  page: SearchResult;
  headings: SearchResult[];
}

const CONSTANTS = {
  BASE_SEARCH_DELAY: 300,
  MODAL_ANIMATION_DELAY: 150,
  ABORT_DELAY: 100,
  ANNOUNCEMENT_TIMEOUT: 1000,
};

export function isMacOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform = navigator.platform ?? "";
  return /(Mac|iPhone|iPod|iPad)/i.test(platform);
}

export function Search() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [groupedResults, setGroupedResults] = useState<GroupedResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMac, setIsMac] = useState(false);

  const modalRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const focusableLinksRef = useRef<HTMLAnchorElement[]>([]);

  const trimmedQuery = searchQuery.trim();
  const showClearButton = trimmedQuery.length > 0;
  const [debouncedQuery, setDebouncedQuery] = useDebounce(trimmedQuery);

  const groupResults = useCallback(
    (results: SearchResult[]): GroupedResult[] => {
      const grouped: GroupedResult[] = [];
      let currentGroup: GroupedResult | null = null;

      for (const result of results) {
        if (result.type === "page") {
          currentGroup = {
            page: result,
            headings: [],
          };
          grouped.push(currentGroup);
        } else if (result.type === "heading" && currentGroup) {
          currentGroup.headings.push(result);
        }
      }

      return grouped;
    },
    []
  );

  const handleSearchStateChange = useCallback(
    (state: {
      results: SearchResult[];
      isLoading: boolean;
      error: string | null;
    }) => {
      const grouped = groupResults(state.results);
      setGroupedResults(grouped);
      setIsLoading(state.isLoading);
      setError(state.error);
      setSelectedIndex(-1);
    },
    [groupResults]
  );

  const { searchWithDeduplication, clearActiveRequests } = useDedupeSearch({
    onStateChange: handleSearchStateChange,
  });

  const openModal = useCallback(() => {
    setIsModalOpen(true);
    document.body.style.overflow = "hidden";

    setTimeout(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.setSelectionRange(
        searchQuery.length,
        searchQuery.length
      );
    }, CONSTANTS.MODAL_ANIMATION_DELAY);
  }, [searchQuery]);

  const handleSearchInput = useCallback((value: string) => {
    setSearchQuery(value);
    setSelectedIndex(-1);
  }, []);

  useEffect(() => {
    // Check for macOS
    if (isMacOS()) setIsMac(true);
    // Check for showSearch param in URL
    const searchParams = new URLSearchParams(window.location.search);
    const showSearch = searchParams.get("showSearch");
    if (showSearch) {
      // If showSearch is true, open the modal
      if (showSearch === "true") openModal();
      // Delete showSearch param from URL
      searchParams.delete("showSearch");
      let newUrl = window.location.pathname;
      if (searchParams.values.length > 0) {
        newUrl += `?${searchParams.toString()}`;
      }
      window.history.replaceState(null, "", newUrl);
    }
  }, [openModal]);

  // Effect to trigger search when debounced query changes
  useEffect(() => {
    searchWithDeduplication(debouncedQuery);
  }, [debouncedQuery, searchWithDeduplication]);

  const resetStates = useCallback(() => {
    setSearchQuery("");
    setDebouncedQuery("");
    setGroupedResults([]);
    setSelectedIndex(-1);
    setError(null);

    searchInputRef.current?.focus();
  }, [setDebouncedQuery]);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    document.body.style.overflow = "auto";
    resetStates();

    setTimeout(() => {
      if (!isModalOpen) {
        clearActiveRequests();
      }
    }, CONSTANTS.ABORT_DELAY);
  }, [isModalOpen, clearActiveRequests, resetStates]);

  const announceToScreenReader = useCallback((message: string) => {
    const announcement = document.createElement("div");
    announcement.className = "sr-only";
    announcement.setAttribute("role", "status");
    announcement.setAttribute("aria-live", "polite");
    announcement.textContent = message;
    resultsRef.current?.appendChild(announcement);
    setTimeout(() => announcement.remove(), CONSTANTS.ANNOUNCEMENT_TIMEOUT);
  }, []);

  const navigateResults = useCallback(
    (direction: number) => {
      const links = focusableLinksRef.current;
      if (links.length === 0) return;

      const newIndex = Math.max(
        0,
        Math.min(selectedIndex + direction, links.length - 1)
      );

      if (newIndex !== selectedIndex) {
        setSelectedIndex(newIndex);
        links[newIndex]?.focus();
        links[newIndex]?.scrollIntoView({
          block: "nearest",
          behavior: "smooth",
        });

        // Announce to screen readers
        const linkText = links[newIndex]?.textContent || "";
        const message = `${newIndex + 1} of ${links.length}: ${linkText}`;
        announceToScreenReader(message);
      }
    },
    [selectedIndex, announceToScreenReader]
  );

  const selectResult = useCallback(() => {
    // Check if there's a currently focused link (from Tab navigation)
    const focusedElement = document.activeElement as HTMLAnchorElement;
    if (focusedElement instanceof HTMLAnchorElement) {
      const href = focusedElement.getAttribute("href");
      if (href) {
        window.location.href = href;
        closeModal();
        return;
      }
    }

    // Fallback to keyboard navigation selection
    const links = focusableLinksRef.current;
    const selectedLink = links[selectedIndex];
    if (selectedLink && selectedIndex >= 0) {
      const href = selectedLink.getAttribute("href");
      if (href) {
        window.location.href = href;
        closeModal();
      } else {
        // Fallback to click if no href
        selectedLink.click();
        closeModal();
      }
    }
  }, [selectedIndex, closeModal]);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        openModal();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeModal();
      }
    };

    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => document.removeEventListener("keydown", handleGlobalKeyDown);
  }, [openModal, closeModal]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: -
  useEffect(() => {
    if (resultsRef.current) {
      focusableLinksRef.current = Array.from(
        resultsRef.current.querySelectorAll(".mixedbread__result-link")
      ) as HTMLAnchorElement[];
    }
  }, [groupedResults]);

  const handleModalKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        closeModal();
        break;
      case "ArrowDown":
        e.preventDefault();
        navigateResults(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        navigateResults(-1);
        break;
      case "Enter":
        e.preventDefault();
        selectResult();
        break;
    }
  };

  const handleModalClick = (e: React.MouseEvent) => {
    if (e.target !== modalRef.current) return;
    closeModal();
  };

  return (
    <>
      <button
        type="button"
        className="mixedbread-search mixedbread-search-button"
        onClick={openModal}
        aria-label="Search"
      >
        <span className="mixedbread-button-container">
          <svg
            width="20"
            height="20"
            className="mixedbread-search-icon"
            viewBox="0 0 20 20"
            aria-hidden="true"
          >
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

      {isModalOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={modalRef}
            className={`mixedbread-modal ${isModalOpen ? "is-open" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label="Search"
            onClick={handleModalClick}
            onKeyDown={handleModalKeyDown}
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
                />

                <button
                  className={`mixedbread-clear ${
                    showClearButton ? "show" : ""
                  }`}
                  aria-label="Clear search"
                  type="button"
                  tabIndex={showClearButton ? 0 : -1}
                  onClick={resetStates}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                  </svg>
                  <span className="sr-only">Clear</span>
                </button>

                <button
                  className="mixedbread-close"
                  aria-label="Close search"
                  type="button"
                  onClick={closeModal}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                  </svg>
                  <span className="sr-only">Close</span>
                </button>
              </div>

              <section
                ref={resultsRef}
                id="search-results"
                className="mixedbread-results"
                aria-label="Search results"
                aria-live="polite"
              >
                <ResultContent
                  searchQuery={debouncedQuery}
                  isLoading={isLoading}
                  error={error}
                  groupedResults={groupedResults}
                  closeModal={closeModal}
                />
              </section>

              <div className="mixedbread-footer">
                <span id="search-instructions" className="sr-only">
                  Type to search. Use arrow keys to navigate results. Press
                  Enter to select. Press Escape to close.
                </span>
                <div className="mixedbread-powered-by">
                  <img
                    src={MixedbreadLogo}
                    className="mixedbread-powered-by__logo"
                    aria-hidden="true"
                    alt=""
                  />
                  <span>
                    Search powered by{" "}
                    <a
                      href="https://mixedbread.com"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Mixedbread
                    </a>
                  </span>
                </div>
                <div className="mixedbread-shortcuts" aria-hidden="true">
                  <kbd className="mixedbread-key">↑</kbd>
                  <kbd className="mixedbread-key">↓</kbd>
                  <span>to navigate</span>
                  <kbd className="mixedbread-key">↵</kbd>
                  <span>to select</span>
                  <kbd className="mixedbread-key">esc</kbd>
                  <span>to close</span>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

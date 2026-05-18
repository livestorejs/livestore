import type { GroupedResult, SearchResult } from './Search.tsx'

interface ResultContentProps {
  searchQuery: string
  isLoading: boolean
  error: string | null
  groupedResults: GroupedResult[]
  closeModal: () => void
}

export const ResultContent = ({ searchQuery, isLoading, error, groupedResults, closeModal }: ResultContentProps) => {
  if (isLoading) return <LoadingState />

  if (error) return <ErrorState error={error} />

  if (searchQuery && groupedResults.length === 0) return <EmptyState searchQuery={searchQuery} />

  if (groupedResults.length > 0) return <ResultList groupedResults={groupedResults} closeModal={closeModal} />

  return <DefaultState />
}

interface ResultItemProps {
  group: GroupedResult
  closeModal: () => void
}

const ResultItem = ({ group, closeModal }: ResultItemProps) => {
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
        {group.headings.map((heading) => (
          <ResultItemHeading key={heading.id} heading={heading} closeModal={closeModal} />
        ))}
      </div>
    </li>
  )
}

interface ResultItemHeadingProps {
  heading: SearchResult
  closeModal: () => void
}

const ResultItemHeading = ({ heading, closeModal }: ResultItemHeadingProps) => {
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

const LoadingState = () => {
  return (
    <div className="mixedbread-loading">
      <div>Searching...</div>
      <span className="sr-only">Loading search results</span>
    </div>
  )
}

const ErrorState = ({ error }: { error: string }) => {
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

const EmptyState = ({ searchQuery }: { searchQuery: string }) => {
  return <div className="mixedbread-no-results">No results found for "{searchQuery}"</div>
}

const DefaultState = () => {
  return (
    <div className="mixedbread-empty">
      <div className="mixedbread-empty-icon">
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

interface ResultListProps {
  groupedResults: GroupedResult[]
  closeModal: () => void
}

const ResultList = ({ groupedResults, closeModal }: ResultListProps) => {
  const resultsText = groupedResults.length === 1 ? '1 result found' : `${groupedResults.length} results found`

  return (
    <>
      <div className="sr-only">{resultsText}</div>
      <ol className="mixedbread__results">
        {groupedResults.map((group) => (
          <ResultItem key={group.page.id} group={group} closeModal={closeModal} />
        ))}
      </ol>
    </>
  )
}

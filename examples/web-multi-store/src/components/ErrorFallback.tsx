export function ErrorFallback({ error, resetErrorBoundary }: { error: Error; resetErrorBoundary: () => void }) {
  return (
    <div className="error">
      <h3>Something went wrong:</h3>
      <pre style={{ whiteSpace: 'pre-wrap' }}>{error.message}</pre>
      <button type="button" onClick={resetErrorBoundary}>
        Try again
      </button>
    </div>
  )
}

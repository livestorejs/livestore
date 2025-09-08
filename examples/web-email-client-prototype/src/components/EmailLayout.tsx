import type React from 'react'
import { useEmailStore } from '../hooks/useEmailStore.ts'
import { LabelSidebar } from './LabelSidebar.tsx'
import { ThreadView } from './ThreadView.tsx'

/**
 * EmailLayout - Main email client layout component
 *
 * Layout structure:
 * - Left sidebar with labels
 * - Main content area with thread view
 * - Gmail-inspired design patterns
 */

export const EmailLayout: React.FC = () => {
  const { getCurrentThread, getCurrentLabel } = useEmailStore()

  const currentThread = getCurrentThread()
  const currentLabel = getCurrentLabel()

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Left Sidebar */}
      <div className="w-64 bg-white border-r border-gray-200">
        <div className="p-4 border-b border-gray-200">
          <h1 className="text-xl font-semibold text-gray-900">📧 Email Client Prototype</h1>
          <p className="text-sm text-gray-500 mt-1">LiveStore Multi-Aggregate Demo</p>
        </div>
        <LabelSidebar />
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-medium text-gray-900">{currentLabel?.name || 'Email'}</h2>
              <p className="text-sm text-gray-500">
                {currentThread
                  ? `Thread: ${currentThread.subject}`
                  : `${currentLabel?.messageCount || 0} conversations`}
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <div className="flex items-center text-xs text-gray-500">
                <div className="w-2 h-2 bg-green-400 rounded-full mr-1" />
                Real-time sync active
              </div>
            </div>
          </div>
        </div>

        {/* Thread View */}
        <div className="flex-1 overflow-hidden">
          {currentThread ? (
            <ThreadView />
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="text-4xl mb-4">📧</div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">Welcome to LiveStore Email Client</h3>
                <p className="text-gray-500 max-w-md">
                  This prototype demonstrates event sourcing with multiple aggregates. Select a label from the sidebar
                  to view email threads.
                </p>
                <div className="mt-6 p-4 bg-blue-50 rounded-lg text-left max-w-md">
                  <h4 className="font-medium text-blue-900 mb-2">🏗️ Architecture Demo:</h4>
                  <ul className="text-sm text-blue-700 space-y-1">
                    <li>• Two separate aggregates (Labels & Threads)</li>
                    <li>• Cross-aggregate event flow</li>
                    <li>• Real-time sync via Durable Objects</li>
                    <li>• Offline-first with event sourcing</li>
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

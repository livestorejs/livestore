import type React from 'react'
import { useState } from 'react'

export const UnknownEventDemo: React.FC = () => {
  const [isVisible, setIsVisible] = useState(false)
  const [currentStrategy, setCurrentStrategy] = useState('callback')

  const triggerUnknownEvent = (eventName: string, eventData: object) => {
    console.log(`🧪 Demo: Simulating unknown event: ${eventName}`, eventData)
    
    // Since unknown event handling is now built into the schema,
    // this demo shows what WOULD happen based on the current strategy
    alert(
      `Demo: Unknown event '${eventName}' encountered!\n\n` +
      `Current strategy: ${currentStrategy}\n` +
      `Check console for logs and see schema.ts for implementation details.\n\n` +
      `In a real scenario, this would be handled automatically ` +
      `during eventlog replay or sync processing.`
    )
  }

  if (!import.meta.env.DEV) {
    return null // Only show in development
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsVisible(!isVisible)}
        style={{
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          zIndex: 1000,
          background: '#007acc',
          color: 'white',
          border: 'none',
          borderRadius: '50%',
          width: '60px',
          height: '60px',
          fontSize: '24px',
          cursor: 'pointer',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        }}
        title="Unknown Event Demo"
      >
        🧪
      </button>

      {isVisible && (
        <div
          style={{
            position: 'fixed',
            bottom: '90px',
            right: '20px',
            zIndex: 1000,
            background: 'white',
            border: '2px solid #007acc',
            borderRadius: '12px',
            padding: '20px',
            minWidth: '300px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
            fontFamily: 'monospace',
          }}
        >
          <h3 style={{ margin: '0 0 15px 0', color: '#007acc' }}>
            🧪 Unknown Event Strategies Demo
          </h3>
          
          <div style={{ margin: '0 0 15px 0' }}>
            <p style={{ margin: '0 0 10px 0', fontSize: '12px', color: '#666' }}>
              Current: <strong>schema2</strong> (environment-specific callback)
            </p>
            <p style={{ margin: '0 0 15px 0', fontSize: '11px', color: '#888' }}>
              See schema.ts for all available approaches
            </p>
          </div>

          <div style={{ margin: '0 0 15px 0' }}>
            <h4 style={{ margin: '0 0 8px 0', fontSize: '13px', color: '#007acc' }}>
              Available Approaches:
            </h4>
            <div style={{ fontSize: '11px', color: '#666', lineHeight: '1.4' }}>
              <div><strong>schema1:</strong> Default (logs warning, continues)</div>
              <div><strong>schema2:</strong> Environment-specific behavior</div>
              <div><strong>schema3:</strong> Silent ignore</div>
              <div><strong>schema4:</strong> Strict fail</div>
              <div><strong>schema5:</strong> Custom logging + metrics</div>
            </div>
          </div>

          <div style={{ margin: '0 0 15px 0', padding: '8px', background: '#f0f8ff', borderRadius: '4px' }}>
            <div style={{ fontSize: '10px', color: '#2c5282', fontWeight: 'bold' }}>
              Note: Event migration handled via schema evolution & replay
            </div>
            <div style={{ fontSize: '9px', color: '#2c5282', marginTop: '2px' }}>
              See DESIGN_DECISIONS.md for future replay mechanisms
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <button
              type="button"
              onClick={() => triggerUnknownEvent('v2.NewFeature', { 
                id: 'demo-1', 
                featureData: 'some data' 
              })}
              style={{
                background: '#4CAF50',
                color: 'white',
                border: 'none',
                padding: '8px 12px',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              🆕 "v2.NewFeature" → logs info and continues
            </button>

            <button
              type="button"
              onClick={() => triggerUnknownEvent('v3.ProjectCreated', { 
                id: 'demo-3',
                projectName: 'New Project'
              })}
              style={{
                background: '#FF9800',
                color: 'white',
                border: 'none',
                padding: '8px 12px',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              📁 "v3.ProjectCreated" → future feature, continues
            </button>

            <button
              type="button"
              onClick={() => triggerUnknownEvent('CompletelyUnknown', { 
                data: 'mystery' 
              })}
              style={{
                background: '#f44336',
                color: 'white',
                border: 'none',
                padding: '8px 12px',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              ❓ "CompletelyUnknown" → dev: continue, prod: fail
            </button>
          </div>

          <button
            type="button"
            onClick={() => setIsVisible(false)}
            style={{
              position: 'absolute',
              top: '8px',
              right: '8px',
              background: 'none',
              border: 'none',
              fontSize: '16px',
              cursor: 'pointer',
              color: '#666',
            }}
          >
            ×
          </button>
        </div>
      )}
    </>
  )
}
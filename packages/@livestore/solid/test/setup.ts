/**
 * Vitest setup file to provide DOM globals for Solid tests in Node environment
 * This allows Solid tests to run in Node.js environment while avoiding WASM loading issues in jsdom
 */

import { JSDOM } from 'jsdom'

// Setup minimal DOM globals for Solid testing in Node environment
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'http://localhost:3000',
  pretendToBeVisual: true,
  resources: 'usable',
})

// Set essential DOM globals that Solid needs
global.window = dom.window as any
global.document = dom.window.document
global.HTMLElement = dom.window.HTMLElement
global.Element = dom.window.Element

// Add other DOM globals, skipping ones that cause conflicts
const skipProperties = ['navigator']
Object.keys(dom.window).forEach((property) => {
  if (typeof (global as any)[property] === 'undefined' && !skipProperties.includes(property)) {
    try {
      ;(global as any)[property] = (dom.window as any)[property]
    } catch {
      // Skip properties that can't be set
    }
  }
})
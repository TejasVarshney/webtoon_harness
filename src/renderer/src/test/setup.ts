import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Vitest runs without `globals`, so Testing Library cannot register its own cleanup.
afterEach(cleanup)

// jsdom has no ResizeObserver; react-resizable-panels reads it from the window when a Group mounts.
if (typeof window.ResizeObserver === 'undefined') {
  class ResizeObserverStub implements ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  window.ResizeObserver = ResizeObserverStub
}

// jsdom has no canvas: its own getContext returns null too, but logs "Not implemented" on every call.
// A test that needs a context spies on this itself.
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext

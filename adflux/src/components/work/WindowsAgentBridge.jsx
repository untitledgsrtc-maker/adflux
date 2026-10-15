// Phase 384 - Windows app bridge. The Windows program opens THIS website inside its window, so the UI is the
// web UI exactly. This component does nothing in a normal browser / phone (no Tauri). Inside the Windows
// program it lazy-loads the engine (recording, idle question, widget feed). Mounted once in V2AppShell.
import { lazy, Suspense } from 'react'

const Engine = lazy(() => import('./WindowsAgentEngine'))

export default function WindowsAgentBridge() {
  if (typeof window === 'undefined' || !window.__TAURI_INTERNALS__) return null
  return <Suspense fallback={null}><Engine /></Suspense>
}

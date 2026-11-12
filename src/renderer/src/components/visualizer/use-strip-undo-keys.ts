import { useEffect, useLayoutEffect, useRef } from 'react'
import { useAppStore } from '../../stores/app-store'
import type { Direction } from '../../stores/strip-history-store'
import { typingIn } from '../panel-editor/use-sketch-shortcuts'
import { stepStrip } from './strip-undo'

/** What a key press asks of the strip's history: Ctrl+Z undoes, Ctrl+Shift+Z and Ctrl+Y redo (Cmd on macOS). */
export function undoKey(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): Direction | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null
  const key = e.key.toLowerCase()
  if (key === 'z') return e.shiftKey ? 'redo' : 'undo'
  return key === 'y' && !e.shiftKey ? 'redo' : null
}

/**
 * What has the keyboard instead of the strip: a modal, and the Background editor, whose unsaved preview the bar's
 * buttons wait for too. The panel tools' popovers (Layout, Lines, Versions) do not: a Layout click is undone with the
 * popover still open.
 */
const HOLDS_KEYS = '.modal[role="dialog"], .tool-popover[aria-label="Background"]'

/**
 * The strip's undo keys, while the Webtoon tab shows the episode. Typing in a field or a bubble, a modal, the Background
 * editor and focus mode (whose sketch has its own Ctrl+Z) keep the keys: there the press is left alone, so a text
 * field's own undo still works. The Generate page, Settings and the other tabs do not mount the strip at all.
 */
export function useStripUndoKeys(episodeId: string | null): void {
  const latest = useRef(episodeId)
  useLayoutEffect(() => {
    latest.current = episodeId
  })

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.defaultPrevented || e.isComposing || typingIn(e.target) || document.querySelector(HOLDS_KEYS) !== null) return
      const direction = undoKey(e)
      const episode = latest.current
      if (direction === null || episode === null || useAppStore.getState().focusedPanelId !== null) return
      e.preventDefault()
      void stepStrip(direction, episode)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}

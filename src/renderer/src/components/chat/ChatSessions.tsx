import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronDown, SquarePen, Star } from 'lucide-react'
import type { SessionSummary } from '@shared/types'
import { useAppStore } from '../../stores/app-store'
import { relativeTime } from '../sessions/relative-time'

interface MenuState {
  session: SessionSummary
  x: number
  y: number
}

/**
 * The top of the chat: start a session, or open the list to switch, bookmark, rename or delete one.
 * Choosing a session closes the list, so rename and delete are on the right-click menu rather than a double-click.
 */
export function ChatSessions() {
  const projectId = useAppStore((s) => s.projectId)
  const sessions = useAppStore((s) => s.sessions)
  const sessionId = useAppStore((s) => s.sessionId)
  const runningThreads = useAppStore((s) => s.runningThreads)
  const { newSession, selectSession, renameSession, bookmarkSession, deleteSession } = useAppStore.getState()

  const [open, setOpen] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [confirming, setConfirming] = useState<SessionSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)

  const current = sessions.find((s) => s.id === sessionId)
  const bookmarked = sessions.filter((s) => s.bookmarked)
  const previous = sessions.filter((s) => !s.bookmarked)

  function run(task: Promise<unknown>): void {
    task.then(
      () => setError(null),
      (e: unknown) => setError(e instanceof Error ? e.message : String(e))
    )
  }

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent): void {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        if (useAppStore.getState().projectId !== null) {
          setOpen(false)
          run(useAppStore.getState().newSession())
        }
      } else if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent): void {
      if (root.current !== null && !root.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [menu])

  function startRename(s: SessionSummary): void {
    setMenu(null)
    setDraft(s.title)
    setRenamingId(s.id)
  }

  function commitRename(s: SessionSummary): void {
    const title = draft.trim()
    setRenamingId(null)
    if (title !== '' && title !== s.title) run(renameSession(s.id, title))
  }

  function onRenameKey(e: KeyboardEvent<HTMLInputElement>, s: SessionSummary): void {
    if (e.key === 'Enter') commitRename(s)
    else if (e.key === 'Escape') setRenamingId(null)
  }

  function choose(s: SessionSummary): void {
    selectSession(s.id)
    setOpen(false)
  }

  function renderItem(s: SessionSummary) {
    return (
      <li
        key={s.id}
        data-testid="session-item"
        data-running={runningThreads[s.id] !== undefined ? 'true' : undefined}
        data-selected={s.id === sessionId ? 'true' : undefined}
        className="session-item"
        onClick={() => choose(s)}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ session: s, x: e.clientX, y: e.clientY })
        }}
      >
        {renamingId === s.id ? (
          <input
            autoFocus
            aria-label="Session title"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => onRenameKey(e, s)}
            onBlur={() => commitRename(s)}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="session-title">{s.title}</span>
        )}
        {runningThreads[s.id] !== undefined ? (
          <span className="running-dot" aria-label="Running" />
        ) : (
          <span className="session-time">{relativeTime(s.updatedAt)}</span>
        )}
        <button
          type="button"
          className="session-star"
          data-testid="session-bookmark"
          data-on={s.bookmarked ? 'true' : undefined}
          aria-label={s.bookmarked ? 'Remove bookmark' : 'Bookmark'}
          aria-pressed={s.bookmarked}
          onClick={(e) => {
            e.stopPropagation()
            run(bookmarkSession(s.id, !s.bookmarked))
          }}
        >
          <Star size={14} aria-hidden="true" fill={s.bookmarked ? 'currentColor' : 'none'} />
        </button>
      </li>
    )
  }

  return (
    <div className="chat-sessions" ref={root}>
      <div className="chat-sessions-bar">
        <button type="button" className="new-session" data-testid="new-session" disabled={projectId === null} onClick={() => run(newSession())}>
          <SquarePen size={16} aria-hidden="true" />
          <span>New session</span>
          <kbd>Ctrl N</kbd>
        </button>
        <button
          type="button"
          className="sessions-toggle"
          data-testid="sessions-toggle"
          aria-expanded={open}
          aria-haspopup="true"
          disabled={projectId === null}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="sessions-toggle-title">{current?.title ?? 'No session'}</span>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
      </div>

      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}

      {open && (
        <div className="sessions-popup" data-testid="sessions-popup">
          {sessions.length === 0 && <p className="placeholder">No sessions yet.</p>}
          {bookmarked.length > 0 && (
            <>
              <h2 className="sidebar-group">Bookmarked</h2>
              <ul className="session-list">{bookmarked.map(renderItem)}</ul>
            </>
          )}
          {previous.length > 0 && (
            <>
              <h2 className="sidebar-group">Previous sessions</h2>
              <ul className="session-list">{previous.map(renderItem)}</ul>
            </>
          )}
        </div>
      )}

      {menu && (
        <div className="context-menu" role="menu" style={{ left: menu.x, top: menu.y }}>
          <button type="button" role="menuitem" onClick={() => startRename(menu.session)}>
            Rename
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setConfirming(menu.session)
              setMenu(null)
            }}
          >
            Delete
          </button>
        </div>
      )}

      {confirming && (
        <div className="modal-backdrop">
          <div className="modal" role="dialog" aria-label="Delete session">
            <p>Delete &ldquo;{confirming.title}&rdquo;? It moves to the trash.</p>
            <div className="modal-actions">
              <button type="button" onClick={() => setConfirming(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={() => {
                  const target = confirming
                  setConfirming(null)
                  run(deleteSession(target.id))
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

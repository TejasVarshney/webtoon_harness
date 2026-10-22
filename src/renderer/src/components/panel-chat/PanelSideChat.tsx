import { useEffect, useRef } from 'react'
import { assetUrl } from '@shared/asset-url'
import { newId } from '@shared/ids'
import { api, cleanIpcError } from '../../api'
import { useAppStore } from '../../stores/app-store'
import { useChatStore } from '../../stores/chat-store'
import { usePanelsStore } from '../../stores/panels-store'
import { Composer } from '../chat/Composer'
import { MessageList } from '../chat/MessageList'
import { VersionSwitcher } from './VersionSwitcher'

export interface PanelSideChatProps {
  panelId: string
}

/**
 * The chat bound to one panel, below the main chat: its image and number, the version switcher, and its own thread
 * (`panel:<id>`). The panel comes from the open episode's strip, so the switcher and the thumbnail follow every
 * change the agent or the editor makes. Escape or the close button deselects the panel.
 */
export function PanelSideChat({ panelId }: PanelSideChatProps) {
  const projectId = useAppStore((s) => s.projectId)
  const activeEpisodeId = useAppStore((s) => s.activeEpisodeId)
  const storeProjectId = usePanelsStore((s) => s.projectId)
  const episodesLoaded = usePanelsStore((s) => s.episodesLoaded)
  const loadError = usePanelsStore((s) => s.error)
  const panels = usePanelsStore((s) => (activeEpisodeId === null ? undefined : s.panelsByEpisode[activeEpisodeId]))
  const rootRef = useRef<HTMLElement>(null)

  // Panels of another project must never show here, whatever the store still holds.
  const loaded = storeProjectId === projectId && episodesLoaded && (activeEpisodeId === null || panels !== undefined)
  const index = loaded && panels !== undefined ? panels.findIndex((p) => p.id === panelId) : -1
  const panel = index === -1 ? undefined : panels?.[index]

  // A panel selected from a chat thumbnail can arrive before the Webtoon tab ever loaded the strip.
  useEffect(() => {
    if (projectId !== null && !loaded) void usePanelsStore.getState().loadEpisodes()
  }, [projectId, loaded])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return
      // A dialog (the panel editor, settings, a confirmation) owns Escape while it is open, and so does an input
      // or a select elsewhere (a rename box, the model picker).
      if (document.querySelector('[role="dialog"]') !== null) return
      const target = e.target
      if (target instanceof Element && !rootRef.current?.contains(target) && target.closest('input, select') !== null) return
      useAppStore.getState().selectPanel(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  const current = panel?.versions.find((v) => v.id === panel.currentVersionId)
  const imagePath = current?.status === 'ready' ? current.imagePath : null

  return (
    <section className="panel-side-chat" data-testid="panel-side-chat" aria-label="Panel chat" ref={rootRef}>
      <header className="side-chat-header">
        {panel !== undefined && projectId !== null && imagePath !== null && (
          <img className="side-chat-thumb" src={assetUrl(projectId, imagePath)} alt={panel.description} />
        )}
        {panel !== undefined && <h2>{`Panel ${index + 1}`}</h2>}
        {panel !== undefined && <VersionSwitcher panel={panel} />}
        <button type="button" className="side-chat-close" aria-label="Close panel chat" onClick={() => useAppStore.getState().selectPanel(null)}>
          ×
        </button>
      </header>
      {panel !== undefined && projectId !== null ? (
        <PanelThread projectId={projectId} panelId={panel.id} />
      ) : loaded ? (
        <p className="placeholder">Panel not in the current episode</p>
      ) : loadError !== null ? (
        <p role="alert" className="error">
          {loadError}
        </p>
      ) : (
        <p className="placeholder">Loading panel…</p>
      )}
    </section>
  )
}

interface PanelThreadProps {
  projectId: string
  panelId: string
}

/** The panel's persisted thread and its composer. */
function PanelThread({ projectId, panelId }: PanelThreadProps) {
  const threadKey = `panel:${panelId}`
  const runId = useAppStore((s) => s.runningThreads[threadKey])

  useEffect(() => {
    let stale = false
    useChatStore
      .getState()
      .load(threadKey, async () => {
        const loaded = await api.invoke('panelChat:load', { projectId, panelId })
        if (stale) throw new Error('stale')
        return loaded
      })
      .catch((e: unknown) => {
        if (!stale) useChatStore.getState().addNotice(threadKey, cleanIpcError(e).message)
      })
    return () => {
      stale = true
    }
  }, [projectId, panelId, threadKey])

  function send(text: string): void {
    const chat = useChatStore.getState()
    chat.clearNotices(threadKey)
    // The runner persists the user message but does not emit it, so show it here. The transcript replaces it on the next load.
    const optimisticId = newId('msg')
    chat.addMessage(threadKey, { id: optimisticId, role: 'user', text, imagePaths: [], stateSnapshot: null, createdAt: new Date().toISOString() })
    api.invoke('panelChat:send', { projectId, panelId, text }).catch((e: unknown) => {
      // Nothing was sent, so the optimistic message must not stay in the thread.
      useChatStore.getState().removeMessage(threadKey, optimisticId)
      useChatStore.getState().addNotice(threadKey, cleanIpcError(e).message)
    })
  }

  function stop(): void {
    if (runId === undefined) return
    api.invoke('panelChat:cancel', { runId }).catch((e: unknown) => useChatStore.getState().addNotice(threadKey, cleanIpcError(e).message))
  }

  // `panelChat:send` carries text only, so there is nothing to attach images to.
  return (
    <>
      <MessageList threadKey={threadKey} />
      <Composer onSend={send} running={runId !== undefined} onStop={stop} allowAttach={false} />
    </>
  )
}

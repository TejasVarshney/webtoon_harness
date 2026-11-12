import { useAppStore } from '../../stores/app-store'
import { closeMenuDialog, dismissMenuError, useMenuStore } from '../../stores/menu-store'
import { NewProjectDialog } from '../sessions/NewProjectDialog'
import { SettingsDialog } from '../settings/SettingsDialog'

/**
 * What the window's File menu opens: the New project and Settings dialogs, and the reason a project would not open.
 * Mounted on every screen (home, workspace, Generate page), as the menu bar is always there.
 */
export function MenuDialogs() {
  const dialog = useMenuStore((s) => s.dialog)
  const error = useMenuStore((s) => s.error)
  return (
    <>
      {error !== null && (
        <div role="alert" className="error menu-error">
          <span>{error}</span>
          <button type="button" onClick={dismissMenuError}>
            Dismiss
          </button>
        </div>
      )}
      {dialog === 'settings' && <SettingsDialog onClose={closeMenuDialog} />}
      {dialog === 'newProject' && (
        <NewProjectDialog
          onCancel={closeMenuDialog}
          onCreate={async (title, stylePreset) => {
            await useAppStore.getState().createProject(title, stylePreset)
            closeMenuDialog()
          }}
        />
      )}
    </>
  )
}

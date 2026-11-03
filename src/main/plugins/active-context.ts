export interface ActiveContextValue {
  projectId: string | null
  episodeId: string | null
}

/** The project and episode the window shows, as the renderer last reported them (`app:setActiveContext`). */
export class ActiveContext {
  private value: ActiveContextValue = { projectId: null, episodeId: null }

  get(): ActiveContextValue {
    return { ...this.value }
  }

  set(value: ActiveContextValue): void {
    this.value = { projectId: value.projectId, episodeId: value.episodeId }
  }
}

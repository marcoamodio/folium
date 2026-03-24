export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

type Listener = ((status: SaveStatus) => void) | null

let listener: Listener = null

export function registerSaveStatusNotifier(fn: Listener): void {
  listener = fn
}

export function notifySaveStatus(status: SaveStatus): void {
  listener?.(status)
}

import Dexie, { type Table } from 'dexie'
import type { TLEditorSnapshot } from 'tldraw'

export const CANVAS_ID = 'main' as const

export interface CanvasRow {
  id: string
  snapshot: TLEditorSnapshot
  updatedAt: number
}

class FoliumDB extends Dexie {
  canvas!: Table<CanvasRow, string>

  constructor() {
    super('folium')
    this.version(1).stores({
      canvas: 'id, updatedAt',
    })
  }
}

export const db = new FoliumDB()

export async function loadCanvasRow(): Promise<CanvasRow | undefined> {
  return db.canvas.get(CANVAS_ID)
}

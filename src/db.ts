import Dexie, { type Table } from 'dexie'

export const CANVAS_ID = 'main' as const

export interface CanvasRow {
  id: string
  payload: string
  updatedAt: number
}

class FoliumDB extends Dexie {
  canvas!: Table<CanvasRow, string>

  constructor() {
    super('folium')
    this.version(1).stores({
      canvas: 'id, updatedAt',
    })
    this.version(2)
      .stores({
        canvas: 'id, updatedAt',
      })
      .upgrade(async (tx) => {
        await tx.table('canvas').clear()
      })
  }
}

export const db = new FoliumDB()

export async function loadCanvasRow(): Promise<CanvasRow | undefined> {
  return db.canvas.get(CANVAS_ID)
}

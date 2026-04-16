import Dexie, { type Table } from 'dexie'

export const CANVAS_ID = 'main' as const

/** Single-row table: PBKDF2 seed for AES-GCM (see `cryptoKey.ts`). */
export const KEY_SEED_ROW_ID = 'folium-key-seed' as const

export interface KeySeedRow {
  id: string
  seedB64: string
}

export interface CanvasRow {
  id: string
  payload: string
  updatedAt: number
}

class FoliumDB extends Dexie {
  canvas!: Table<CanvasRow, string>
  keySeed!: Table<KeySeedRow, string>

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
    this.version(3).stores({
      canvas: 'id, updatedAt',
      keySeed: 'id',
    })
  }
}

export const db = new FoliumDB()

export async function loadCanvasRow(): Promise<CanvasRow | undefined> {
  return db.canvas.get(CANVAS_ID)
}

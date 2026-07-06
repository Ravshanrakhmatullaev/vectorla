import { createContext, useContext, useState, type ReactNode } from 'react'
import { demoAssets, type DemoAsset } from '@/data/demoAssets'

interface DemoAssetContextValue {
  asset: DemoAsset
}

const DemoAssetContext = createContext<DemoAssetContextValue | undefined>(undefined)

function pickRandomAsset(): DemoAsset {
  const index = Math.floor(Math.random() * demoAssets.length)
  // demoAssets is a static, non-empty literal array — index is always in range.
  return demoAssets[index]!
}

/**
 * Picks one random demo asset per page load (lazy useState initializer runs
 * once on mount, not on re-render) and shares it with every consumer below —
 * this is how Hero and WorkspacePreview end up showing the same asset without
 * either owning the selection themselves.
 */
export function DemoAssetProvider({ children }: { children: ReactNode }) {
  const [asset] = useState(pickRandomAsset)

  return <DemoAssetContext.Provider value={{ asset }}>{children}</DemoAssetContext.Provider>
}

export function useDemoAsset(): DemoAssetContextValue {
  const ctx = useContext(DemoAssetContext)
  if (!ctx) throw new Error('useDemoAsset must be used within a DemoAssetProvider')
  return ctx
}

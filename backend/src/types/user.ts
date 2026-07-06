// Intentionally mirrors the frontend's PricingPlanId ('free' | 'pro' | 'business')
// in src/data/i18n.ts — not imported directly, since the backend and frontend
// are separate deployables with no build-time dependency on each other.
export type UserPlan = 'free' | 'pro' | 'business'

export interface User {
  id: string
  email: string
  displayName: string | null
  avatarUrl: string | null
  plan: UserPlan
  createdAt: string
  updatedAt: string
}

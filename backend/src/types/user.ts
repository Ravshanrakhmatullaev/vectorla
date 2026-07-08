// Intentionally mirrors the frontend's PricingPlanId in src/data/i18n.ts —
// not imported directly, since the backend and frontend are separate
// deployables with no build-time dependency on each other.
//
// NOTE: the frontend's PricingPlanId is still 'free' | 'pro' | 'business'
// (3 tiers, no credits concept) as of this writing — this 'starter' tier and
// the credits model in config/index.ts and types/pricing.ts are backend/
// planning ahead of a frontend update. See backend/README.md "Pricing &
// Credits" for the full design and what still needs to change on the
// frontend to match.
export type UserPlan = 'free' | 'starter' | 'pro' | 'business'

export function isUserPlan(value: string): value is UserPlan {
  return value === 'free' || value === 'starter' || value === 'pro' || value === 'business'
}

export interface User {
  id: string
  email: string
  displayName: string | null
  avatarUrl: string | null
  plan: UserPlan
  createdAt: string
  updatedAt: string
}

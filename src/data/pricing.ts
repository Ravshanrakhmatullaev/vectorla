import type { PricingPlanId } from '@/data/i18n'

export interface PricingPlan {
  id: PricingPlanId
  highlighted?: boolean
}

export const pricingPlans: PricingPlan[] = [
  { id: 'free' },
  { id: 'pro', highlighted: true },
  { id: 'business' },
]

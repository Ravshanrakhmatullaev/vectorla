import type { PricingPlanId } from '@/data/i18n'

export interface PricingPlan {
  id: PricingPlanId
  highlighted?: boolean
  /** Not purchasable yet: shown with a "Coming soon" badge and a disabled button. */
  comingSoon?: boolean
}

export const pricingPlans: PricingPlan[] = [
  { id: 'free', highlighted: true },
  { id: 'paid', comingSoon: true },
]

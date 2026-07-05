export interface PricingPlan {
  name: string
  price: string
  period?: string
  description: string
  features: string[]
  cta: string
  highlighted?: boolean
}

export const pricingPlans: PricingPlan[] = [
  {
    name: 'Free',
    price: '$0',
    description: 'Try Vectorla on real projects before you commit.',
    features: ['5 conversions / month', 'SVG export', 'Basic presets'],
    cta: 'Start free',
  },
  {
    name: 'Pro',
    price: '$19',
    period: '/month',
    description: 'For designers and shops running conversions every day.',
    features: [
      'Unlimited conversions',
      'Batch processing',
      'SVG / PDF / DXF / EPS export',
      'Print-ready mode',
      'Priority processing',
    ],
    cta: 'Start Pro trial',
    highlighted: true,
  },
  {
    name: 'Business',
    price: 'Custom',
    description: 'For teams and agencies with shared workspaces and API needs.',
    features: [
      'Team workspace',
      'API access',
      'Brand presets',
      'Advanced export',
      'Dedicated support',
    ],
    cta: 'Talk to sales',
  },
]

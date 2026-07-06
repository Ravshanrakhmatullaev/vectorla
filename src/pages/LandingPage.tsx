import { lazy, Suspense } from 'react'
import { Hero } from '@/components/Hero'
import { CompatibleWith } from '@/components/CompatibleWith'
import { SectionFallback } from '@/components/SectionFallback'

// Below-the-fold sections are code-split so the initial bundle only needs to
// cover Hero + CompatibleWith for first paint.
const WorkspacePreview = lazy(() =>
  import('@/components/WorkspacePreview').then((m) => ({ default: m.WorkspacePreview })),
)
const Features = lazy(() => import('@/components/Features').then((m) => ({ default: m.Features })))
const UseCases = lazy(() => import('@/components/UseCases').then((m) => ({ default: m.UseCases })))
const Pricing = lazy(() => import('@/components/Pricing').then((m) => ({ default: m.Pricing })))
const Faq = lazy(() => import('@/components/Faq').then((m) => ({ default: m.Faq })))

export function LandingPage() {
  return (
    <>
      <Hero />
      <CompatibleWith />
      <Suspense fallback={<SectionFallback />}>
        <WorkspacePreview />
      </Suspense>
      <Suspense fallback={<SectionFallback />}>
        <Features />
      </Suspense>
      <Suspense fallback={<SectionFallback />}>
        <UseCases />
      </Suspense>
      <Suspense fallback={<SectionFallback />}>
        <Pricing />
      </Suspense>
      <Suspense fallback={<SectionFallback />}>
        <Faq />
      </Suspense>
    </>
  )
}

import { Hero } from '@/components/Hero'
import { WorkspacePreview } from '@/components/WorkspacePreview'
import { Features } from '@/components/Features'
import { UseCases } from '@/components/UseCases'
import { Pricing } from '@/components/Pricing'
import { Faq } from '@/components/Faq'

export function LandingPage() {
  return (
    <>
      <Hero />
      <WorkspacePreview />
      <Features />
      <UseCases />
      <Pricing />
      <Faq />
    </>
  )
}

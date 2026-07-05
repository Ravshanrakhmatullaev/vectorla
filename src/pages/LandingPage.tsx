import { Hero } from '@/components/Hero'
import { CompatibleWith } from '@/components/CompatibleWith'
import { WorkspacePreview } from '@/components/WorkspacePreview'
import { Features } from '@/components/Features'
import { UseCases } from '@/components/UseCases'
import { Pricing } from '@/components/Pricing'
import { Faq } from '@/components/Faq'

export function LandingPage() {
  return (
    <>
      <Hero />
      <CompatibleWith />
      <WorkspacePreview />
      <Features />
      <UseCases />
      <Pricing />
      <Faq />
    </>
  )
}

import { lazy, Suspense } from 'react'
import { ThemeProvider } from '@/lib/theme'
import { LanguageProvider } from '@/lib/language'
import { DemoAssetProvider } from '@/lib/demoAsset'
import { MainLayout } from '@/layouts/MainLayout'
import { LandingPage } from '@/pages/LandingPage'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { ErrorFallback } from '@/components/ErrorFallback'
import { SectionFallback } from '@/components/SectionFallback'
import { AuthProvider } from '@/lib/auth'
import { CreditsProvider } from '@/lib/credits'
import { RouterProvider } from '@/lib/router'
import { useRouter } from '@/lib/useRouter'

const AccountPage = lazy(() => import('@/pages/AccountPage').then((m) => ({ default: m.AccountPage })))
const PrivacyPolicy = lazy(() => import('@/pages/legal/PrivacyPolicy').then((m) => ({ default: m.PrivacyPolicy })))
const TermsOfService = lazy(() => import('@/pages/legal/TermsOfService').then((m) => ({ default: m.TermsOfService })))

function CurrentPage() {
  const { path } = useRouter()
  switch (path.replace(/\/+$/, '') || '/') {
    case '/account':
      return <AccountPage />
    case '/privacy':
      return <PrivacyPolicy />
    case '/terms':
      return <TermsOfService />
    default:
      return (
        <DemoAssetProvider>
          <LandingPage />
        </DemoAssetProvider>
      )
  }
}

function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <RouterProvider>
          <AuthProvider>
            <CreditsProvider>
              <MainLayout>
                <ErrorBoundary fallback={<ErrorFallback />}>
                  <Suspense fallback={<SectionFallback />}>
                    <CurrentPage />
                  </Suspense>
                </ErrorBoundary>
              </MainLayout>
            </CreditsProvider>
          </AuthProvider>
        </RouterProvider>
      </LanguageProvider>
    </ThemeProvider>
  )
}

export default App

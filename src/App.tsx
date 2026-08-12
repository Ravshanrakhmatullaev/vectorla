import { ThemeProvider } from '@/lib/theme'
import { LanguageProvider } from '@/lib/language'
import { DemoAssetProvider } from '@/lib/demoAsset'
import { MainLayout } from '@/layouts/MainLayout'
import { LandingPage } from '@/pages/LandingPage'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { ErrorFallback } from '@/components/ErrorFallback'
import { AuthProvider } from '@/lib/auth'

function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <AuthProvider>
          <MainLayout>
            <ErrorBoundary fallback={<ErrorFallback />}>
              <DemoAssetProvider>
                <LandingPage />
              </DemoAssetProvider>
            </ErrorBoundary>
          </MainLayout>
        </AuthProvider>
      </LanguageProvider>
    </ThemeProvider>
  )
}

export default App

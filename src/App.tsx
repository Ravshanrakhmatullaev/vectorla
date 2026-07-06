import { ThemeProvider } from '@/lib/theme'
import { LanguageProvider } from '@/lib/language'
import { DemoAssetProvider } from '@/lib/demoAsset'
import { MainLayout } from '@/layouts/MainLayout'
import { LandingPage } from '@/pages/LandingPage'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { ErrorFallback } from '@/components/ErrorFallback'

function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <MainLayout>
          <ErrorBoundary fallback={<ErrorFallback />}>
            <DemoAssetProvider>
              <LandingPage />
            </DemoAssetProvider>
          </ErrorBoundary>
        </MainLayout>
      </LanguageProvider>
    </ThemeProvider>
  )
}

export default App

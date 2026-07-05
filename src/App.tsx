import { ThemeProvider } from '@/lib/theme'
import { LanguageProvider } from '@/lib/language'
import { MainLayout } from '@/layouts/MainLayout'
import { LandingPage } from '@/pages/LandingPage'

function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <MainLayout>
          <LandingPage />
        </MainLayout>
      </LanguageProvider>
    </ThemeProvider>
  )
}

export default App

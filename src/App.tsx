import { ThemeProvider } from '@/lib/theme'
import { MainLayout } from '@/layouts/MainLayout'
import { LandingPage } from '@/pages/LandingPage'

function App() {
  return (
    <ThemeProvider>
      <MainLayout>
        <LandingPage />
      </MainLayout>
    </ThemeProvider>
  )
}

export default App

import type { ImageType, EstimatedQuality, VectorizationProviderName } from '@/lib/api/types'

export type Language = 'en' | 'uz' | 'ru'

export interface LanguageOption {
  code: Language
  label: string
}

export const languageOptions: LanguageOption[] = [
  { code: 'en', label: 'EN' },
  { code: 'uz', label: 'UZ' },
  { code: 'ru', label: 'RU' },
]

export type NavId = 'features' | 'useCases' | 'pricing' | 'faq'

export type TrustBadgeId =
  | 'browserBased'
  | 'svgExport'
  | 'privateProcessing'
  | 'fastPreview'

export type FeatureId =
  | 'multiColorTrace'
  | 'smoothCurves'
  | 'gaplessShapes'
  | 'gradients'
  | 'jpegCleanup'
  | 'professionalTrace'
  | 'qrPixelArt'
  | 'signatureToSvg'
  | 'sketchToVector'
  | 'editableSvg'

export type UseCaseId =
  | 'designers'
  | 'printShops'
  | 'advertisingAgencies'
  | 'cncLaserCutting'
  | 'stickerProduction'
  | 'uvPrinting'
  | 'dtfTextilePrinting'
  | 'logoCleanup'
  | 'qrCodeVectorization'

export type PricingPlanId = 'free' | 'paid'

export type FaqId =
  | 'isFree'
  | 'uploadedToServer'
  | 'canExportSvg'
  | 'goodForPrinting'
  | 'cncLaserCutting'
  | 'batchProcessing'
  | 'apiAccess'

export type FooterColumnId = 'product' | 'legal'

interface TextItem {
  title: string
  description: string
}

interface PricingPlanText {
  name: string
  price: string
  description: string
  features: string[]
  cta: string
}

interface FaqItemText {
  question: string
  answer: string
}

interface FooterColumnText {
  title: string
  links: string[]
}

export interface Translation {
  nav: {
    features: string
    useCases: string
    pricing: string
    faq: string
    account: string
    signIn: string
    startFree: string
    openMenu: string
    closeMenu: string
  }
  auth: {
    signInTitle: string
    signUpTitle: string
    recoveryTitle: string
    updatePasswordTitle: string
    email: string
    password: string
    newPassword: string
    signIn: string
    signUp: string
    signOut: string
    sendReset: string
    updatePassword: string
    forgotPassword: string
    createAccount: string
    haveAccount: string
    backToSignIn: string
    confirmationSent: string
    recoverySent: string
    passwordUpdated: string
    close: string
    notConfigured: string
    requestFailed: string
  }
  common: {
    switchToLightMode: string
    switchToDarkMode: string
    compareSliderLabel: string
    skipToContent: string
    errorTitle: string
    errorDescription: string
    reloadPage: string
    loading: string
  }
  hero: {
    badge: string
    title: string
    description: string
    primaryCta: string
    dragDropTitle: string
    dragDropSubtitle: string
    browseFiles: string
    workflow: {
      upload: string
      trace: string
      export: string
    }
    original: string
    vectorized: string
    dragHint: string
  }
  compatibleWith: {
    title: string
  }
  trustBadges: Record<TrustBadgeId, string>
  workspace: {
    eyebrow: string
    title: string
    description: string
    windowUrl: string
    uploadImage: string
    exportAs: string
    dropTitle: string
    dropSubtitle: string
    browseFiles: string
    newImage: string
    previewModeBadge: string
    previewModeMessage: string
    exportDisabledNote: string
    statusUploading: string
    statusQueued: string
    statusProcessing: string
    statusFetchingResult: string
    statusFailedTitle: string
    uploadFailedTitle: string
    authRequiredTitle: string
    insufficientCreditsTitle: string
    fetchResultFailedTitle: string
    retry: string
    download: string
    analysis: {
      title: string
      imageTypeLabel: string
      complexityLabel: string
      qualityLabel: string
      timeLabel: string
      providerLabel: string
      imageTypes: Record<ImageType, string>
      qualityLevels: Record<EstimatedQuality, string>
      providers: Record<VectorizationProviderName, string>
      badges: {
        bestForLogos: string
        bestForPhotos: string
        printReady: string
        aiRecommended: string
      }
      recommendedBadge: string
      quickTraceTitle: string
      quickTraceDescription: string
      professionalTraceTitle: string
      professionalTraceDescription: string
      qualityImprovement: Record<EstimatedQuality, string>
      professionalTraceNote: string
    }
  }
  features: {
    eyebrow: string
    title: string
    description: string
    items: Record<FeatureId, TextItem>
  }
  useCases: {
    eyebrow: string
    title: string
    description: string
    items: Record<UseCaseId, TextItem>
  }
  pricing: {
    eyebrow: string
    title: string
    description: string
    plans: Record<PricingPlanId, PricingPlanText>
  }
  faq: {
    eyebrow: string
    title: string
    items: Record<FaqId, FaqItemText>
  }
  credits: {
    /** Plural forms of "credit": one (1), few (RU 2-4), many (everything else). */
    unit: { one: string; few: string; many: string }
    navLabel: string
    pageTitle: string
    pageDescription: string
    balanceLabel: string
    costsTitle: string
    costQuick: string
    costProfessional: string
    costRefund: string
    historyTitle: string
    historyLatest: string
    historyEmpty: string
    historyEmptyHint: string
    loadError: string
    retry: string
    signInTitle: string
    signInDescription: string
    signIn: string
    notConfigured: string
    types: { credit: string; debit: string; refund: string }
    /** Friendly descriptions for ledger entries (the backend's reason text is internal). */
    reasons: { trace: string; refund: string; signup: string }
    panelTitle: string
    panelSignedOut: string
    viewHistory: string
    backHome: string
  }
  legal: {
    privacy: string
    terms: string
    englishOnly: string
    backHome: string
  }
  footer: {
    tagline: string
    columns: Record<FooterColumnId, FooterColumnText>
    copyright: string
  }
}

export const translations: Record<Language, Translation> = {
  en: {
    nav: {
      features: 'Features',
      useCases: 'Use Cases',
      pricing: 'Pricing',
      faq: 'FAQ',
      account: 'Credits',
      signIn: 'Sign in',
      startFree: 'Start free',
      openMenu: 'Open menu',
      closeMenu: 'Close menu',
    },
    auth: {
      signInTitle: 'Sign in to Vectorla',
      signUpTitle: 'Create your account',
      recoveryTitle: 'Reset your password',
      updatePasswordTitle: 'Choose a new password',
      email: 'Email',
      password: 'Password',
      newPassword: 'New password',
      signIn: 'Sign in',
      signUp: 'Create account',
      signOut: 'Sign out',
      sendReset: 'Send reset link',
      updatePassword: 'Update password',
      forgotPassword: 'Forgot password?',
      createAccount: 'Create an account',
      haveAccount: 'Already have an account?',
      backToSignIn: 'Back to sign in',
      confirmationSent: 'Check your email to confirm your account.',
      recoverySent: 'If an account exists for that email, a reset link has been sent.',
      passwordUpdated: 'Your password has been updated.',
      close: 'Close',
      notConfigured: 'Authentication is not configured for this deployment.',
      requestFailed: 'Authentication request failed. Please try again.',
    },
    common: {
      switchToLightMode: 'Switch to light mode',
      switchToDarkMode: 'Switch to dark mode',
      compareSliderLabel: 'Before and after comparison slider',
      skipToContent: 'Skip to content',
      errorTitle: 'Something went wrong',
      errorDescription: 'This section failed to load. Try reloading the page.',
      reloadPage: 'Reload page',
      loading: 'Loading',
    },
    hero: {
      badge: 'Raster-to-vector tracing',
      title: 'Turn images into clean, editable vectors.',
      description:
        'Vectorla traces logos, icons, illustrations and scans into SVG with smooth curves, sharp corners and exact colors, ready to edit, scale and print.',
      primaryCta: 'Try it with your image',
      dragDropTitle: 'Trace your own image',
      dragDropSubtitle: 'PNG, JPG or WebP · up to 5 MB',
      browseFiles: 'Go to the workspace',
      workflow: {
        upload: 'Upload',
        trace: 'Trace',
        export: 'Export',
      },
      original: 'Original',
      vectorized: 'Vectorized',
      dragHint:
        'Drag the handle to compare. This is an illustration; try your own image in the workspace below.',
    },
    compatibleWith: {
      title: 'Compatible with',
    },
    trustBadges: {
      browserBased: 'Works in your browser',
      svgExport: 'SVG output',
      privateProcessing: 'Files private to your account',
      fastPreview: 'Usually done in seconds',
    },
    workspace: {
      eyebrow: 'Workspace',
      title: 'Try it on your own image',
      description:
        'Upload a PNG, JPG or WebP. Vectorla analyzes it, traces it and gives you an SVG to download.',
      windowUrl: 'vectorla.app',
      uploadImage: 'Upload image',
      exportAs: 'Output:',
      dropTitle: 'Drop your image to vectorize',
      dropSubtitle: 'or click to browse — PNG, JPG or WebP, up to 5 MB',
      browseFiles: 'Browse files',
      newImage: 'Upload another image',
      previewModeBadge: 'Preview Mode',
      previewModeMessage:
        'Preview mode: this site is not connected to the tracing service, so images are not uploaded or processed.',
      exportDisabledNote: 'Your SVG can be downloaded here when tracing finishes.',
      statusUploading: 'Uploading…',
      statusQueued: 'Queued — waiting to start',
      statusProcessing: 'Vectorizing your image…',
      statusFetchingResult: 'Fetching your result…',
      statusFailedTitle: 'Conversion failed',
      uploadFailedTitle: 'Upload failed',
      authRequiredTitle: 'Sign in required',
      insufficientCreditsTitle: 'Not enough credits',
      fetchResultFailedTitle: 'Could not load result',
      retry: 'Retry',
      download: 'Download',
      analysis: {
        title: 'Analysis',
        imageTypeLabel: 'Type',
        complexityLabel: 'Complexity',
        qualityLabel: 'Quality',
        timeLabel: 'Time',
        providerLabel: 'Engine',
        imageTypes: { photo: 'Photo', illustration: 'Illustration', logo: 'Logo' },
        qualityLevels: { high: 'High', medium: 'Medium', low: 'Low' },
        providers: { vectorla: 'Vectorla', placeholder: 'ImageTracer', potrace: 'Potrace', vision: 'External engine', openai: 'External engine' },
        badges: {
          bestForLogos: 'Best for logos',
          bestForPhotos: 'Photos trace as stylized art',
          printReady: 'Traces cleanly',
          aiRecommended: 'Professional Trace recommended',
        },
        recommendedBadge: 'Recommended',
        quickTraceTitle: 'Quick Trace',
        quickTraceDescription: 'Fast, for most images',
        professionalTraceTitle: 'Professional Trace ⭐',
        professionalTraceDescription: 'More colors · smooth gradients',
        qualityImprovement: {
          high: 'Minor quality improvement expected',
          medium: 'Noticeable quality improvement expected',
          low: 'Major quality improvement expected',
        },
        professionalTraceNote: 'Professional Trace keeps up to 64 colors, separates close shades more finely and turns smooth color ramps into real SVG gradients. It costs 2 credits and takes a little longer.',
      },
    },
    features: {
      eyebrow: 'Features',
      title: 'What the tracing engine does',
      description: 'Vectorla is built for one job: turning raster images into clean, accurate vector shapes.',
      items: {
        multiColorTrace: {
          title: 'Multi-color tracing',
          description:
            'Logos and illustrations are split into their real colors and traced as separate, editable shapes.',
        },
        smoothCurves: {
          title: 'Smooth curves, sharp corners',
          description:
            'Curves become smooth Bézier paths, while real corners stay crisp instead of being rounded off.',
        },
        gaplessShapes: {
          title: 'No gaps between colors',
          description:
            'Neighboring shapes share the same edge, so there are no hairline gaps or overlaps between colors.',
        },
        gradients: {
          title: 'Gradient reconstruction',
          description:
            'Linear and radial gradients are rebuilt as real SVG gradients instead of dozens of color bands.',
        },
        jpegCleanup: {
          title: 'JPEG cleanup',
          description:
            'Compression artifacts and color fringes around edges are filtered out before tracing.',
        },
        professionalTrace: {
          title: 'Professional Trace',
          description:
            'An optional mode for detailed artwork: up to 64 colors, finer separation of close shades, and smooth color ramps traced as real SVG gradients.',
        },
        qrPixelArt: {
          title: 'QR codes and pixel art',
          description: 'Square, grid-aligned shapes are traced with straight edges and square corners.',
        },
        signatureToSvg: {
          title: 'Signatures and line art',
          description: 'Scanned signatures and ink drawings become smooth single-color vector shapes.',
        },
        sketchToVector: {
          title: 'Sketches and scans',
          description: 'Hand-drawn artwork keeps its character, with small specks and noise removed.',
        },
        editableSvg: {
          title: 'Standard, editable SVG',
          description:
            'Results are plain SVG files that open in Illustrator, Figma, Inkscape, CorelDRAW and other vector editors.',
        },
      },
    },
    useCases: {
      eyebrow: 'Use Cases',
      title: 'Who it is for',
      description: 'Anyone who needs a clean vector version of a raster image.',
      items: {
        designers: {
          title: 'Designers',
          description: 'Turn raster references, old logos and rough concepts into editable vector artwork.',
        },
        printShops: {
          title: 'Print Shops',
          description: 'Rebuild customer-supplied logos as clean vectors that print sharply at any size.',
        },
        advertisingAgencies: {
          title: 'Advertising Agencies',
          description: 'Convert client logos and assets quickly without redrawing them by hand.',
        },
        cncLaserCutting: {
          title: 'CNC & Laser Cutting',
          description:
            'Trace drawings and logos to SVG outlines for cutting or CAM software that accepts SVG.',
        },
        stickerProduction: {
          title: 'Sticker Production',
          description: 'Turn sticker artwork into crisp vectors that scale cleanly to any size.',
        },
        uvPrinting: {
          title: 'UV Printing',
          description: 'Get crisp vector artwork for UV printers instead of blurry, pixelated sources.',
        },
        dtfTextilePrinting: {
          title: 'DTF / Textile Printing',
          description: 'Vectorize artwork for direct-to-film and textile transfer workflows.',
        },
        logoCleanup: {
          title: 'Logo Cleanup',
          description: 'Rebuild a low-resolution or damaged logo into a crisp, scalable master file.',
        },
        qrCodeVectorization: {
          title: 'QR Code Vectorization',
          description:
            'Rebuild QR codes as clean vector squares for sharp printing at any size. Always test-scan before printing.',
        },
      },
    },
    pricing: {
      eyebrow: 'Pricing',
      title: 'Start free',
      description: 'Every new account gets 10 free credits. Paid plans are coming soon.',
      plans: {
        free: {
          name: 'Free',
          price: '$0',
          description: 'Everything Vectorla does today, free to try.',
          features: ['10 free credits when you sign up', 'Quick Trace: 1 credit per image', 'Professional Trace: 2 credits per image', 'SVG download', 'Credits back automatically if a trace fails'],
          cta: 'Start free',
        },
        paid: {
          name: 'Paid plans',
          price: 'Coming soon',
          description:
            'Plans with more credits are planned. Prices and features are not set yet, and nothing is for sale today.',
          features: [],
          cta: 'Coming soon',
        },
      },
    },
    faq: {
      eyebrow: 'FAQ',
      title: 'Frequently asked questions',
      items: {
        isFree: {
          question: 'Is Vectorla free?',
          answer:
            'New accounts get 10 free credits. A Quick Trace uses 1 credit and a Professional Trace uses 2. If a trace fails, its credits are refunded automatically.',
        },
        uploadedToServer: {
          question: 'Are my files uploaded to a server?',
          answer:
            'Yes. To trace an image, Vectorla uploads it to our servers, processes it there, and stores the original and the resulting SVG with your account. Only you can access them, while signed in. Both are deleted automatically 30 days after upload. See the Privacy Policy for details.',
        },
        canExportSvg: {
          question: 'Which formats can I download?',
          answer:
            'SVG. It opens in Illustrator, Figma, Inkscape, CorelDRAW and most other vector editors. PDF, EPS and DXF export are not available yet.',
        },
        goodForPrinting: {
          question: 'Is it good for printing?',
          answer:
            "Vectorla produces clean vector shapes with exact colors that scale to any size. It does not convert colors to CMYK or check files against a printer's specifications, so review the file in your design software before sending it to print.",
        },
        cncLaserCutting: {
          question: 'Can I use it for CNC or laser cutting?',
          answer:
            'You can import the SVG into cutting or CAM software that accepts SVG. Vectorla does not export DXF or generate dedicated cut lines yet.',
        },
        batchProcessing: {
          question: 'Can I upload many images at once?',
          answer: 'Not yet. Images are traced one at a time.',
        },
        apiAccess: {
          question: 'Is there an API?',
          answer: 'A public API is not available yet.',
        },
      },
    },
    credits: {
      unit: {
        one: 'credit',
        few: 'credits',
        many: 'credits',
      },
      navLabel: 'Credits',
      pageTitle: 'Credits',
      pageDescription: 'Your current balance and every credit added to or used from your account.',
      balanceLabel: 'Available balance',
      costsTitle: 'How credits are used',
      costQuick: 'Quick Trace uses 1 credit per image.',
      costProfessional: 'Professional Trace uses 2 credits per image.',
      costRefund: 'If a trace fails, its credits are refunded automatically.',
      historyTitle: 'Credit history',
      historyLatest: 'Showing your {count} most recent entries.',
      historyEmpty: 'No credit activity yet',
      historyEmptyHint: 'Credits you receive and use will appear here.',
      loadError: 'Could not load your credits. Check your connection and try again.',
      retry: 'Try again',
      signInTitle: 'Sign in to see your credits',
      signInDescription: 'Your balance and credit history appear here once you are signed in.',
      signIn: 'Sign in',
      notConfigured:
        'Credits are not available in this preview because it is not connected to the Vectorla service.',
      types: {
        credit: 'Added',
        debit: 'Used',
        refund: 'Refunded',
      },
      reasons: {
        trace: 'Image traced',
        refund: 'Refund for a failed trace',
        signup: 'Free signup credits',
      },
      panelTitle: 'Your credits',
      panelSignedOut: 'Sign in to trace your own images. New accounts get 10 free credits.',
      viewHistory: 'View credit history',
      backHome: 'Back to Vectorla',
    },
    legal: {
      privacy: 'Privacy Policy',
      terms: 'Terms of Service',
      englishOnly: '',
      backHome: 'Back to Vectorla',
    },
    footer: {
      tagline: 'Precise raster-to-vector tracing for designers, print shops and makers.',
      columns: {
        product: {
          title: 'Product',
          links: ['Features', 'Use Cases', 'Pricing', 'FAQ'],
        },
        legal: {
          title: 'Legal',
          links: ['Privacy Policy', 'Terms of Service'],
        },
      },
      copyright: '© {year} Vectorla. All rights reserved.',
    },
  },
  uz: {
    nav: {
      features: 'Imkoniyatlar',
      useCases: 'Foydalanish holatlari',
      pricing: 'Narxlar',
      faq: 'Savollar',
      account: 'Kreditlar',
      signIn: 'Kirish',
      startFree: 'Bepul boshlash',
      openMenu: 'Menyuni ochish',
      closeMenu: 'Menyuni yopish',
    },
    auth: {
      signInTitle: 'Vectorla hisobiga kirish',
      signUpTitle: 'Hisob yaratish',
      recoveryTitle: 'Parolni tiklash',
      updatePasswordTitle: 'Yangi parol tanlang',
      email: 'Email',
      password: 'Parol',
      newPassword: 'Yangi parol',
      signIn: 'Kirish',
      signUp: 'Hisob yaratish',
      signOut: 'Chiqish',
      sendReset: 'Tiklash havolasini yuborish',
      updatePassword: 'Parolni yangilash',
      forgotPassword: 'Parolni unutdingizmi?',
      createAccount: 'Hisob yarating',
      haveAccount: 'Hisobingiz bormi?',
      backToSignIn: 'Kirishga qaytish',
      confirmationSent: 'Hisobingizni tasdiqlash uchun emailingizni tekshiring.',
      recoverySent: 'Agar bu emailga hisob bog‘langan bo‘lsa, tiklash havolasi yuborildi.',
      passwordUpdated: 'Parolingiz yangilandi.',
      close: 'Yopish',
      notConfigured: 'Bu joylashtirish uchun autentifikatsiya sozlanmagan.',
      requestFailed: 'Autentifikatsiya so‘rovi bajarilmadi. Qayta urinib ko‘ring.',
    },
    common: {
      switchToLightMode: "Yorug' rejimga o'tish",
      switchToDarkMode: "Qorong'i rejimga o'tish",
      compareSliderLabel: "Oldin va keyin taqqoslash slayderi",
      skipToContent: "Kontentga o'tish",
      errorTitle: "Nimadir noto'g'ri ketdi",
      errorDescription: "Bu bo'lim yuklanmadi. Sahifani qayta yuklab ko'ring.",
      reloadPage: 'Sahifani qayta yuklash',
      loading: 'Yuklanmoqda',
    },
    hero: {
      badge: 'Rastrdan vektorga trassirovka',
      title: 'Tasvirlarni toza, tahrirlanadigan vektorlarga aylantiring.',
      description:
        'Vectorla logotiplar, ikonkalar, illyustratsiyalar va skanlarni silliq egri chiziqlar, o‘tkir burchaklar va aniq ranglarga ega SVG fayllarga aylantiradi — tahrirlash, kattalashtirish va chop etishga tayyor.',
      primaryCta: 'O‘z rasmingizda sinab ko‘ring',
      dragDropTitle: 'O‘z rasmingizni trassirovka qiling',
      dragDropSubtitle: 'PNG, JPG yoki WebP · 5 MB gacha',
      browseFiles: 'Ish maydoniga o‘tish',
      workflow: {
        upload: 'Yuklash',
        trace: 'Trassirovka',
        export: 'Eksport',
      },
      original: 'Original',
      vectorized: 'Vektorlashtirilgan',
      dragHint:
        'Solishtirish uchun dastakni suring. Bu namunaviy rasm — o‘z tasviringizni quyidagi ish maydonida sinab ko‘ring.',
    },
    compatibleWith: {
      title: 'Bilan mos keladi',
    },
    trustBadges: {
      browserBased: 'Brauzerda ishlaydi',
      svgExport: 'SVG natija',
      privateProcessing: 'Fayllar faqat sizning hisobingizda',
      fastPreview: 'Odatda bir necha soniyada',
    },
    workspace: {
      eyebrow: 'Ish maydoni',
      title: 'O‘z rasmingizda sinab ko‘ring',
      description:
        'PNG, JPG yoki WebP yuklang. Vectorla uni tahlil qiladi, trassirovka qiladi va yuklab olish uchun SVG beradi.',
      windowUrl: 'vectorla.app',
      uploadImage: 'Rasm yuklash',
      exportAs: 'Natija:',
      dropTitle: 'Vektorlashtirish uchun rasmni tashlang',
      dropSubtitle: 'yoki tanlash uchun bosing — PNG, JPG yoki WebP, 5 MB gacha',
      browseFiles: 'Fayl tanlash',
      newImage: 'Boshqa rasm yuklash',
      previewModeBadge: 'Ko\'rib chiqish rejimi',
      previewModeMessage:
        'Ko‘rib chiqish rejimi: bu sayt trassirovka xizmatiga ulanmagan, shuning uchun rasmlar yuklanmaydi va qayta ishlanmaydi.',
      exportDisabledNote: 'Trassirovka tugagach, SVG faylni shu yerdan yuklab olishingiz mumkin.',
      statusUploading: 'Yuklanmoqda…',
      statusQueued: 'Navbatda — boshlanishini kutmoqda',
      statusProcessing: 'Rasm vektorlashtirilmoqda…',
      statusFetchingResult: 'Natija yuklab olinmoqda…',
      statusFailedTitle: 'Konvertatsiya muvaffaqiyatsiz tugadi',
      uploadFailedTitle: 'Yuklash muvaffaqiyatsiz tugadi',
      authRequiredTitle: 'Tizimga kirish talab qilinadi',
      insufficientCreditsTitle: 'Kredit yetarli emas',
      fetchResultFailedTitle: 'Natijani yuklab bo\'lmadi',
      retry: 'Qayta urinish',
      download: 'Yuklab olish',
      analysis: {
        title: 'Tahlil',
        imageTypeLabel: 'Turi',
        complexityLabel: 'Murakkablik',
        qualityLabel: 'Sifat',
        timeLabel: 'Vaqt',
        providerLabel: 'Dvigatel',
        imageTypes: { photo: 'Foto', illustration: 'Illyustratsiya', logo: 'Logotip' },
        qualityLevels: { high: 'Yuqori', medium: "O'rtacha", low: 'Past' },
        providers: { vectorla: 'Vectorla', placeholder: 'ImageTracer', potrace: 'Potrace', vision: 'Tashqi dvigatel', openai: 'Tashqi dvigatel' },
        badges: {
          bestForLogos: 'Logotiplar uchun eng yaxshi',
          bestForPhotos: 'Fotosuratlar stilizatsiyalangan ko‘rinishda chiqadi',
          printReady: 'Toza trassirovka qilinadi',
          aiRecommended: 'Professional Trace tavsiya etiladi',
        },
        recommendedBadge: 'Tavsiya etiladi',
        quickTraceTitle: 'Tezkor trace',
        quickTraceDescription: 'Tez, ko‘pchilik rasmlar uchun',
        professionalTraceTitle: 'Professional Trace ⭐',
        professionalTraceDescription: 'Ko‘proq ranglar · silliq gradientlar',
        qualityImprovement: {
          high: 'Sifat kam darajada yaxshilanadi',
          medium: 'Sifat sezilarli darajada yaxshilanadi',
          low: 'Sifat sezilarli darajada oshadi',
        },
        professionalTraceNote: "Professional Trace 64 tagacha rangni saqlaydi, yaqin tuslarni aniqroq ajratadi va silliq rang o'tishlarini haqiqiy SVG gradientlariga aylantiradi. U 2 kredit turadi va biroz ko'proq vaqt oladi.",
      },
    },
    features: {
      eyebrow: 'Imkoniyatlar',
      title: 'Trassirovka dvigateli nimalar qiladi',
      description:
        'Vectorla bitta vazifa uchun yaratilgan: rastr tasvirlarni toza va aniq vektor shakllarga aylantirish.',
      items: {
        multiColorTrace: {
          title: 'Ko‘p rangli trassirovka',
          description:
            'Logotip va illyustratsiyalar haqiqiy ranglariga ajratiladi va alohida, tahrirlanadigan shakllar sifatida trassirovka qilinadi.',
        },
        smoothCurves: {
          title: 'Silliq egri chiziqlar, o‘tkir burchaklar',
          description:
            'Egri chiziqlar silliq Bezye yo‘llariga aylanadi, haqiqiy burchaklar esa yumaloqlanmasdan o‘tkir qoladi.',
        },
        gaplessShapes: {
          title: 'Ranglar orasida bo‘shliq yo‘q',
          description:
            'Qo‘shni shakllar bitta umumiy chegaraga ega, shuning uchun ranglar orasida ingichka bo‘shliq yoki ustma-ust tushish bo‘lmaydi.',
        },
        gradients: {
          title: 'Gradientlarni tiklash',
          description:
            'Chiziqli va radial gradientlar o‘nlab rang chiziqlari o‘rniga haqiqiy SVG gradientlari sifatida qayta quriladi.',
        },
        jpegCleanup: {
          title: 'JPEG tozalash',
          description:
            'Siqish artefaktlari va chekkalardagi rangli hoshiyalar trassirovkadan oldin filtrlanadi.',
        },
        professionalTrace: {
          title: 'Professional Trace',
          description:
            'Batafsil tasvirlar uchun ixtiyoriy rejim: 64 tagacha rang, yaqin tuslarni aniqroq ajratish va silliq rang o‘tishlarini haqiqiy SVG gradientlari sifatida trassirovka qilish.',
        },
        qrPixelArt: {
          title: 'QR kodlar va piksel-art',
          description:
            'Kvadrat, to‘rga tekislangan shakllar to‘g‘ri qirralar va to‘g‘ri burchaklar bilan trassirovka qilinadi.',
        },
        signatureToSvg: {
          title: 'Imzolar va chiziqli rasmlar',
          description:
            'Skanerlangan imzolar va siyoh chizmalari silliq bir rangli vektor shakllarga aylanadi.',
        },
        sketchToVector: {
          title: 'Eskizlar va skanlar',
          description:
            'Qo‘lda chizilgan ishlar o‘z xarakterini saqlaydi, mayda dog‘lar va shovqin esa olib tashlanadi.',
        },
        editableSvg: {
          title: 'Standart, tahrirlanadigan SVG',
          description:
            'Natijalar Illustrator, Figma, Inkscape, CorelDRAW va boshqa vektor muharrirlarida ochiladigan oddiy SVG fayllardir.',
        },
      },
    },
    useCases: {
      eyebrow: 'Foydalanish holatlari',
      title: 'Kimlar uchun',
      description: 'Rastr tasvirning toza vektor versiyasi kerak bo‘lgan har bir kishi uchun.',
      items: {
        designers: {
          title: 'Dizaynerlar',
          description:
            'Rastr namunalar, eski logotiplar va qoralama g‘oyalarni tahrirlanadigan vektor grafikaga aylantiring.',
        },
        printShops: {
          title: 'Bosmaxonalar',
          description:
            'Mijozlar yuborgan logotiplarni istalgan o‘lchamda aniq chop etiladigan toza vektorlarga aylantiring.',
        },
        advertisingAgencies: {
          title: 'Reklama agentliklari',
          description: 'Mijoz logotiplari va materiallarini qo‘lda qayta chizmasdan tezda aylantiring.',
        },
        cncLaserCutting: {
          title: 'CNC va lazer kesish',
          description:
            'Chizmalar va logotiplarni SVG qabul qiladigan kesish yoki CAM dasturlari uchun SVG konturlarga aylantiring.',
        },
        stickerProduction: {
          title: 'Stiker ishlab chiqarish',
          description:
            'Stiker dizaynlarini istalgan o‘lchamga toza kattalashadigan aniq vektorlarga aylantiring.',
        },
        uvPrinting: {
          title: 'UV bosma',
          description: 'Xira, pikselli manbalar o‘rniga UV printerlar uchun aniq vektor grafika oling.',
        },
        dtfTextilePrinting: {
          title: 'DTF / tekstil bosma',
          description: 'DTF va tekstilga ko‘chirish jarayonlari uchun dizaynlarni vektorlashtiring.',
        },
        logoCleanup: {
          title: 'Logotipni tozalash',
          description:
            'Past sifatli yoki shikastlangan logotipni aniq, kattalashtiriladigan asosiy faylga aylantiring.',
        },
        qrCodeVectorization: {
          title: 'QR kodni vektorlashtirish',
          description:
            'QR kodlarni istalgan o‘lchamda aniq chop etish uchun toza vektor kvadratlarga aylantiring. Chop etishdan oldin albatta skanerlab tekshiring.',
        },
      },
    },
    pricing: {
      eyebrow: 'Narxlar',
      title: 'Bepul boshlang',
      description: 'Har bir yangi hisobga 10 ta bepul kredit beriladi. Pullik tariflar tez orada.',
      plans: {
        free: {
          name: 'Bepul',
          price: '$0',
          description: 'Vectorla’ning bugungi barcha imkoniyatlarini bepul sinab ko‘ring.',
          features: ['Ro‘yxatdan o‘tganda 10 ta bepul kredit', 'Quick Trace: har bir rasm uchun 1 kredit', 'Professional Trace: har bir rasm uchun 2 kredit', 'SVG yuklab olish', 'Trassirovka muvaffaqiyatsiz bo‘lsa, kreditlar avtomatik qaytariladi'],
          cta: 'Bepul boshlash',
        },
        paid: {
          name: 'Pullik tariflar',
          price: 'Tez orada',
          description:
            'Ko‘proq kreditli tariflar rejalashtirilgan. Narxlar va imkoniyatlar hali belgilanmagan, hozircha hech narsa sotilmaydi.',
          features: [],
          cta: 'Tez orada',
        },
      },
    },
    faq: {
      eyebrow: 'Savollar',
      title: 'Ko‘p beriladigan savollar',
      items: {
        isFree: {
          question: 'Vectorla bepulmi?',
          answer:
            'Yangi hisoblarga 10 ta bepul kredit beriladi. Quick Trace 1 kredit, Professional Trace esa 2 kredit sarflaydi. Trassirovka muvaffaqiyatsiz bo‘lsa, kreditlar avtomatik qaytariladi.',
        },
        uploadedToServer: {
          question: 'Fayllarim serverga yuklanadimi?',
          answer:
            'Ha. Tasvirni trassirovka qilish uchun Vectorla uni serverlarimizga yuklaydi, u yerda qayta ishlaydi va asl fayl hamda olingan SVG’ni hisobingizda saqlaydi. Ularga faqat siz, tizimga kirgan holda kira olasiz. Ikkalasi ham yuklangandan 30 kun o‘tgach avtomatik o‘chiriladi. Batafsil ma’lumot Maxfiylik siyosatida.',
        },
        canExportSvg: {
          question: 'Qaysi formatlarda yuklab olsa bo‘ladi?',
          answer:
            'SVG. U Illustrator, Figma, Inkscape, CorelDRAW va boshqa ko‘plab vektor muharrirlarida ochiladi. PDF, EPS va DXF eksporti hozircha mavjud emas.',
        },
        goodForPrinting: {
          question: 'Bosma uchun yaroqlimi?',
          answer:
            'Vectorla istalgan o‘lchamga kattalashadigan, aniq rangli toza vektor shakllar yaratadi. U ranglarni CMYK’ga o‘tkazmaydi va faylni bosmaxona talablariga tekshirmaydi, shuning uchun chop etishdan oldin faylni dizayn dasturingizda ko‘rib chiqing.',
        },
        cncLaserCutting: {
          question: 'CNC yoki lazer kesish uchun ishlatsa bo‘ladimi?',
          answer:
            'SVG faylni SVG qabul qiladigan kesish yoki CAM dasturiga import qilishingiz mumkin. Vectorla hozircha DXF eksport qilmaydi va maxsus kesish chiziqlarini yaratmaydi.',
        },
        batchProcessing: {
          question: 'Bir vaqtda ko‘p rasm yuklasa bo‘ladimi?',
          answer: 'Hozircha yo‘q. Rasmlar bittadan trassirovka qilinadi.',
        },
        apiAccess: {
          question: 'API bormi?',
          answer: 'Ochiq API hozircha mavjud emas.',
        },
      },
    },
    credits: {
      unit: {
        one: 'kredit',
        few: 'kredit',
        many: 'kredit',
      },
      navLabel: 'Kreditlar',
      pageTitle: 'Kreditlar',
      pageDescription: 'Joriy balansingiz va hisobingizga qo‘shilgan yoki sarflangan har bir kredit.',
      balanceLabel: 'Mavjud balans',
      costsTitle: 'Kreditlar qanday sarflanadi',
      costQuick: 'Quick Trace har bir rasm uchun 1 kredit sarflaydi.',
      costProfessional: 'Professional Trace har bir rasm uchun 2 kredit sarflaydi.',
      costRefund: 'Trassirovka muvaffaqiyatsiz bo‘lsa, kreditlar avtomatik qaytariladi.',
      historyTitle: 'Kreditlar tarixi',
      historyLatest: 'Oxirgi {count} ta yozuv ko‘rsatilmoqda.',
      historyEmpty: 'Hozircha kredit harakatlari yo‘q',
      historyEmptyHint: 'Olingan va sarflangan kreditlar shu yerda ko‘rinadi.',
      loadError: 'Kreditlarni yuklab bo‘lmadi. Internet aloqasini tekshirib, qayta urinib ko‘ring.',
      retry: 'Qayta urinish',
      signInTitle: 'Kreditlarni ko‘rish uchun tizimga kiring',
      signInDescription: 'Tizimga kirganingizdan so‘ng balans va kreditlar tarixi shu yerda ko‘rinadi.',
      signIn: 'Kirish',
      notConfigured: 'Bu ko‘rib chiqish versiyasi Vectorla xizmatiga ulanmagani uchun kreditlar mavjud emas.',
      types: {
        credit: 'Qo‘shildi',
        debit: 'Sarflandi',
        refund: 'Qaytarildi',
      },
      reasons: {
        trace: 'Rasm trassirovka qilindi',
        refund: 'Muvaffaqiyatsiz trassirovka uchun qaytarildi',
        signup: 'Ro‘yxatdan o‘tish uchun bepul kreditlar',
      },
      panelTitle: 'Kreditlaringiz',
      panelSignedOut:
        'O‘z rasmlaringizni trassirovka qilish uchun tizimga kiring. Yangi hisoblarga 10 ta bepul kredit beriladi.',
      viewHistory: 'Kreditlar tarixini ko‘rish',
      backHome: 'Vectorla’ga qaytish',
    },
    legal: {
      privacy: 'Maxfiylik siyosati',
      terms: 'Foydalanish shartlari',
      englishOnly: 'Bu hujjat hozircha faqat ingliz tilida mavjud.',
      backHome: 'Vectorla’ga qaytish',
    },
    footer: {
      tagline: 'Dizaynerlar, bosmaxonalar va ijodkorlar uchun aniq rastrdan vektorga trassirovka.',
      columns: {
        product: {
          title: 'Mahsulot',
          links: ['Imkoniyatlar', 'Foydalanish holatlari', 'Narxlar', 'Savollar'],
        },
        legal: {
          title: 'Huquqiy',
          links: ['Maxfiylik siyosati', 'Foydalanish shartlari'],
        },
      },
      copyright: '© {year} Vectorla. Barcha huquqlar himoyalangan.',
    },
  },
  ru: {
    nav: {
      features: 'Возможности',
      useCases: 'Варианты использования',
      pricing: 'Тарифы',
      faq: 'Вопросы',
      account: 'Кредиты',
      signIn: 'Войти',
      startFree: 'Начать бесплатно',
      openMenu: 'Открыть меню',
      closeMenu: 'Закрыть меню',
    },
    auth: {
      signInTitle: 'Войти в Vectorla',
      signUpTitle: 'Создать аккаунт',
      recoveryTitle: 'Сбросить пароль',
      updatePasswordTitle: 'Выберите новый пароль',
      email: 'Email',
      password: 'Пароль',
      newPassword: 'Новый пароль',
      signIn: 'Войти',
      signUp: 'Создать аккаунт',
      signOut: 'Выйти',
      sendReset: 'Отправить ссылку',
      updatePassword: 'Обновить пароль',
      forgotPassword: 'Забыли пароль?',
      createAccount: 'Создать аккаунт',
      haveAccount: 'Уже есть аккаунт?',
      backToSignIn: 'Вернуться ко входу',
      confirmationSent: 'Проверьте почту, чтобы подтвердить аккаунт.',
      recoverySent: 'Если аккаунт с таким email существует, ссылка для сброса отправлена.',
      passwordUpdated: 'Пароль обновлён.',
      close: 'Закрыть',
      notConfigured: 'Аутентификация не настроена для этого развёртывания.',
      requestFailed: 'Не удалось выполнить запрос. Попробуйте ещё раз.',
    },
    common: {
      switchToLightMode: 'Переключить на светлую тему',
      switchToDarkMode: 'Переключить на тёмную тему',
      compareSliderLabel: 'Ползунок сравнения до и после',
      skipToContent: 'Перейти к содержимому',
      errorTitle: 'Что-то пошло не так',
      errorDescription: 'Не удалось загрузить этот раздел. Попробуйте перезагрузить страницу.',
      reloadPage: 'Перезагрузить страницу',
      loading: 'Загрузка',
    },
    hero: {
      badge: 'Трассировка растра в вектор',
      title: 'Превращайте изображения в чистые редактируемые векторы.',
      description:
        'Vectorla трассирует логотипы, иконки, иллюстрации и сканы в SVG с плавными кривыми, острыми углами и точными цветами — готово к редактированию, масштабированию и печати.',
      primaryCta: 'Попробовать на своём изображении',
      dragDropTitle: 'Трассируйте своё изображение',
      dragDropSubtitle: 'PNG, JPG или WebP · до 5 МБ',
      browseFiles: 'Перейти в рабочую область',
      workflow: {
        upload: 'Загрузка',
        trace: 'Трассировка',
        export: 'Экспорт',
      },
      original: 'Оригинал',
      vectorized: 'Вектор',
      dragHint:
        'Перетащите ползунок для сравнения. Это иллюстрация — попробуйте своё изображение в рабочей области ниже.',
    },
    compatibleWith: {
      title: 'Совместимо с',
    },
    trustBadges: {
      browserBased: 'Работает в браузере',
      svgExport: 'Результат в SVG',
      privateProcessing: 'Файлы доступны только вам',
      fastPreview: 'Обычно за секунды',
    },
    workspace: {
      eyebrow: 'Рабочая область',
      title: 'Попробуйте на своём изображении',
      description:
        'Загрузите PNG, JPG или WebP. Vectorla проанализирует его, выполнит трассировку и выдаст SVG для скачивания.',
      windowUrl: 'vectorla.app',
      uploadImage: 'Загрузить изображение',
      exportAs: 'Результат:',
      dropTitle: 'Перетащите изображение для векторизации',
      dropSubtitle: 'или нажмите, чтобы выбрать — PNG, JPG или WebP, до 5 МБ',
      browseFiles: 'Выбрать файл',
      newImage: 'Загрузить другое изображение',
      previewModeBadge: 'Режим предпросмотра',
      previewModeMessage:
        'Режим предпросмотра: сайт не подключён к сервису трассировки, поэтому изображения не загружаются и не обрабатываются.',
      exportDisabledNote: 'Когда трассировка завершится, SVG можно будет скачать здесь.',
      statusUploading: 'Загрузка…',
      statusQueued: 'В очереди — ожидает начала',
      statusProcessing: 'Векторизация изображения…',
      statusFetchingResult: 'Загрузка результата…',
      statusFailedTitle: 'Не удалось выполнить конвертацию',
      uploadFailedTitle: 'Не удалось загрузить файл',
      authRequiredTitle: 'Требуется вход в систему',
      insufficientCreditsTitle: 'Недостаточно кредитов',
      fetchResultFailedTitle: 'Не удалось загрузить результат',
      retry: 'Повторить',
      download: 'Скачать',
      analysis: {
        title: 'Анализ',
        imageTypeLabel: 'Тип',
        complexityLabel: 'Сложность',
        qualityLabel: 'Качество',
        timeLabel: 'Время',
        providerLabel: 'Движок',
        imageTypes: { photo: 'Фото', illustration: 'Иллюстрация', logo: 'Логотип' },
        qualityLevels: { high: 'Высокое', medium: 'Среднее', low: 'Низкое' },
        providers: { vectorla: 'Vectorla', placeholder: 'ImageTracer', potrace: 'Potrace', vision: 'Внешний движок', openai: 'Внешний движок' },
        badges: {
          bestForLogos: 'Лучше для логотипов',
          bestForPhotos: 'Фото получится стилизованным',
          printReady: 'Хорошо трассируется',
          aiRecommended: 'Рекомендуется Professional Trace',
        },
        recommendedBadge: 'Рекомендуется',
        quickTraceTitle: 'Быстрая трассировка',
        quickTraceDescription: 'Быстро, для большинства изображений',
        professionalTraceTitle: 'Профессиональная трассировка ⭐',
        professionalTraceDescription: 'Больше цветов · плавные градиенты',
        qualityImprovement: {
          high: 'Ожидается небольшое улучшение качества',
          medium: 'Ожидается заметное улучшение качества',
          low: 'Ожидается значительное улучшение качества',
        },
        professionalTraceNote: 'Профессиональная трассировка сохраняет до 64 цветов, точнее разделяет близкие оттенки и превращает плавные цветовые переходы в настоящие SVG-градиенты. Она стоит 2 кредита и занимает немного больше времени.',
      },
    },
    features: {
      eyebrow: 'Возможности',
      title: 'Что умеет движок трассировки',
      description:
        'Vectorla создан для одной задачи: превращать растровые изображения в чистые и точные векторные формы.',
      items: {
        multiColorTrace: {
          title: 'Многоцветная трассировка',
          description:
            'Логотипы и иллюстрации разделяются на реальные цвета и трассируются в отдельные редактируемые формы.',
        },
        smoothCurves: {
          title: 'Плавные кривые, острые углы',
          description:
            'Кривые становятся плавными кривыми Безье, а настоящие углы остаются острыми, а не скруглёнными.',
        },
        gaplessShapes: {
          title: 'Без зазоров между цветами',
          description:
            'Соседние формы имеют общую границу, поэтому между цветами нет тонких щелей и наложений.',
        },
        gradients: {
          title: 'Восстановление градиентов',
          description:
            'Линейные и радиальные градиенты воссоздаются как настоящие SVG-градиенты, а не десятки цветных полос.',
        },
        jpegCleanup: {
          title: 'Очистка JPEG',
          description: 'Артефакты сжатия и цветная кайма по краям отфильтровываются перед трассировкой.',
        },
        professionalTrace: {
          title: 'Professional Trace',
          description:
            'Дополнительный режим для детализированных изображений: до 64 цветов, более точное разделение близких оттенков и плавные цветовые переходы в виде настоящих SVG-градиентов.',
        },
        qrPixelArt: {
          title: 'QR-коды и пиксель-арт',
          description:
            'Квадратные формы, выровненные по сетке, трассируются с прямыми краями и прямыми углами.',
        },
        signatureToSvg: {
          title: 'Подписи и линейные рисунки',
          description:
            'Отсканированные подписи и рисунки тушью становятся плавными одноцветными векторными формами.',
        },
        sketchToVector: {
          title: 'Эскизы и сканы',
          description: 'Рисунки от руки сохраняют характер, а мелкие точки и шум удаляются.',
        },
        editableSvg: {
          title: 'Стандартный редактируемый SVG',
          description:
            'Результат — обычный SVG, который открывается в Illustrator, Figma, Inkscape, CorelDRAW и других векторных редакторах.',
        },
      },
    },
    useCases: {
      eyebrow: 'Варианты использования',
      title: 'Для кого это',
      description: 'Для всех, кому нужна чистая векторная версия растрового изображения.',
      items: {
        designers: {
          title: 'Дизайнеры',
          description:
            'Превращайте растровые референсы, старые логотипы и черновые идеи в редактируемую векторную графику.',
        },
        printShops: {
          title: 'Типографии',
          description:
            'Восстанавливайте логотипы клиентов в чистые векторы, которые чётко печатаются в любом размере.',
        },
        advertisingAgencies: {
          title: 'Рекламные агентства',
          description: 'Быстро конвертируйте логотипы и материалы клиентов без ручной отрисовки.',
        },
        cncLaserCutting: {
          title: 'ЧПУ и лазерная резка',
          description:
            'Трассируйте чертежи и логотипы в SVG-контуры для программ резки или CAM, которые принимают SVG.',
        },
        stickerProduction: {
          title: 'Производство стикеров',
          description: 'Превращайте макеты стикеров в чёткие векторы, которые масштабируются без потерь.',
        },
        uvPrinting: {
          title: 'УФ-печать',
          description:
            'Получайте чёткую векторную графику для УФ-принтеров вместо размытых пиксельных исходников.',
        },
        dtfTextilePrinting: {
          title: 'DTF / печать на текстиле',
          description: 'Векторизуйте макеты для DTF и переноса на текстиль.',
        },
        logoCleanup: {
          title: 'Восстановление логотипов',
          description:
            'Превратите логотип низкого качества или повреждённый логотип в чёткий масштабируемый мастер-файл.',
        },
        qrCodeVectorization: {
          title: 'Векторизация QR-кодов',
          description:
            'Воссоздавайте QR-коды из чистых векторных квадратов для чёткой печати в любом размере. Перед печатью обязательно проверьте сканирование.',
        },
      },
    },
    pricing: {
      eyebrow: 'Тарифы',
      title: 'Начните бесплатно',
      description: 'Каждый новый аккаунт получает 10 бесплатных кредитов. Платные тарифы скоро появятся.',
      plans: {
        free: {
          name: 'Бесплатно',
          price: '$0',
          description: 'Всё, что Vectorla умеет сегодня, — бесплатно для пробы.',
          features: ['10 бесплатных кредитов при регистрации', 'Quick Trace: 1 кредит за изображение', 'Professional Trace: 2 кредита за изображение', 'Скачивание в SVG', 'Кредиты возвращаются автоматически, если трассировка не удалась'],
          cta: 'Начать бесплатно',
        },
        paid: {
          name: 'Платные тарифы',
          price: 'Скоро',
          description:
            'Планируются тарифы с большим количеством кредитов. Цены и возможности ещё не определены, сейчас ничего не продаётся.',
          features: [],
          cta: 'Скоро',
        },
      },
    },
    faq: {
      eyebrow: 'Вопросы',
      title: 'Частые вопросы',
      items: {
        isFree: {
          question: 'Vectorla бесплатный?',
          answer:
            'Новые аккаунты получают 10 бесплатных кредитов. Quick Trace расходует 1 кредит, Professional Trace — 2. Если трассировка не удалась, кредиты возвращаются автоматически.',
        },
        uploadedToServer: {
          question: 'Загружаются ли мои файлы на сервер?',
          answer:
            'Да. Чтобы выполнить трассировку, Vectorla загружает изображение на наши серверы, обрабатывает его там и хранит оригинал и полученный SVG в вашем аккаунте. Доступ к ним есть только у вас после входа. Оба файла автоматически удаляются через 30 дней после загрузки. Подробнее — в Политике конфиденциальности.',
        },
        canExportSvg: {
          question: 'В каких форматах можно скачать результат?',
          answer:
            'В SVG. Он открывается в Illustrator, Figma, Inkscape, CorelDRAW и большинстве других векторных редакторов. Экспорт в PDF, EPS и DXF пока недоступен.',
        },
        goodForPrinting: {
          question: 'Подходит ли это для печати?',
          answer:
            'Vectorla создаёт чистые векторные формы с точными цветами, которые масштабируются до любого размера. Сервис не переводит цвета в CMYK и не проверяет файл на требования типографии, поэтому перед печатью проверьте файл в своём графическом редакторе.',
        },
        cncLaserCutting: {
          question: 'Можно ли использовать для ЧПУ или лазерной резки?',
          answer:
            'SVG можно импортировать в программы резки или CAM, которые принимают SVG. Vectorla пока не экспортирует DXF и не создаёт отдельные линии реза.',
        },
        batchProcessing: {
          question: 'Можно ли загрузить много изображений сразу?',
          answer: 'Пока нет. Изображения трассируются по одному.',
        },
        apiAccess: {
          question: 'Есть ли API?',
          answer: 'Публичный API пока недоступен.',
        },
      },
    },
    credits: {
      unit: {
        one: 'кредит',
        few: 'кредита',
        many: 'кредитов',
      },
      navLabel: 'Кредиты',
      pageTitle: 'Кредиты',
      pageDescription: 'Ваш текущий баланс и все начисления и списания кредитов.',
      balanceLabel: 'Доступный баланс',
      costsTitle: 'Как расходуются кредиты',
      costQuick: 'Quick Trace расходует 1 кредит за изображение.',
      costProfessional: 'Professional Trace расходует 2 кредита за изображение.',
      costRefund: 'Если трассировка не удалась, кредиты возвращаются автоматически.',
      historyTitle: 'История кредитов',
      historyLatest: 'Показаны последние записи: {count}.',
      historyEmpty: 'Операций с кредитами пока нет',
      historyEmptyHint: 'Здесь появятся полученные и потраченные кредиты.',
      loadError: 'Не удалось загрузить кредиты. Проверьте подключение и попробуйте снова.',
      retry: 'Повторить',
      signInTitle: 'Войдите, чтобы увидеть кредиты',
      signInDescription: 'После входа здесь появятся баланс и история кредитов.',
      signIn: 'Войти',
      notConfigured: 'Кредиты недоступны в этой демо-версии, так как она не подключена к сервису Vectorla.',
      types: {
        credit: 'Начислено',
        debit: 'Списано',
        refund: 'Возвращено',
      },
      reasons: {
        trace: 'Трассировка изображения',
        refund: 'Возврат за неудачную трассировку',
        signup: 'Бесплатные кредиты за регистрацию',
      },
      panelTitle: 'Ваши кредиты',
      panelSignedOut:
        'Войдите, чтобы трассировать свои изображения. Новые аккаунты получают 10 бесплатных кредитов.',
      viewHistory: 'История кредитов',
      backHome: 'Вернуться в Vectorla',
    },
    legal: {
      privacy: 'Политика конфиденциальности',
      terms: 'Условия использования',
      englishOnly: 'Этот документ пока доступен только на английском языке.',
      backHome: 'Вернуться в Vectorla',
    },
    footer: {
      tagline: 'Точная трассировка растра в вектор для дизайнеров, типографий и мастеров.',
      columns: {
        product: {
          title: 'Продукт',
          links: ['Возможности', 'Варианты использования', 'Тарифы', 'Вопросы'],
        },
        legal: {
          title: 'Правовая информация',
          links: ['Политика конфиденциальности', 'Условия использования'],
        },
      },
      copyright: '© {year} Vectorla. Все права защищены.',
    },
  },
}

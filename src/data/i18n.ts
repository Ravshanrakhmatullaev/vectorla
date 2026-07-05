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

export type NavId = 'features' | 'useCases' | 'pricing' | 'api' | 'docs'

export type TrustBadgeId =
  | 'browserBased'
  | 'printReady'
  | 'svgExport'
  | 'privateProcessing'
  | 'fastPreview'

export type WorkspacePresetId = 'logo' | 'signature' | 'sketch' | 'icon' | 'qrCode' | 'blueprint'

export type WorkspaceSettingId = 'colors' | 'detail' | 'smoothness' | 'noiseRemoval' | 'curvePrecision'

export type FeatureId =
  | 'aiLogoTrace'
  | 'aiQrVectorizer'
  | 'signatureToSvg'
  | 'sketchToVector'
  | 'printReadySvg'
  | 'cncLaserDxfExport'
  | 'batchVectorization'
  | 'svgOptimizer'
  | 'colorReduction'
  | 'backgroundCleanup'

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

export type PricingPlanId = 'free' | 'pro' | 'business'

export type FaqId =
  | 'isFree'
  | 'uploadedToServer'
  | 'canExportSvg'
  | 'goodForPrinting'
  | 'cncLaserCutting'
  | 'batchProcessing'
  | 'apiAccess'

export type FooterColumnId = 'product' | 'resources' | 'company' | 'legal'

interface TextItem {
  title: string
  description: string
}

interface PricingPlanText {
  name: string
  price: string
  period?: string
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
    api: string
    docs: string
    signIn: string
    startFree: string
    openMenu: string
    closeMenu: string
  }
  common: {
    switchToLightMode: string
    switchToDarkMode: string
  }
  hero: {
    badge: string
    title: string
    description: string
    startVectorizing: string
    viewDemo: string
    original: string
    vectorized: string
    dragHint: string
    uploadImage: string
  }
  trustBadges: Record<TrustBadgeId, string>
  workspace: {
    eyebrow: string
    title: string
    description: string
    windowUrl: string
    uploadImage: string
    presetsLabel: string
    recentFilesLabel: string
    settingsLabel: string
    presets: Record<WorkspacePresetId, string>
    settings: Record<WorkspaceSettingId, string>
    presetPrefix: string
    livePreview: string
    printReadyMode: string
    printReadyDetails: string
    exportAs: string
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
    mostPopular: string
    plans: Record<PricingPlanId, PricingPlanText>
  }
  faq: {
    eyebrow: string
    title: string
    items: Record<FaqId, FaqItemText>
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
      api: 'API',
      docs: 'Docs',
      signIn: 'Sign in',
      startFree: 'Start free',
      openMenu: 'Open menu',
      closeMenu: 'Close menu',
    },
    common: {
      switchToLightMode: 'Switch to light mode',
      switchToDarkMode: 'Switch to dark mode',
    },
    hero: {
      badge: 'AI Print-Ready Vector Platform',
      title: 'Transform any image into perfect vectors.',
      description:
        'AI-powered vectorization built for designers, print shops, CNC, laser cutting, stickers, logos and production-ready graphics.',
      startVectorizing: 'Start Vectorizing',
      viewDemo: 'View Demo',
      original: 'Original',
      vectorized: 'Vectorized',
      dragHint: 'Drag the handle to compare — upload your own image to try it live.',
      uploadImage: 'Upload an image',
    },
    trustBadges: {
      browserBased: 'Browser-based',
      printReady: 'Print-ready',
      svgExport: 'SVG export',
      privateProcessing: 'Private processing',
      fastPreview: 'Fast preview',
    },
    workspace: {
      eyebrow: 'Workspace',
      title: 'A workspace built for production, not toy demos',
      description:
        'Every control a print professional expects — presets, precision settings, and print-ready validation in one place.',
      windowUrl: 'app.vectorla.app/workspace',
      uploadImage: 'Upload image',
      presetsLabel: 'Presets',
      recentFilesLabel: 'Recent files',
      settingsLabel: 'Vector settings',
      presets: {
        logo: 'Logo',
        signature: 'Signature',
        sketch: 'Sketch',
        icon: 'Icon',
        qrCode: 'QR Code',
        blueprint: 'Blueprint',
      },
      settings: {
        colors: 'Colors',
        detail: 'Detail',
        smoothness: 'Smoothness',
        noiseRemoval: 'Noise removal',
        curvePrecision: 'Curve precision',
      },
      presetPrefix: 'Preset: ',
      livePreview: 'Live preview',
      printReadyMode: 'Print-ready mode',
      printReadyDetails:
        'DPI check passed · CMYK-ready · clean paths · reduced nodes · transparent background · cut lines included.',
      exportAs: 'Export as:',
    },
    features: {
      eyebrow: 'Features',
      title: 'Everything a production pipeline needs',
      description:
        'Not just tracing — a full toolkit for turning raster images into usable, print-ready vectors.',
      items: {
        aiLogoTrace: {
          title: 'AI Logo Trace',
          description:
            'Clean, print-ready logo vectorization tuned for flat colors and sharp edges.',
        },
        aiQrVectorizer: {
          title: 'AI QR Vectorizer',
          description:
            'Perfectly scannable QR codes converted to crisp, infinitely scalable vectors.',
        },
        signatureToSvg: {
          title: 'Signature to SVG',
          description: 'Turn a scanned signature into a smooth, single-color vector stroke.',
        },
        sketchToVector: {
          title: 'Sketch to Vector',
          description:
            'Preserve the hand-drawn character of sketches while cleaning up stray noise.',
        },
        printReadySvg: {
          title: 'Print-Ready SVG',
          description: 'Output validated for CMYK workflows, clean paths, and production print.',
        },
        cncLaserDxfExport: {
          title: 'CNC / Laser DXF Export',
          description: 'Export cut-ready DXF files for laser cutters and CNC machines.',
        },
        batchVectorization: {
          title: 'Batch Vectorization',
          description:
            'Process entire folders of images in one queue, download results as a single archive.',
        },
        svgOptimizer: {
          title: 'SVG Optimizer',
          description:
            'Merge redundant paths and reduce node count without losing visual fidelity.',
        },
        colorReduction: {
          title: 'Color Reduction',
          description:
            'Control exact color counts for cleaner separations and simpler print jobs.',
        },
        backgroundCleanup: {
          title: 'Background Cleanup',
          description: 'Automatically detect and remove background noise before tracing.',
        },
      },
    },
    useCases: {
      eyebrow: 'Use Cases',
      title: 'Built for people who ship physical output',
      description:
        'From screen to production — Vectorla is designed around real workflows, not just pretty demos.',
      items: {
        designers: {
          title: 'Designers',
          description:
            'Turn raster references and rough concepts into editable, layered vector artwork.',
        },
        printShops: {
          title: 'Print Shops',
          description:
            'Prepare production-ready files with clean paths and predictable output every time.',
        },
        advertisingAgencies: {
          title: 'Advertising Agencies',
          description: 'Convert client logos and assets quickly without waiting on a designer.',
        },
        cncLaserCutting: {
          title: 'CNC & Laser Cutting',
          description: 'Export precise DXF cut lines straight from a photo or scanned drawing.',
        },
        stickerProduction: {
          title: 'Sticker Production',
          description:
            'Generate clean cut-contours ready for die-cut or kiss-cut sticker printing.',
        },
        uvPrinting: {
          title: 'UV Printing',
          description: 'Get crisp vector layers suited for UV printers and textured substrates.',
        },
        dtfTextilePrinting: {
          title: 'DTF / Textile Printing',
          description: 'Vectorize artwork for direct-to-film and textile transfer workflows.',
        },
        logoCleanup: {
          title: 'Logo Cleanup',
          description:
            'Rebuild a low-resolution or damaged logo into a crisp, scalable master file.',
        },
        qrCodeVectorization: {
          title: 'QR Code Vectorization',
          description: 'Guarantee scannability at any print size with true vector QR codes.',
        },
      },
    },
    pricing: {
      eyebrow: 'Pricing',
      title: 'Simple pricing that scales with you',
      description: 'Start free. Upgrade when you need batch processing and production-grade export.',
      mostPopular: 'Most popular',
      plans: {
        free: {
          name: 'Free',
          price: '$0',
          description: 'Try Vectorla on real projects before you commit.',
          features: ['5 conversions / month', 'SVG export', 'Basic presets'],
          cta: 'Start free',
        },
        pro: {
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
        },
        business: {
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
      },
    },
    faq: {
      eyebrow: 'FAQ',
      title: 'Frequently asked questions',
      items: {
        isFree: {
          question: 'Is Vectorla free?',
          answer:
            'Yes. The Free plan includes 5 conversions a month with SVG export and basic presets, no credit card required. Pro and Business plans unlock unlimited conversions and production features.',
        },
        uploadedToServer: {
          question: 'Are files uploaded to a server?',
          answer:
            'Core tracing runs in your browser. Some advanced AI features in future releases will use secure, encrypted processing — and we will always be explicit about what leaves your device.',
        },
        canExportSvg: {
          question: 'Can I export SVG?',
          answer:
            'Yes, SVG export is available on every plan. Pro and Business plans add PDF, DXF, and EPS export for production workflows.',
        },
        goodForPrinting: {
          question: 'Is it good for printing?',
          answer:
            'Vectorla’s Print-Ready Mode checks resolution, flattens colors sensibly, and produces clean, reduced-node paths suited for CMYK print production — not just decorative web SVGs.',
        },
        cncLaserCutting: {
          question: 'Can I use it for CNC or laser cutting?',
          answer:
            'Yes. Vectorla can export DXF cut lines generated directly from your traced image, ready to bring into CAM or cutting software.',
        },
        batchProcessing: {
          question: 'Does it support batch processing?',
          answer:
            'Pro and Business plans include batch processing — upload a folder of images and export every result as a single archive.',
        },
        apiAccess: {
          question: 'Will there be API access?',
          answer:
            'API access is planned for the Business plan, so you can integrate Vectorla directly into your own production pipeline.',
        },
      },
    },
    footer: {
      tagline: 'The AI print-ready vector platform for designers, print shops, and production teams.',
      columns: {
        product: {
          title: 'Product',
          links: ['Features', 'Use Cases', 'Pricing', 'Changelog'],
        },
        resources: {
          title: 'Resources',
          links: ['Docs', 'API Reference', 'Guides', 'Support'],
        },
        company: {
          title: 'Company',
          links: ['About', 'Blog', 'Careers', 'Contact'],
        },
        legal: {
          title: 'Legal',
          links: ['Privacy Policy', 'Terms of Service', 'Security'],
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
      api: 'API',
      docs: 'Hujjatlar',
      signIn: 'Kirish',
      startFree: 'Bepul boshlash',
      openMenu: 'Menyuni ochish',
      closeMenu: 'Menyuni yopish',
    },
    common: {
      switchToLightMode: "Yorug' rejimga o'tish",
      switchToDarkMode: "Qorong'i rejimga o'tish",
    },
    hero: {
      badge: 'AI asosidagi bosmaga tayyor vektor platforma',
      title: "Har qanday tasvirni mukammal vektorga aylantiring.",
      description:
        "Dizaynerlar, bosmaxonalar, CNC, lazer kesish, stikerlar, logotiplar va ishlab chiqarishga tayyor grafikalar uchun AI asosidagi vektorlashtirish.",
      startVectorizing: 'Vektorlashtirishni boshlash',
      viewDemo: "Demo ko'rish",
      original: 'Original',
      vectorized: 'Vektorlashtirilgan',
      dragHint: "Solishtirish uchun dastakni suring — jonli sinab ko'rish uchun o'z tasviringizni yuklang.",
      uploadImage: 'Rasm yuklash',
    },
    trustBadges: {
      browserBased: 'Brauzer orqali',
      printReady: 'Bosmaga tayyor',
      svgExport: 'SVG eksport',
      privateProcessing: 'Maxfiy qayta ishlash',
      fastPreview: "Tezkor ko'rib chiqish",
    },
    workspace: {
      eyebrow: 'Ish maydoni',
      title: "O'yinchoq demolar uchun emas, ishlab chiqarish uchun yaratilgan ish maydoni",
      description:
        "Bosma sohasi mutaxassisi kutadigan barcha boshqaruvlar — presetlar, aniq sozlamalar va bosmaga tayyorlikni tekshirish bir joyda.",
      windowUrl: 'app.vectorla.app/workspace',
      uploadImage: 'Rasm yuklash',
      presetsLabel: 'Presetlar',
      recentFilesLabel: "So'nggi fayllar",
      settingsLabel: 'Vektor sozlamalari',
      presets: {
        logo: 'Logotip',
        signature: 'Imzo',
        sketch: 'Eskiz',
        icon: 'Ikonka',
        qrCode: 'QR kod',
        blueprint: 'Chizma',
      },
      settings: {
        colors: 'Ranglar',
        detail: 'Detal',
        smoothness: 'Silliqlik',
        noiseRemoval: 'Shovqinni olib tashlash',
        curvePrecision: "Egri chiziq aniqligi",
      },
      presetPrefix: 'Preset: ',
      livePreview: "Jonli ko'rish",
      printReadyMode: 'Bosmaga tayyor rejim',
      printReadyDetails:
        "DPI tekshiruvi o'tdi · CMYK uchun tayyor · toza yo'llar · kamaytirilgan tugunlar · shaffof fon · kesish chiziqlari mavjud.",
      exportAs: 'Quyidagi formatda eksport:',
    },
    features: {
      eyebrow: 'Imkoniyatlar',
      title: "Ishlab chiqarish jarayoni uchun kerak bo'lgan hamma narsa",
      description:
        "Shunchaki chizib chiqish emas — rastr tasvirlarni foydali, bosmaga tayyor vektorlarga aylantirish uchun to'liq vositalar to'plami.",
      items: {
        aiLogoTrace: {
          title: 'AI logotip chizish',
          description:
            "Tekis ranglar va aniq chegaralar uchun moslashtirilgan toza, bosmaga tayyor logotip vektorlashtirish.",
        },
        aiQrVectorizer: {
          title: 'AI QR vektorlashtiruvchi',
          description:
            "Mukammal skanerlanadigan QR kodlar aniq, cheksiz masshtablanadigan vektorlarga aylantiriladi.",
        },
        signatureToSvg: {
          title: 'Imzodan SVG ga',
          description: "Skanerlangan imzoni silliq, bir rangli vektor chizig'iga aylantiring.",
        },
        sketchToVector: {
          title: 'Eskizdan vektorga',
          description:
            "Ortiqcha shovqinni tozalab, eskizning qo'lda chizilgan xarakterini saqlab qoladi.",
        },
        printReadySvg: {
          title: 'Bosmaga tayyor SVG',
          description:
            "CMYK jarayonlari, toza yo'llar va ishlab chiqarish bosmasi uchun tekshirilgan natija.",
        },
        cncLaserDxfExport: {
          title: 'CNC / Lazer uchun DXF eksport',
          description:
            "Lazer kesish va CNC mashinalari uchun kesishga tayyor DXF fayllarni eksport qiling.",
        },
        batchVectorization: {
          title: 'Ommaviy vektorlashtirish',
          description:
            "Butun rasm papkalarini bitta navbatda qayta ishlang, natijalarni yagona arxiv sifatida yuklab oling.",
        },
        svgOptimizer: {
          title: 'SVG optimallashtiruvchi',
          description:
            "Vizual sifatni yo'qotmasdan ortiqcha yo'llarni birlashtiring va tugunlar sonini kamaytiring.",
        },
        colorReduction: {
          title: 'Ranglarni kamaytirish',
          description:
            "Tozaroq ajratish va soddaroq bosma ishlari uchun aniq rang sonini boshqaring.",
        },
        backgroundCleanup: {
          title: 'Fonni tozalash',
          description: "Chizishdan oldin fon shovqinini avtomatik aniqlang va olib tashlang.",
        },
      },
    },
    useCases: {
      eyebrow: 'Foydalanish holatlari',
      title: "Jismoniy mahsulot ishlab chiqaradigan odamlar uchun yaratilgan",
      description:
        "Ekrandan ishlab chiqarishgacha — Vectorla shunchaki chiroyli demolar uchun emas, balki haqiqiy ish jarayonlari uchun yaratilgan.",
      items: {
        designers: {
          title: 'Dizaynerlar',
          description:
            "Rastr namunalari va dastlabki g'oyalarni tahrirlanadigan, qatlamli vektor asarlarga aylantiring.",
        },
        printShops: {
          title: 'Bosmaxonalar',
          description:
            "Har safar toza yo'llar va bashorat qilinadigan natija bilan ishlab chiqarishga tayyor fayllarni tayyorlang.",
        },
        advertisingAgencies: {
          title: 'Reklama agentliklari',
          description:
            "Dizaynerni kutmasdan mijoz logotiplari va materiallarini tezda o'giring.",
        },
        cncLaserCutting: {
          title: 'CNC va lazer kesish',
          description:
            "Foto yoki skanerlangan chizmadan to'g'ridan-to'g'ri aniq DXF kesish chiziqlarini eksport qiling.",
        },
        stickerProduction: {
          title: 'Stiker ishlab chiqarish',
          description:
            "Die-cut yoki kiss-cut stiker bosmasi uchun tayyor toza kesish konturlarini yarating.",
        },
        uvPrinting: {
          title: 'UV bosma',
          description:
            "UV printerlar va relyefli materiallar uchun mos aniq vektor qatlamlarini oling.",
        },
        dtfTextilePrinting: {
          title: 'DTF / Tekstil bosma',
          description:
            "To'g'ridan-to'g'ri plyonkaga va tekstil transfer jarayonlari uchun asarlarni vektorlashtiring.",
        },
        logoCleanup: {
          title: 'Logotipni tozalash',
          description:
            "Past sifatli yoki shikastlangan logotipni aniq, masshtablanadigan asosiy faylga qayta tiklang.",
        },
        qrCodeVectorization: {
          title: 'QR kodni vektorlashtirish',
          description:
            "Haqiqiy vektor QR kodlar bilan istalgan bosma o'lchamda skanerlanishini kafolatlang.",
        },
      },
    },
    pricing: {
      eyebrow: 'Narxlar',
      title: "Siz bilan birga o'sadigan sodda narxlar",
      description:
        "Bepul boshlang. Ommaviy qayta ishlash va ishlab chiqarish darajasidagi eksport kerak bo'lganda tarifni oshiring.",
      mostPopular: 'Eng ommabop',
      plans: {
        free: {
          name: 'Bepul',
          price: '$0',
          description: "Qaror qabul qilishdan oldin Vectorla'ni haqiqiy loyihalarda sinab ko'ring.",
          features: ['Oyiga 5 ta konvertatsiya', 'SVG eksport', 'Oddiy presetlar'],
          cta: 'Bepul boshlash',
        },
        pro: {
          name: 'Pro',
          price: '$19',
          period: '/oy',
          description: 'Har kuni konvertatsiya qiladigan dizayner va do’konlar uchun.',
          features: [
            'Cheksiz konvertatsiyalar',
            'Ommaviy qayta ishlash',
            'SVG / PDF / DXF / EPS eksport',
            'Bosmaga tayyor rejim',
            'Ustuvor qayta ishlash',
          ],
          cta: 'Pro sinovini boshlash',
        },
        business: {
          name: 'Biznes',
          price: 'Individual',
          description:
            "Umumiy ish maydoni va API talab qiladigan jamoalar va agentliklar uchun.",
          features: [
            'Jamoaviy ish maydoni',
            'API kirish huquqi',
            'Brend presetlari',
            'Kengaytirilgan eksport',
            "Maxsus qo'llab-quvvatlash",
          ],
          cta: "Sotuvlar bilan bog'lanish",
        },
      },
    },
    faq: {
      eyebrow: 'Savol-javob',
      title: "Tez-tez so'raladigan savollar",
      items: {
        isFree: {
          question: 'Vectorla bepulmi?',
          answer:
            "Ha. Bepul tarif oyiga 5 ta konvertatsiya, SVG eksport va oddiy presetlarni o'z ichiga oladi, kredit karta talab qilinmaydi. Pro va Biznes tariflari cheksiz konvertatsiya va ishlab chiqarish imkoniyatlarini ochadi.",
        },
        uploadedToServer: {
          question: 'Fayllar serverga yuklanadimi?',
          answer:
            "Asosiy chizish brauzeringizda amalga oshiriladi. Kelajakdagi versiyalardagi ba'zi ilg'or AI funksiyalari xavfsiz, shifrlangan qayta ishlashdan foydalanadi — va biz qurilmangizdan nima chiqishi haqida har doim aniq ma'lumot beramiz.",
        },
        canExportSvg: {
          question: 'SVG eksport qila olamanmi?',
          answer:
            "Ha, SVG eksport barcha tariflarda mavjud. Pro va Biznes tariflari ishlab chiqarish jarayonlari uchun PDF, DXF va EPS eksportni qo'shadi.",
        },
        goodForPrinting: {
          question: 'Bosma uchun yaxshimi?',
          answer:
            "Vectorla'ning bosmaga tayyor rejimi aniqlikni tekshiradi, ranglarni oqilona tekislaydi va CMYK bosma ishlab chiqarishga mos, toza, kamaytirilgan tugunli yo'llarni yaratadi — shunchaki bezak uchun veb-SVG emas.",
        },
        cncLaserCutting: {
          question: 'Uni CNC yoki lazer kesish uchun ishlata olamanmi?',
          answer:
            "Ha. Vectorla chizilgan tasviringizdan to'g'ridan-to'g'ri yaratilgan DXF kesish chiziqlarini eksport qila oladi, ular CAM yoki kesish dasturiga kiritishga tayyor.",
        },
        batchProcessing: {
          question: 'Ommaviy qayta ishlashni qo’llab-quvvatlaydimi?',
          answer:
            "Pro va Biznes tariflari ommaviy qayta ishlashni o'z ichiga oladi — rasmlar papkasini yuklang va har bir natijani yagona arxiv sifatida eksport qiling.",
        },
        apiAccess: {
          question: 'API kirish huquqi bo’ladimi?',
          answer:
            "API kirish huquqi Biznes tarifi uchun rejalashtirilgan, shunda Vectorla'ni o'z ishlab chiqarish jarayoningizga to'g'ridan-to'g'ri integratsiya qila olasiz.",
        },
      },
    },
    footer: {
      tagline:
        "Dizaynerlar, bosmaxonalar va ishlab chiqarish jamoalari uchun AI asosidagi bosmaga tayyor vektor platforma.",
      columns: {
        product: {
          title: 'Mahsulot',
          links: ['Imkoniyatlar', 'Foydalanish holatlari', 'Narxlar', "O'zgarishlar tarixi"],
        },
        resources: {
          title: 'Resurslar',
          links: ['Hujjatlar', "API ma'lumotnomasi", "Qo'llanmalar", "Qo'llab-quvvatlash"],
        },
        company: {
          title: 'Kompaniya',
          links: ['Biz haqimizda', 'Blog', 'Karyera', 'Aloqa'],
        },
        legal: {
          title: 'Huquqiy',
          links: ['Maxfiylik siyosati', 'Foydalanish shartlari', 'Xavfsizlik'],
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
      api: 'API',
      docs: 'Документация',
      signIn: 'Войти',
      startFree: 'Начать бесплатно',
      openMenu: 'Открыть меню',
      closeMenu: 'Закрыть меню',
    },
    common: {
      switchToLightMode: 'Переключить на светлую тему',
      switchToDarkMode: 'Переключить на тёмную тему',
    },
    hero: {
      badge: 'Платформа для векторизации на основе ИИ',
      title: 'Превратите любое изображение в идеальный вектор.',
      description:
        'Векторизация на основе ИИ для дизайнеров, типографий, ЧПУ, лазерной резки, стикеров, логотипов и графики, готовой к печати.',
      startVectorizing: 'Начать векторизацию',
      viewDemo: 'Посмотреть демо',
      original: 'Оригинал',
      vectorized: 'Вектор',
      dragHint:
        'Перетащите ползунок для сравнения — загрузите своё изображение, чтобы попробовать вживую.',
      uploadImage: 'Загрузить изображение',
    },
    trustBadges: {
      browserBased: 'Работает в браузере',
      printReady: 'Готово к печати',
      svgExport: 'Экспорт в SVG',
      privateProcessing: 'Приватная обработка',
      fastPreview: 'Быстрый предпросмотр',
    },
    workspace: {
      eyebrow: 'Рабочая область',
      title: 'Рабочая область для реального производства, а не для демо-игрушек',
      description:
        'Все инструменты, которые нужны специалисту печати — пресеты, точные настройки и проверка готовности к печати в одном месте.',
      windowUrl: 'app.vectorla.app/workspace',
      uploadImage: 'Загрузить изображение',
      presetsLabel: 'Пресеты',
      recentFilesLabel: 'Недавние файлы',
      settingsLabel: 'Настройки вектора',
      presets: {
        logo: 'Логотип',
        signature: 'Подпись',
        sketch: 'Эскиз',
        icon: 'Иконка',
        qrCode: 'QR-код',
        blueprint: 'Чертёж',
      },
      settings: {
        colors: 'Цвета',
        detail: 'Детализация',
        smoothness: 'Сглаживание',
        noiseRemoval: 'Удаление шума',
        curvePrecision: 'Точность кривых',
      },
      presetPrefix: 'Пресет: ',
      livePreview: 'Живой просмотр',
      printReadyMode: 'Режим готовности к печати',
      printReadyDetails:
        'Проверка DPI пройдена · готово к CMYK · чистые контуры · уменьшено число узлов · прозрачный фон · включены линии реза.',
      exportAs: 'Экспорт в формате:',
    },
    features: {
      eyebrow: 'Возможности',
      title: 'Всё необходимое для производственного процесса',
      description:
        'Не просто трассировка — полный набор инструментов для превращения растровых изображений в готовые к печати векторы.',
      items: {
        aiLogoTrace: {
          title: 'Трассировка логотипа с ИИ',
          description:
            'Чистая, готовая к печати векторизация логотипа для плоских цветов и чётких краёв.',
        },
        aiQrVectorizer: {
          title: 'Векторизация QR-кодов с ИИ',
          description:
            'Идеально сканируемые QR-коды превращаются в чёткие, бесконечно масштабируемые векторы.',
        },
        signatureToSvg: {
          title: 'Подпись в SVG',
          description: 'Превратите отсканированную подпись в плавный одноцветный векторный штрих.',
        },
        sketchToVector: {
          title: 'Эскиз в вектор',
          description: 'Сохраняет рукописный характер эскиза, убирая лишний шум.',
        },
        printReadySvg: {
          title: 'SVG, готовый к печати',
          description:
            'Результат проверен для CMYK-процессов, чистых контуров и производственной печати.',
        },
        cncLaserDxfExport: {
          title: 'Экспорт DXF для ЧПУ / лазера',
          description: 'Экспортируйте готовые к резке DXF-файлы для лазерных и ЧПУ-станков.',
        },
        batchVectorization: {
          title: 'Пакетная векторизация',
          description:
            'Обрабатывайте целые папки изображений в одной очереди, скачивайте результат единым архивом.',
        },
        svgOptimizer: {
          title: 'Оптимизатор SVG',
          description:
            'Объединяет лишние контуры и уменьшает число узлов без потери качества изображения.',
        },
        colorReduction: {
          title: 'Уменьшение цветов',
          description:
            'Контролируйте точное количество цветов для более чистого разделения и упрощения печати.',
        },
        backgroundCleanup: {
          title: 'Очистка фона',
          description: 'Автоматически определяет и удаляет шум фона перед трассировкой.',
        },
      },
    },
    useCases: {
      eyebrow: 'Варианты использования',
      title: 'Создано для тех, кто производит физический продукт',
      description:
        'От экрана до производства — Vectorla создана для реальных рабочих процессов, а не просто для красивых демо.',
      items: {
        designers: {
          title: 'Дизайнеры',
          description:
            'Превращайте растровые референсы и черновые идеи в редактируемую, слоистую векторную графику.',
        },
        printShops: {
          title: 'Типографии',
          description:
            'Готовьте файлы для производства с чистыми контурами и предсказуемым результатом каждый раз.',
        },
        advertisingAgencies: {
          title: 'Рекламные агентства',
          description: 'Быстро конвертируйте логотипы и материалы клиентов, не дожидаясь дизайнера.',
        },
        cncLaserCutting: {
          title: 'ЧПУ и лазерная резка',
          description: 'Экспортируйте точные линии реза DXF прямо из фото или отсканированного рисунка.',
        },
        stickerProduction: {
          title: 'Производство стикеров',
          description:
            'Создавайте чистые контуры реза, готовые для вырубки или контурной резки стикеров.',
        },
        uvPrinting: {
          title: 'УФ-печать',
          description: 'Получайте чёткие векторные слои, подходящие для УФ-принтеров и текстурных материалов.',
        },
        dtfTextilePrinting: {
          title: 'DTF / текстильная печать',
          description: 'Векторизуйте изображения для прямой печати на плёнку и текстильного переноса.',
        },
        logoCleanup: {
          title: 'Восстановление логотипа',
          description:
            'Восстановите логотип низкого качества или повреждённый логотип в чёткий масштабируемый мастер-файл.',
        },
        qrCodeVectorization: {
          title: 'Векторизация QR-кодов',
          description: 'Гарантируйте сканируемость при любом размере печати с настоящими векторными QR-кодами.',
        },
      },
    },
    pricing: {
      eyebrow: 'Тарифы',
      title: 'Простые тарифы, которые растут вместе с вами',
      description:
        'Начните бесплатно. Перейдите на платный тариф, когда понадобится пакетная обработка и экспорт производственного уровня.',
      mostPopular: 'Самый популярный',
      plans: {
        free: {
          name: 'Бесплатный',
          price: '$0',
          description: 'Попробуйте Vectorla на реальных проектах перед тем, как принять решение.',
          features: ['5 конвертаций в месяц', 'Экспорт в SVG', 'Базовые пресеты'],
          cta: 'Начать бесплатно',
        },
        pro: {
          name: 'Pro',
          price: '$19',
          period: '/мес',
          description: 'Для дизайнеров и студий, которые конвертируют изображения каждый день.',
          features: [
            'Неограниченные конвертации',
            'Пакетная обработка',
            'Экспорт SVG / PDF / DXF / EPS',
            'Режим готовности к печати',
            'Приоритетная обработка',
          ],
          cta: 'Начать пробный период Pro',
        },
        business: {
          name: 'Business',
          price: 'Индивидуально',
          description: 'Для команд и агентств с общими рабочими пространствами и потребностью в API.',
          features: [
            'Командное рабочее пространство',
            'Доступ к API',
            'Брендовые пресеты',
            'Расширенный экспорт',
            'Выделенная поддержка',
          ],
          cta: 'Связаться с отделом продаж',
        },
      },
    },
    faq: {
      eyebrow: 'Вопросы и ответы',
      title: 'Часто задаваемые вопросы',
      items: {
        isFree: {
          question: 'Vectorla бесплатна?',
          answer:
            'Да. Бесплатный тариф включает 5 конвертаций в месяц с экспортом в SVG и базовыми пресетами, банковская карта не требуется. Тарифы Pro и Business открывают неограниченные конвертации и производственные функции.',
        },
        uploadedToServer: {
          question: 'Файлы загружаются на сервер?',
          answer:
            'Основная трассировка выполняется в вашем браузере. Некоторые продвинутые ИИ-функции в будущих версиях будут использовать защищённую, зашифрованную обработку — и мы всегда будем чётко сообщать, что покидает ваше устройство.',
        },
        canExportSvg: {
          question: 'Могу ли я экспортировать в SVG?',
          answer:
            'Да, экспорт в SVG доступен на любом тарифе. Тарифы Pro и Business добавляют экспорт в PDF, DXF и EPS для производственных процессов.',
        },
        goodForPrinting: {
          question: 'Подходит ли это для печати?',
          answer:
            'Режим готовности к печати Vectorla проверяет разрешение, разумно уплощает цвета и создаёт чистые контуры с уменьшенным числом узлов, подходящие для CMYK-печати, а не просто декоративные веб-SVG.',
        },
        cncLaserCutting: {
          question: 'Могу ли я использовать это для ЧПУ или лазерной резки?',
          answer:
            'Да. Vectorla может экспортировать линии реза DXF, созданные прямо из вашего трассированного изображения, готовые для загрузки в CAM или программу резки.',
        },
        batchProcessing: {
          question: 'Поддерживается ли пакетная обработка?',
          answer:
            'Тарифы Pro и Business включают пакетную обработку — загрузите папку с изображениями и экспортируйте каждый результат в виде единого архива.',
        },
        apiAccess: {
          question: 'Будет ли доступ к API?',
          answer:
            'Доступ к API запланирован для тарифа Business, чтобы вы могли интегрировать Vectorla прямо в свой производственный процесс.',
        },
      },
    },
    footer: {
      tagline:
        'Платформа для векторизации на основе ИИ для дизайнеров, типографий и производственных команд.',
      columns: {
        product: {
          title: 'Продукт',
          links: ['Возможности', 'Варианты использования', 'Тарифы', 'Журнал изменений'],
        },
        resources: {
          title: 'Ресурсы',
          links: ['Документация', 'Справочник API', 'Руководства', 'Поддержка'],
        },
        company: {
          title: 'Компания',
          links: ['О нас', 'Блог', 'Вакансии', 'Контакты'],
        },
        legal: {
          title: 'Правовая информация',
          links: ['Политика конфиденциальности', 'Условия использования', 'Безопасность'],
        },
      },
      copyright: '© {year} Vectorla. Все права защищены.',
    },
  },
}

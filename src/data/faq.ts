export interface FaqItem {
  question: string
  answer: string
}

export const faqItems: FaqItem[] = [
  {
    question: 'Is Vectorla free?',
    answer:
      'Yes. The Free plan includes 5 conversions a month with SVG export and basic presets, no credit card required. Pro and Business plans unlock unlimited conversions and production features.',
  },
  {
    question: 'Are files uploaded to a server?',
    answer:
      'Core tracing runs in your browser. Some advanced AI features in future releases will use secure, encrypted processing — and we will always be explicit about what leaves your device.',
  },
  {
    question: 'Can I export SVG?',
    answer:
      'Yes, SVG export is available on every plan. Pro and Business plans add PDF, DXF, and EPS export for production workflows.',
  },
  {
    question: 'Is it good for printing?',
    answer:
      'Vectorla\u2019s Print-Ready Mode checks resolution, flattens colors sensibly, and produces clean, reduced-node paths suited for CMYK print production — not just decorative web SVGs.',
  },
  {
    question: 'Can I use it for CNC or laser cutting?',
    answer:
      'Yes. Vectorla can export DXF cut lines generated directly from your traced image, ready to bring into CAM or cutting software.',
  },
  {
    question: 'Does it support batch processing?',
    answer:
      'Pro and Business plans include batch processing — upload a folder of images and export every result as a single archive.',
  },
  {
    question: 'Will there be API access?',
    answer:
      'API access is planned for the Business plan, so you can integrate Vectorla directly into your own production pipeline.',
  },
]

interface LogoMarkProps {
  size?: number
  className?: string
}

/** Unique Vectorla mark: a traced corner-path motif suggesting a raster corner turning into a vector node. */
export function LogoMark({ size = 28, className = '' }: LogoMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="9" fill="url(#vectorla-logo-gradient)" />
      <path
        d="M9 10.5V21.5H20"
        stroke="white"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="9" cy="10.5" r="2" fill="white" />
      <circle cx="20" cy="21.5" r="2" fill="white" />
      <circle cx="20" cy="10.5" r="1.4" fill="white" fillOpacity="0.55" />
      <defs>
        <linearGradient
          id="vectorla-logo-gradient"
          x1="0"
          y1="0"
          x2="32"
          y2="32"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#6D28D9" />
          <stop offset="1" stopColor="#4C1D95" />
        </linearGradient>
      </defs>
    </svg>
  )
}

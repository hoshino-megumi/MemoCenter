const shapes = {
  check: <path d="M20 6L9 17l-5-5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18M8 6V4h8v2M6.5 6l.9 13.1h9.2L17.5 6" />
    </>
  ),
  close: <path d="M18 6L6 18M6 6l12 12" />,
  pin: (
    <>
      <path d="M12 17v5M9 3h6l-.6 5.2L18 12v2H6v-2l3.6-3.8L9 3z" />
    </>
  ),
  restore: <path d="M3 12a9 9 0 1 0 2.7-6.4M3 4v5h5" />,
  download: <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />,
  upload: <path d="M12 20V9M7 13l5-5 5 5M5 4h14" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" />
    </>
  ),
  moon: <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 0 0 9.8 9.8z" />,
  note: <path d="M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5" />,
  bell: (
    <>
      <path d="M12 3a5 5 0 0 0-5 5v3.2L5 15h14l-2-3.8V8a5 5 0 0 0-5-5z" />
      <path d="M10 18a2 2 0 0 0 4 0" />
    </>
  ),
  archive: (
    <>
      <path d="M3 7h18v3H3zM5 10v10h14V10M9 14h6" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M4 18l5-5 4 4 3-3 4 4" />
    </>
  ),
  history: (
    <>
      <path d="M3 12a9 9 0 1 0 2.6-6.4M3 4v5h5" />
      <path d="M12 8v4l3 2" />
    </>
  ),
  repeat: (
    <>
      <path d="M17 2l4 4-4 4" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <path d="M7 22l-4-4 4-4" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </>
  ),
  refresh: (
    <>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </>
  )
}

export default function Icon({ name, size = 16, className = '' }) {
  return (
    <svg
      className={`icon ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {shapes[name] || null}
    </svg>
  )
}

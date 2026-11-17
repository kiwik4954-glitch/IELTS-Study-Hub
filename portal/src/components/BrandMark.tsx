/** Small book-and-page mark. Decorative; the brand text carries the name. */
export function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 40 40" focusable="false">
        <rect width="40" height="40" rx="12" fill="currentColor" />
        <path
          d="M10.5 12.5h8.2c1.55 0 2.8 1.25 2.8 2.8v13.2c0-1.7-1.35-3.1-3.05-3.1H10.5z"
          fill="#F7F3EA"
        />
        <path
          d="M29.5 12.5h-8.2c-1.55 0-2.8 1.25-2.8 2.8v13.2c0-1.7 1.35-3.1 3.05-3.1h7.95z"
          fill="#D9772E"
        />
        <path
          d="M20 9.5v18.5"
          stroke="#0B3D2E"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

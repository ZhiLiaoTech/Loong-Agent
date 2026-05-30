import { useId } from "react";

export function LoongBrandMark({ size = 26 }: { size?: number }) {
  const gradId = useId();

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <linearGradient id={gradId} x1="5" y1="27" x2="27" y2="5" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--loong-accent, #7c6cf0)" />
          <stop offset="0.55" stopColor="var(--loong-accent, #8f82f4)" />
          <stop offset="1" stopColor="var(--loong-accent-light, #a89eff)" />
        </linearGradient>
      </defs>
      <path
        fill={`url(#${gradId})`}
        d="M22.8 4.2 25.8 2l.9 1.7-2.5 2c1.3.8 2.1 2.3 1.9 3.9-.2 1.5-1.2 2.8-2.6 3.4-.9.4-1.6 1.1-2 2-.6 1.2-1.8 2-3.2 2H11.4c-2.7 0-4.9-2.2-4.9-4.9 0-1.8.9-3.4 2.4-4.3 1.1-.6 1.9-1.6 2.3-2.8.7-2.2 2.8-3.8 5.2-3.8 2 0 3.8 1.1 4.7 2.8.3-.1.7-.1 1-.1 1.8 0 3.2 1.4 3.2 3.2 0 1-.4 1.9-1.2 2.5 1.6.9 2.6 2.6 2.6 4.5 0 3.1-2.5 5.6-5.6 5.6h-.2Z"
      />
      <path
        fill={`url(#${gradId})`}
        d="M6.4 24.2c-1.6-2-.5-4.8 1.7-5.8 1.1-.5 2.3-.2 3.1.6.8.8 1.2 2 1 3.1-.4 1.8-2 3.1-3.8 3.1-.8 0-1.5-.3-2-.8Z"
        opacity="0.95"
      />
      <circle cx="17.2" cy="10.6" r="0.9" fill="var(--loong-bg, #08080d)" />
      <circle cx="8.8" cy="22.4" r="1.55" fill="var(--loong-accent-light, #a89eff)" />
      <circle cx="8.8" cy="22.4" r="0.55" fill="#fff" opacity="0.45" />
      <path
        stroke="var(--loong-accent-light, #a89eff)"
        strokeWidth="0.7"
        strokeLinecap="round"
        d="M20.4 13.1c1 .35 1.9 1 2.4 1.9M19.2 14.3c.8.25 1.5.7 1.9 1.3"
        opacity="0.8"
      />
    </svg>
  );
}

import React from "react";

export function FacebookIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <rect width="24" height="24" rx="5.5" fill="#1877F2" />
      <path
        fill="#fff"
        d="M16.5 12.06h-2.3v7.44h-3.08v-7.44H9.5V9.4h1.62V7.72c0-1.99.85-3.17 3.2-3.17h1.97v2.66h-1.23c-.92 0-.98.34-.98.98l-.01 1.21h2.24l-.26 2.66Z"
      />
    </svg>
  );
}

export function InstagramIcon({ size = 16 }) {
  const gradId = "ig-grad";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <defs>
        <linearGradient id={gradId} x1="0" y1="24" x2="24" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFDD55" />
          <stop offset="0.35" stopColor="#FF543E" />
          <stop offset="0.65" stopColor="#C837AB" />
          <stop offset="1" stopColor="#5851DB" />
        </linearGradient>
      </defs>
      <rect width="24" height="24" rx="5.5" fill={`url(#${gradId})`} />
      <rect x="6" y="6" width="12" height="12" rx="3.5" fill="none" stroke="#fff" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="3.1" fill="none" stroke="#fff" strokeWidth="1.6" />
      <circle cx="16" cy="8" r="0.9" fill="#fff" />
    </svg>
  );
}

export function TikTokIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <rect width="24" height="24" rx="5.5" fill="#010101" />
      <path
        fill="#25F4EE"
        d="M13.9 4.6h-2.25v10.1a2.15 2.15 0 1 1-1.9-2.13v-2.28a4.4 4.4 0 1 0 4.15 4.39V9.9c.86.56 1.9.87 3 .87V8.5a3.05 3.05 0 0 1-3-2.85V4.6Z"
      />
      <path
        fill="#FE2C55"
        d="M14.35 5.05h-2.25v10.1a2.15 2.15 0 1 1-1.9-2.13v-2.28a4.4 4.4 0 1 0 4.15 4.39v-4.78c.86.56 1.9.87 3 .87V8.95a3.05 3.05 0 0 1-3-2.85V5.05Z"
      />
      <path
        fill="#fff"
        d="M14.12 4.82H11.9v10.1a2.15 2.15 0 1 1-1.9-2.13v-2.28a4.4 4.4 0 1 0 4.15 4.39V9.72c.86.56 1.9.87 3 .87V8.72a3.05 3.05 0 0 1-3-2.85V4.82Z"
      />
    </svg>
  );
}

export function GoogleIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.47c-.28 1.5-1.13 2.77-2.4 3.62v3h3.88c2.27-2.09 3.55-5.17 3.55-8.81Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.95-2.92l-3.88-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.26v3.09C3.24 21.3 7.28 24 12 24Z" />
      <path fill="#FBBC05" d="M5.27 14.27a7.2 7.2 0 0 1 0-4.54v-3.1H1.26a12 12 0 0 0 0 10.73l4.01-3.09Z" />
      <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.6 4.6 1.79l3.44-3.44C17.95 1.19 15.24 0 12 0 7.28 0 3.24 2.7 1.26 6.63l4.01 3.1c.95-2.85 3.6-4.98 6.73-4.98Z" />
    </svg>
  );
}

export function AppleIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M16.36 1.6c.1 1.06-.3 2.1-.98 2.87-.7.79-1.83 1.4-2.9 1.32-.13-1.03.36-2.1 1.02-2.83.73-.8 1.98-1.4 2.86-1.36ZM20.5 17.2c-.55 1.27-.82 1.84-1.53 2.96-.99 1.56-2.38 3.5-4.11 3.52-1.53.02-1.92-1-4-.99-2.08.01-2.5 1.01-4.04.99-1.73-.02-3.05-1.77-4.04-3.33C.13 17.24-.5 13.4.83 10.8c.94-1.83 2.65-2.98 4.5-3 1.53-.03 2.98 1.03 3.92 1.03.93 0 2.68-1.28 4.53-1.09.77.03 2.93.31 4.32 2.36-.11.07-2.58 1.51-2.55 4.5.03 3.58 3.13 4.77 3.16 4.78Z" />
    </svg>
  );
}

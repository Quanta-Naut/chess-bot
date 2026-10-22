import type { ReactNode } from "react";

// Line icons for the board controls (Lucide-style, 24px grid), drawn in the button's text colour.
function Ico({ children, filled }: { children: ReactNode; filled?: boolean }) {
  return (
    <svg
      className="ico"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

/** Turn the board around: two arrows passing each other. */
export const FlipIcon = () => (
  <Ico>
    <path d="m3 16 4 4 4-4" />
    <path d="M7 20V4" />
    <path d="m21 8-4-4-4 4" />
    <path d="M17 4v16" />
  </Ico>
);

/** Start over: a counter-clockwise arrow. */
export const RestartIcon = () => (
  <Ico>
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
  </Ico>
);

export const StartIcon = () => (
  <Ico filled>
    <path d="M19 20 9 12l10-8z" />
    <path d="M5 19V5" />
  </Ico>
);

export const EndIcon = () => (
  <Ico filled>
    <path d="m5 4 10 8-10 8z" />
    <path d="M19 5v14" />
  </Ico>
);

export const PrevIcon = () => (
  <Ico>
    <path d="m15 18-6-6 6-6" />
  </Ico>
);

export const NextIcon = () => (
  <Ico>
    <path d="m9 18 6-6-6-6" />
  </Ico>
);

export const BackIcon = () => (
  <Ico>
    <path d="m12 19-7-7 7-7" />
    <path d="M19 12H5" />
  </Ico>
);

import { useState, type ReactNode } from "react";

export type Page = "games" | "settings";

const STORAGE_KEY = "pawnie.sidebarOpen";

function readOpen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

const GRID = (
  <Icon>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </Icon>
);

const GEAR = (
  <Icon>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </Icon>
);

const LOGOUT = (
  <Icon>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </Icon>
);

const CHEVRONS = (
  <Icon>
    <polyline points="13 17 18 12 13 7" />
    <polyline points="6 17 11 12 6 7" />
  </Icon>
);

export function Sidebar({ page, onNavigate, onSignOut }: { page: Page; onNavigate: (p: Page) => void; onSignOut: () => void }) {
  const [open, setOpen] = useState(readOpen);

  const toggle = () => {
    setOpen((o) => {
      try {
        localStorage.setItem(STORAGE_KEY, o ? "0" : "1");
      } catch {
        // remembering the choice is only a convenience
      }
      return !o;
    });
  };

  const item = (icon: ReactNode, label: string, onClick: () => void, active = false) => (
    <button className={`side-item ${active ? "active" : ""}`} onClick={onClick} title={open ? undefined : label} aria-label={label}>
      {icon}
      <span className="side-label">{label}</span>
    </button>
  );

  return (
    <nav className={`sidebar ${open ? "open" : ""}`}>
      <div className="side-brand">
        <span className="side-logo" aria-hidden>
          ♟
        </span>
        <span className="side-label">Pawnie</span>
      </div>
      {item(GRID, "Games", () => onNavigate("games"), page === "games")}
      {item(GEAR, "Settings", () => onNavigate("settings"), page === "settings")}
      <div className="grow" />
      {item(LOGOUT, "Sign out", onSignOut)}
      <button className="side-item side-toggle" onClick={toggle} aria-label={open ? "Collapse sidebar" : "Expand sidebar"} title={open ? undefined : "Expand"}>
        {CHEVRONS}
        <span className="side-label">Collapse</span>
      </button>
    </nav>
  );
}

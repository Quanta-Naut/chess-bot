// Board colours: the light squares stay the off-white, the theme picks the dark squares.
// Saved to the account (profiles.boardTheme) so every device matches; this browser keeps a copy
// so boards are the right colour from the first paint, before the account loads.

export const BOARD_THEMES = [
  { id: "coral", name: "Coral", dark: "#e5927d" },
  { id: "sage", name: "Sage", dark: "#7bc9a0" },
  { id: "ocean", name: "Ocean", dark: "#6fa8c7" },
  { id: "walnut", name: "Walnut", dark: "#c49a6c" },
  { id: "slate", name: "Slate", dark: "#8e9ab0" },
  { id: "olive", name: "Olive", dark: "#a6b26a" },
  { id: "teal", name: "Teal", dark: "#5aa9a3" },
  { id: "sand", name: "Sand", dark: "#d8b27c" },
  { id: "rose", name: "Rose", dark: "#e39aa9" },
  { id: "charcoal", name: "Charcoal", dark: "#7c8494" },
] as const;

export type BoardThemeId = (typeof BOARD_THEMES)[number]["id"];

const STORAGE_KEY = "pawnie.board";

export const isBoardTheme = (id: unknown): id is BoardThemeId => BOARD_THEMES.some((t) => t.id === id);

export function boardTheme(): BoardThemeId {
  try {
    const id = localStorage.getItem(STORAGE_KEY);
    if (BOARD_THEMES.some((t) => t.id === id)) return id as BoardThemeId;
  } catch {
    // fall back to the default
  }
  return "coral";
}

/** Colour every board (and the game thumbnails) with the theme. */
export function applyBoardTheme(id: BoardThemeId = boardTheme()) {
  const theme = BOARD_THEMES.find((t) => t.id === id) ?? BOARD_THEMES[0];
  document.documentElement.style.setProperty("--sq-dark", theme.dark);
}

/** Apply a colour and remember it in this browser (the account copy is saved by the caller). */
export function setBoardTheme(id: BoardThemeId) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // still applies for this visit
  }
  applyBoardTheme(id);
}

import { useSyncExternalStore } from "react";

// Progress of the background analysis, readable from any page with useAnalysisProgress().
interface Progress {
  /** games still to analyse, including the one in progress */
  left: number;
  running: boolean;
}
let progress: Progress = { left: 0, running: false };
const listeners = new Set<() => void>();
export function setProgress(p: Progress) {
  progress = p;
  listeners.forEach((l) => l());
}

export function useAnalysisProgress(): Progress {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => progress,
  );
}

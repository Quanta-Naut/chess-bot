import type { Label } from "./review";

export const LABELS: Record<Label, { sym: string; title: string }> = {
  brilliant: { sym: "!!", title: "Brilliant" },
  great: { sym: "!", title: "Great" },
  best: { sym: "★", title: "Best" },
  excellent: { sym: "✓", title: "Excellent" },
  good: { sym: "✓", title: "Good" },
  book: { sym: "📖", title: "Book" },
  inaccuracy: { sym: "?!", title: "Inaccuracy" },
  mistake: { sym: "?", title: "Mistake" },
  blunder: { sym: "??", title: "Blunder" },
};

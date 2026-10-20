import type { Label } from "../lib/review";
import { LABELS } from "../lib/labelMeta";

export function Badge({ label }: { label: Label }) {
  return (
    <span className={`badge l-${label}`} title={LABELS[label].title}>
      {LABELS[label].sym}
    </span>
  );
}

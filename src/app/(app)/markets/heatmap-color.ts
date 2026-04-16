/**
 * Heatmap cell coloring for the Markets page.
 *
 * Returns a red→amber→green background + matching text color for a
 * 0–100 score, plus a "no data" gray for null values. The gradient
 * stops match the /heatmap legend exactly so the three screens agree
 * visually (map dots, ranking cells, opportunities cells).
 */

export interface HeatmapColor {
  background: string; // CSS color for the cell background
  text: string; // CSS color for the number inside
}

const GRAY: HeatmapColor = { background: "#F3F4F6", text: "#9CA3AF" };

/**
 * Map a 0–100 score to an Excel-style heatmap cell color.
 *
 * Bands mirror the /heatmap legend:
 *   65+     → deep green   (top tier)
 *   55–65   → green        (passing)
 *   45–55   → yellow       (middle)
 *   35–45   → orange       (below average)
 *   <35     → red          (bottom tier)
 */
export function heatmapColor(score: number | null): HeatmapColor {
  if (score == null || !Number.isFinite(score)) return GRAY;
  if (score >= 65) return { background: "#DCFCE7", text: "#15803D" }; // emerald-100 / emerald-700
  if (score >= 55) return { background: "#ECFDF5", text: "#047857" }; // emerald-50 / emerald-700
  if (score >= 45) return { background: "#FEF9C3", text: "#854D0E" }; // yellow-100 / yellow-800
  if (score >= 35) return { background: "#FFEDD5", text: "#9A3412" }; // orange-100 / orange-800
  return { background: "#FEE2E2", text: "#991B1B" }; // red-100 / red-800
}

/**
 * Compact style object suitable for an inline style prop.
 */
export function heatmapCellStyle(score: number | null): {
  backgroundColor: string;
  color: string;
} {
  const c = heatmapColor(score);
  return { backgroundColor: c.background, color: c.text };
}

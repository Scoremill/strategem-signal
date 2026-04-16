/**
 * /dashboard compatibility redirect.
 *
 * v1 of StrategemSignal used /dashboard as the landing page. v2 moved
 * the landing to /heatmap. Anyone with a /dashboard bookmark (or the
 * old sign-in flow's legacy redirect target) would hit a 404. This
 * thin page preserves the old URL by server-redirecting to the new
 * landing.
 */
import { redirect } from "next/navigation";

export default function DashboardRedirect() {
  redirect("/heatmap");
}

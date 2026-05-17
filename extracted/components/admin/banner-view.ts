import type { BannerState } from "@/lib/admin/banner";

export const BANNER_TINT: Record<BannerState["kind"], string> = {
  none: "",
  publish_failed:
    "bg-red-500/20 border-red-400/40 text-red-50",
  cron_stale:
    "bg-amber-500/20 border-amber-400/40 text-amber-50",
  stale_review:
    "bg-amber-500/15 border-amber-400/30 text-amber-50",
  needs_review_high:
    "bg-violet-500/20 border-violet-400/40 text-violet-50",
};

export function bannerMessage(state: BannerState): string | null {
  switch (state.kind) {
    case "none":
      return null;
    case "publish_failed":
      return `${state.count} publish failure${state.count === 1 ? "" : "s"} — open the affected article and click Retry Publish.`;
    case "cron_stale":
      return `Cron ${state.cronName} hasn't run in ${state.ageHours}h — check GitHub Actions.`;
    case "stale_review":
      return `No review activity in ${state.daysSinceLastReview} days — check the queue.`;
    case "needs_review_high":
      return `${state.count} articles waiting for review — clear the queue.`;
  }
}

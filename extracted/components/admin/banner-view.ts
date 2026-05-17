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
    case "cron_stale": {
      // age comes from SQL COALESCE(last_ok, '1970-01-01') — when last_ok is NULL
      // (cron has never succeeded) the value is ~500k hours. Distinguish that
      // case from a recent staleness so the banner reads sensibly.
      const NEVER_RAN = state.ageHours > 24 * 365 * 5; // > 5 years
      if (NEVER_RAN) {
        return `Cron ${state.cronName} has never run successfully — check GitHub Actions.`;
      }
      return `Cron ${state.cronName} hasn't run in ${state.ageHours}h — check GitHub Actions.`;
    }
    case "stale_review":
      return `No review activity in ${state.daysSinceLastReview} days — check the queue.`;
    case "needs_review_high":
      return `${state.count} articles waiting for review — clear the queue.`;
  }
}

import type { BannerState } from "@/lib/admin/banner";
import { bannerMessage, BANNER_TINT } from "./banner-view";

export function Banner({ state }: { state: BannerState }) {
  const msg = bannerMessage(state);
  if (!msg) return null;
  return (
    <div
      role="alert"
      data-banner-kind={state.kind}
      className={`rounded-xl border px-4 py-3 mb-6 backdrop-blur-sm font-medium ${BANNER_TINT[state.kind]}`}
    >
      {msg}
    </div>
  );
}

/**
 * use-auto-refresh.ts
 *
 * Re-run a callback on a fixed interval and whenever the tab regains focus, so a
 * mounted view keeps its data fresh without manual reloads. Polling is skipped
 * while the tab is hidden (no point refreshing a background tab) and fires once
 * on becoming visible again. The latest callback is read through a ref, so the
 * interval is not torn down and recreated on every render.
 */
import { useEffect, useRef } from "react";

export const useAutoRefresh = ({
  onRefresh,
  intervalMs,
  enabled,
}: {
  onRefresh: () => void;
  intervalMs: number;
  enabled: boolean;
}): void => {
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const refreshIfVisible = (): void => {
      if (document.visibilityState === "visible") {
        onRefreshRef.current();
      }
    };
    const interval = globalThis.setInterval(refreshIfVisible, intervalMs);
    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return (): void => {
      globalThis.clearInterval(interval);
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [enabled, intervalMs]);
};

// Apply the saved appearance before React mounts to avoid a light/dark flash.
import { applyTheme, usePreferences } from "./lib/preferences";
import { initialDashboardHash, useViewState } from "./lib/view-state";

applyTheme(usePreferences.getState().theme);

const hash = initialDashboardHash(
  window.location,
  useViewState.getState().pathname,
);
if (hash !== window.location.hash) {
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${window.location.search}${hash}`,
  );
}

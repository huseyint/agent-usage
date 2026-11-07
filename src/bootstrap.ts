// Apply the saved appearance before React mounts to avoid a light/dark flash.
import { applyTheme, usePreferences } from "./lib/preferences";

applyTheme(usePreferences.getState().theme);

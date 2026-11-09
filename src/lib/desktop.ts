import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";

export const isDesktop = isTauri();
export const isMac = navigator.platform.startsWith("Mac");
export const repositoryUrl = "https://github.com/huseyint/agent-usage";
export const ccusageUrl = "https://github.com/ccusage/ccusage";

export async function openExternalUrl(url: string) {
  if (isDesktop) await openUrl(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}

export async function listenForMenu(action: (name: string) => void) {
  if (!isDesktop) return () => {};
  return listen<string>("menu-action", (event) => action(event.payload));
}

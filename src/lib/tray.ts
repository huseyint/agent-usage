import { invoke } from "@tauri-apps/api/core";
import { isDesktop } from "./desktop";

export type DashboardTarget = {
  page: "overview" | "sessions" | "settings";
  sessionKey?: string;
};

export async function openDashboard(target: DashboardTarget) {
  if (isDesktop) await invoke("open_dashboard", { target });
  else {
    const path = target.page === "overview" ? "/" : `/${target.page}`;
    window.location.href = `${window.location.pathname}#${path}${target.sessionKey ? `?session=${encodeURIComponent(target.sessionKey)}` : ""}`;
  }
}

export async function dismissTray() {
  if (isDesktop) await invoke("dismiss_tray");
}

export async function quitFromTray() {
  if (isDesktop) await invoke("quit_from_tray");
}

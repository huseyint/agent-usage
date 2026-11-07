import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type Theme = "system" | "light" | "dark";

interface Preferences {
  theme: Theme;
  sidebarVisible: boolean;
  sidebarWidth: number;
  setTheme: (theme: Theme) => void;
  toggleSidebar: () => void;
  setSidebarWidth: (sidebarWidth: number) => void;
}

export const usePreferences = create<Preferences>()(
  persist(
    (set) => ({
      theme: "system",
      sidebarVisible: true,
      sidebarWidth: 300,
      setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
      setTheme: (theme) => set({ theme }),
      toggleSidebar: () =>
        set((state) => ({ sidebarVisible: !state.sidebarVisible })),
    }),
    {
      name: "agent-usage.ui-preferences",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ theme, sidebarVisible, sidebarWidth }) => ({
        theme,
        sidebarVisible,
        sidebarWidth,
      }),
    },
  ),
);

export function applyTheme(theme: Theme) {
  const dark =
    theme === "dark" ||
    (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  return dark ? "dark" : "light";
}

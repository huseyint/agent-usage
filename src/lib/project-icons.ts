import type { ProjectIconData } from "./usage-types";

// Mounted labels share React Query's per-project cache. Batch new project
// requests so a long session list reads the native snapshot only once.
export function createProjectIconLoader(
  fetchIcons: (paths: string[]) => Promise<Record<string, ProjectIconData>>,
) {
  let pending = new Map<
    string,
    {
      resolve: (icon: ProjectIconData | null) => void;
      reject: (error: unknown) => void;
      promise: Promise<ProjectIconData | null>;
    }
  >();
  let scheduled = false;
  return (path: string): Promise<ProjectIconData | null> => {
    const existing = pending.get(path);
    if (existing) return existing.promise;
    const promise = new Promise<ProjectIconData | null>((resolve, reject) => {
      pending.set(path, { resolve, reject, promise: undefined! });
    });
    pending.get(path)!.promise = promise;
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(() => {
        const batch = pending;
        pending = new Map();
        scheduled = false;
        const paths = [...batch.keys()];
        for (let i = 0; i < paths.length; i += 100) {
          const chunk = paths.slice(i, i + 100);
          void fetchIcons(chunk).then(
            (icons) =>
              chunk.forEach((key) =>
                batch.get(key)!.resolve(icons[key] ?? null),
              ),
            (error) => chunk.forEach((key) => batch.get(key)!.reject(error)),
          );
        }
      });
    }
    return promise;
  };
}

import { useEffect, useRef, useState } from "react";
import { useWindowFocused } from "./use-window-focused";
import { usageApi } from "./usage-api";

// Keep labels for this visit even after acknowledging them in the shared store.
// Only a visible, focused session surface can acknowledge loaded sessions.
export function useSessionVisits(
  keys: string[],
  enabled: boolean,
  revision: number,
) {
  const focused = useWindowFocused();
  const [newKeys, setNewKeys] = useState<Set<string>>(new Set());
  const checked = useRef(new Set<string>());
  const visit = useRef(0);
  const serializedKeys = JSON.stringify(keys);

  useEffect(() => {
    if (!focused || !enabled) {
      visit.current++;
      checked.current.clear();
      setNewKeys(new Set());
    }
  }, [focused, enabled]);

  useEffect(() => {
    if (!focused || !enabled) return;
    const pending = (JSON.parse(serializedKeys) as string[]).filter(
      (key) => !checked.current.has(key),
    );
    if (!pending.length) return;
    const currentVisit = visit.current;
    pending.forEach((key) => checked.current.add(key));
    void (async () => {
      for (let offset = 0; offset < pending.length; offset += 500) {
        if (currentVisit !== visit.current) return;
        const batch = pending.slice(offset, offset + 500);
        try {
          const unread = await usageApi.checkSessions(batch);
          if (currentVisit === visit.current && unread.length)
            setNewKeys((prior) => new Set([...prior, ...unread]));
        } catch {
          if (currentVisit === visit.current)
            batch.forEach((key) => checked.current.delete(key));
        }
      }
    })();
  }, [serializedKeys, enabled, focused, revision]);

  return (key: string) => newKeys.has(key);
}

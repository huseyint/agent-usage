import { useEffect, useState } from "react";
import { dateKey } from "./format";
import { millisecondsUntilNextDay } from "./day-clock";

export function useCurrentDay(timezone: string) {
  const [now, setNow] = useState(Date.now());
  const today = dateKey(new Date(now), timezone);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const visible = () => {
      if (document.visibilityState === "visible") update();
    };
    const timer = window.setTimeout(
      update,
      millisecondsUntilNextDay(Date.now(), timezone),
    );
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [today, timezone]);
  return today;
}

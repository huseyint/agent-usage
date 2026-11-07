import { dateKey } from "./format.ts";

// Find the actual next calendar boundary; a local day can be 23 or 25 hours.
export function millisecondsUntilNextDay(now: number, timezone: string) {
  const today = dateKey(new Date(now), timezone);
  let before = now;
  let after = now + 36 * 60 * 60 * 1000;
  while (after - before > 1) {
    const middle = Math.floor((before + after) / 2);
    if (dateKey(new Date(middle), timezone) === today) before = middle;
    else after = middle;
  }
  return Math.max(1, after - now);
}

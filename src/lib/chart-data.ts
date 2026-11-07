import type { DailyUsage } from "./usage-types";
export type Bucket = {
  date: string;
  claude: number;
  codex: number;
  tokens: number;
  covered: boolean;
};
export function bucketDaily(
  daily: DailyUsage[],
  since: string | null,
  until: string | null,
  aggregation: string,
): Bucket[] {
  const map = new Map<string, Bucket>();
  const first = since || daily.map((d) => d.date).sort()[0];
  const last =
    until ||
    daily
      .map((d) => d.date)
      .sort()
      .at(-1);
  if (!first || !last) return [];
  const minRecorded = daily.map((d) => d.date).sort()[0];
  const start = new Date(`${first}T12:00:00`),
    end = new Date(`${last}T12:00:00`);
  let days = 0;
  for (
    const date = new Date(start);
    date <= end && days < 3660;
    date.setDate(date.getDate() + 1), days++
  ) {
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    map.set(key, {
      date: key,
      claude: 0,
      codex: 0,
      tokens: 0,
      covered: !!minRecorded && key >= minRecorded,
    });
  }
  daily.forEach((d) => {
    const b = map.get(d.date);
    if (b) {
      b[d.provider] += d.costMicros;
      b.tokens += d.tokens.total;
    }
  });
  if (aggregation === "day") return [...map.values()];
  const groups = new Map<string, Bucket>();
  for (const b of map.values()) {
    const d = new Date(`${b.date}T12:00:00`);
    if (aggregation === "week") d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const key =
      aggregation === "month"
        ? b.date.slice(0, 7)
        : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    let r = groups.get(key);
    if (!r) {
      r = { date: key, claude: 0, codex: 0, tokens: 0, covered: false };
      groups.set(key, r);
    }
    r.claude += b.claude;
    r.codex += b.codex;
    r.tokens += b.tokens;
    r.covered ||= b.covered;
  }
  return [...groups.values()];
}

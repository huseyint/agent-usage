export const costDescription =
  "Estimated USD value of recorded tokens at API pricing. Not the amount billed under Claude or ChatGPT subscription plans.";
export function money(micros: number) {
  const n = micros / 1e6;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: n > 0 && n < 0.01 ? 6 : 2,
  }).format(n);
}
export function compact(n: number) {
  return Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}
export function number(n: number) {
  return Intl.NumberFormat("en-US").format(n);
}
export function dateKey(date: Date, timezone = "local") {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(timezone !== "local" ? { timeZone: timezone } : {}),
  }).format(date);
}
export function displayDate(
  value: string,
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" },
) {
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString(
    "en-US",
    options,
  );
}
export function displayDay(
  value: string,
  timezone = "local",
  now = new Date(),
) {
  const today = dateKey(now, timezone);
  if (value === today) return "Today";
  const yesterday = new Date(`${today}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  if (value === yesterday.toISOString().slice(0, 10)) return "Yesterday";
  return displayDate(value, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
export function time(value: string, timezone = "local") {
  if (!value) return "Unknown";
  return new Date(value).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...(timezone !== "local" ? { timeZone: timezone } : {}),
  });
}
export function modelName(name: string) {
  return name
    .replace(/^claude-/, "")
    .replace(/-20\d{6}$/, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (s) => s.toUpperCase())
    .replace(/^Gpt /, "GPT-");
}
export function rangeDates(
  range: string,
  timezone: string,
  customSince: string,
  customUntil: string,
): [string | null, string | null] {
  const today = dateKey(new Date(), timezone);
  const end = new Date(`${today}T12:00:00`);
  const start = new Date(end);
  if (range === "all") return [null, null];
  if (range === "custom") return [customSince || today, customUntil || today];
  if (range === "yesterday") {
    start.setDate(start.getDate() - 1);
    end.setDate(end.getDate() - 1);
  }
  if (range === "7d" || range === "30d")
    start.setDate(start.getDate() - (range === "7d" ? 6 : 29));
  if (range === "month") start.setDate(1);
  if (range === "lastMonth") {
    start.setDate(1);
    start.setMonth(start.getMonth() - 1);
    end.setDate(0);
  }
  const key = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return [key(start), key(end)];
}

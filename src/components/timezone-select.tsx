import type { SelectHTMLAttributes } from "react";

const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const timezones = Intl.supportedValuesOf?.("timeZone") ?? [
  "America/Chicago",
  "America/Los_Angeles",
  "America/New_York",
  "Asia/Tokyo",
  "Europe/Istanbul",
  "Europe/London",
];

export function TimezoneSelect({
  value,
  onChange,
  ...props
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange"> & {
  value: string;
  onChange: (timezone: string) => void;
}) {
  const groups = new Map<string, string[]>();
  for (const timezone of [...new Set([...timezones, systemTimezone, value])]
    .filter((timezone) => timezone !== "local" && timezone !== "UTC")
    .sort()) {
    const region = timezone.includes("/") ? timezone.split("/")[0] : "Other";
    const options = groups.get(region) ?? [];
    options.push(timezone);
    groups.set(region, options);
  }

  return (
    <select
      aria-label="Display timezone"
      {...props}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="local">System timezone</option>
      <option value="UTC">UTC</option>
      {[...groups].map(([region, options]) => (
        <optgroup key={region} label={region}>
          {options.map((timezone) => (
            <option key={timezone} value={timezone}>
              {timezone.replaceAll("_", " ")}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

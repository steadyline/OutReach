export type DeliverySettings = {
  dailyLimit: number;
  startTime: string;
  endTime: string;
  timezone: string;
  minGapMinutes: number;
  maxGapMinutes: number;
  followupAfterDays: number;
  secondFollowupAfterDays: number;
  maxFollowups: number;
  stopOnOpen: boolean;
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timezone: string) {
  const cached = formatterCache.get(timezone);
  if (cached) {
    return cached;
  }
  const created = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  formatterCache.set(timezone, created);
  return created;
}

export function parseTimeToMinutes(value: string) {
  const [hour = "0", minute = "0"] = value.split(":");
  return Number(hour) * 60 + Number(minute);
}

function localParts(date: Date, timezone: string) {
  const parts = formatter(timezone).formatToParts(date);
  const out: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      out[part.type] = Number(part.value);
    }
  }
  if (out.hour === 24) {
    out.hour = 0;
  }
  return out as {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
  };
}

export function localDateKey(date: Date, timezone: string) {
  const parts = localParts(date, timezone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(
    parts.day
  ).padStart(2, "0")}`;
}

export function localMinutes(date: Date, timezone: string) {
  const parts = localParts(date, timezone);
  return parts.hour * 60 + parts.minute;
}

export function isWithinWorkingWindow(date: Date, settings: DeliverySettings) {
  const current = localMinutes(date, settings.timezone);
  const start = parseTimeToMinutes(settings.startTime);
  const end = parseTimeToMinutes(settings.endTime);

  if (start === end) {
    return true;
  }
  if (start < end) {
    return current >= start && current <= end;
  }
  return current >= start || current <= end;
}

export function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

export function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60_000);
}

export function randomGapMinutes(settings: DeliverySettings) {
  const min = Math.max(1, Math.floor(settings.minGapMinutes));
  const max = Math.max(min, Math.floor(settings.maxGapMinutes));
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function nextWorkingTime(from: Date, settings: DeliverySettings) {
  let cursor = new Date(Math.ceil(from.getTime() / 60_000) * 60_000);
  for (let i = 0; i < 60 * 24 * 14; i += 1) {
    if (isWithinWorkingWindow(cursor, settings)) {
      return cursor;
    }
    cursor = addMinutes(cursor, 1);
  }
  return from;
}

export function nextWorkingTimeAfterGap(from: Date, settings: DeliverySettings) {
  return nextWorkingTime(addMinutes(from, randomGapMinutes(settings)), settings);
}


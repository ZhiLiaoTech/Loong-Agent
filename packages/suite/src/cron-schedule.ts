/**
 * Minimal standard 5-field cron next-run calculator (UTC).
 *
 * Supports `*`, ranges (`1-5`), steps (`*​/5`), lists (`1,3,5`) and the common
 * `@hourly`/`@daily`/`@weekly`/`@monthly`/`@yearly` aliases — matching the
 * semantics of `@loong/cron` closely enough to seed `nextRunAt`. The live
 * cron runner recomputes `nextRunAt` after each delivery, so this only needs to
 * produce a correct first occurrence.
 */

const ALIASES: Record<string, string> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
};

interface CronFields {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  domRestricted: boolean;
  dowRestricted: boolean;
}

function parseField(expr: string, min: number, max: number): Set<number> {
  const values = new Set<number>();
  for (const segment of expr.split(",")) {
    const trimmed = segment.trim();
    if (!trimmed) {
      continue;
    }
    let step = 1;
    let rangePart = trimmed;
    const slashIndex = trimmed.indexOf("/");
    if (slashIndex >= 0) {
      step = Number.parseInt(trimmed.slice(slashIndex + 1), 10) || 1;
      rangePart = trimmed.slice(0, slashIndex);
    }
    let lo: number;
    let hi: number;
    if (rangePart === "*" || rangePart === "") {
      lo = min;
      hi = max;
    } else if (rangePart.includes("-")) {
      const [a, b] = rangePart.split("-");
      lo = Number.parseInt(a ?? "", 10);
      hi = Number.parseInt(b ?? "", 10);
    } else {
      lo = Number.parseInt(rangePart, 10);
      hi = lo;
    }
    if (Number.isNaN(lo) || Number.isNaN(hi)) {
      continue;
    }
    for (let value = lo; value <= hi; value += step) {
      // normalize Sunday-as-7 to 0 for day-of-week
      const normalized = max === 6 && value === 7 ? 0 : value;
      if (normalized >= min && normalized <= max) {
        values.add(normalized);
      }
    }
  }
  return values;
}

export function parseCronExpression(schedule: string): CronFields {
  const normalized = ALIASES[schedule.trim()] ?? schedule.trim();
  const parts = normalized.split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`invalid cron expression: "${schedule}"`);
  }
  const [minute, hour, dom, month, dow] = parts as [string, string, string, string, string];
  return {
    minute: parseField(minute, 0, 59),
    hour: parseField(hour, 0, 23),
    dom: parseField(dom, 1, 31),
    month: parseField(month, 1, 12),
    dow: parseField(dow, 0, 6),
    domRestricted: dom.trim() !== "*",
    dowRestricted: dow.trim() !== "*",
  };
}

// ~5 years of minutes, matching @loong/cron's search horizon.
const MAX_SEARCH_MINUTES = 366 * 24 * 60 * 5;

function matchesDay(fields: CronFields, dom: number, dow: number): boolean {
  const domOk = fields.dom.has(dom);
  const dowOk = fields.dow.has(dow);
  if (fields.domRestricted && fields.dowRestricted) {
    return domOk || dowOk;
  }
  if (fields.domRestricted) {
    return domOk;
  }
  if (fields.dowRestricted) {
    return dowOk;
  }
  return true;
}

export function nextCronRun(schedule: string, from: Date): Date {
  const fields = parseCronExpression(schedule);
  const cursor = new Date(
    Date.UTC(
      from.getUTCFullYear(),
      from.getUTCMonth(),
      from.getUTCDate(),
      from.getUTCHours(),
      from.getUTCMinutes(),
    ),
  );
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1, 0, 0);

  for (let i = 0; i < MAX_SEARCH_MINUTES; i += 1) {
    const month = cursor.getUTCMonth() + 1;
    if (
      fields.month.has(month) &&
      fields.hour.has(cursor.getUTCHours()) &&
      fields.minute.has(cursor.getUTCMinutes()) &&
      matchesDay(fields, cursor.getUTCDate(), cursor.getUTCDay())
    ) {
      return new Date(cursor);
    }
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }
  throw new Error(`could not compute next run for cron "${schedule}"`);
}

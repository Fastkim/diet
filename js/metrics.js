/** Calendar calculations for the private weight journal. No storage or network. */

const DAY_MS = 86_400_000;

/** Format a Date in the user's local calendar, without UTC date shifting. */
export function dateISO(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError('올바른 날짜가 필요합니다.');
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function todayISO(now = new Date()) {
  return dateISO(now);
}

/** Local noon stays on the intended calendar day across daylight-saving changes. */
export function parseDate(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    throw new TypeError('올바른 날짜가 필요합니다.');
  }
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(12, 0, 0, 0);
  if (dateISO(date) !== iso) throw new TypeError('존재하지 않는 날짜입니다.');
  return date;
}

export function formatDate(iso, options = { month: 'long', day: 'numeric' }) {
  return new Intl.DateTimeFormat('ko-KR', options).format(parseDate(iso));
}

function dayNumber(iso) {
  const date = parseDate(iso);
  const utc = new Date(0);
  utc.setUTCFullYear(date.getFullYear(), date.getMonth(), date.getDate());
  utc.setUTCHours(0, 0, 0, 0);
  return utc.getTime() / DAY_MS;
}

function sortedRecords(records) {
  return [...records].sort((a, b) => a.date.localeCompare(b.date));
}

/** Input records are never mutated. */
export function yearRecords(records, year) {
  const prefix = `${Number(year)}-`;
  return sortedRecords(records.filter((record) => record.date.startsWith(prefix)));
}

/** The streak ends at the most recent record in the selected year, not today. */
export function stats(records, year) {
  const selected = yearRecords(records, year);
  const count = selected.length;
  if (!count) {
    return {
      count: 0, first: null, last: null, change: null, min: null, max: null,
      average: null, streak: 0, streakStart: null, streakEnd: null,
    };
  }
  const first = selected[0];
  const last = selected[count - 1];
  let streak = 1;
  for (let i = count - 1; i > 0; i -= 1) {
    if (dayNumber(selected[i].date) - dayNumber(selected[i - 1].date) !== 1) break;
    streak += 1;
  }
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const record of selected) {
    min = Math.min(min, record.weight);
    max = Math.max(max, record.weight);
    sum += record.weight;
  }
  return {
    count, first, last, change: last.weight - first.weight, min, max,
    average: sum / count, streak,
    streakStart: selected[count - streak].date,
    streakEnd: last.date,
  };
}

/**
 * At each observation, average only records from the trailing calendar interval.
 * Missing days are not invented, interpolated, or counted as zero.
 */
export function movingAverage(records, days = 7) {
  if (!Number.isInteger(days) || days < 1) throw new RangeError('기간은 1일 이상이어야 합니다.');
  const selected = sortedRecords(records);
  const output = [];
  let start = 0;
  let sum = 0;
  for (let end = 0; end < selected.length; end += 1) {
    const current = selected[end];
    const earliestDay = dayNumber(current.date) - days + 1;
    sum += current.weight;
    while (dayNumber(selected[start].date) < earliestDay) {
      sum -= selected[start].weight;
      start += 1;
    }
    output.push({ date: current.date, weight: sum / (end - start + 1) });
  }
  return output;
}

/**
 * A 30/90-day chart ends at that year's latest observation. This keeps previous
 * years readable and doesn't make a quiet recent period erase historical data.
 * The optional today argument is retained for the shared public API; records
 * are validated against future dates before reaching this calculation module.
 */
export function chartRecords(records, year, range = 'year', today = todayISO()) {
  void today;
  const selected = yearRecords(records, year);
  if (!selected.length || range === 'year') return selected;
  const days = Number(range);
  if (days !== 30 && days !== 90) throw new RangeError('지원하지 않는 차트 기간입니다.');
  const earliestDay = dayNumber(selected[selected.length - 1].date) - days + 1;
  return selected.filter((record) => dayNumber(record.date) >= earliestDay);
}

export function monthlyStats(records, year) {
  const selected = yearRecords(records, year);
  return Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const monthly = selected.filter((record) => Number(record.date.slice(5, 7)) === month);
    return {
      month,
      count: monthly.length,
      average: monthly.length ? monthly.reduce((sum, record) => sum + record.weight, 0) / monthly.length : null,
      change: monthly.length ? monthly[monthly.length - 1].weight - monthly[0].weight : null,
    };
  });
}

/** Every actual local-calendar date in a year, including February 29. */
export function calendarDays(year) {
  const numericYear = Number(year);
  if (!Number.isInteger(numericYear) || numericYear < 1000 || numericYear > 9999) {
    throw new RangeError('연도는 1000년부터 9999년 사이여야 합니다.');
  }
  const date = parseDate(`${numericYear}-01-01`);
  const output = [];
  while (date.getFullYear() === numericYear) {
    output.push(dateISO(date));
    date.setDate(date.getDate() + 1);
  }
  return output;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  todayISO, dateISO, parseDate, formatDate, yearRecords, stats,
  movingAverage, chartRecords, monthlyStats, calendarDays,
} from '../js/metrics.js';

const record = (date, weight) => ({ date, weight, note: '' });

test('calendar dates are local and reject impossible dates', () => {
  const local = new Date(2026, 10, 15, 23, 59);
  assert.equal(dateISO(local), '2026-11-15');
  assert.equal(todayISO(local), '2026-11-15');
  assert.equal(parseDate('2024-02-29').getHours(), 12);
  assert.equal(dateISO(parseDate('2024-02-29')), '2024-02-29');
  assert.equal(formatDate('2026-11-15'), '11월 15일');
  for (const date of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-1-01']) {
    assert.throws(() => parseDate(date));
  }
});

test('calendarDays includes leap days and century leap rules', () => {
  assert.equal(calendarDays(2024).length, 366);
  assert.equal(calendarDays(2026).length, 365);
  assert.equal(calendarDays(2100).length, 365);
  assert.equal(calendarDays(2000).length, 366);
  assert.ok(calendarDays(2024).includes('2024-02-29'));
  assert.equal(calendarDays(2026).at(-1), '2026-12-31');
});

test('yearRecords sorts observations without mutating input', () => {
  const input = [record('2026-05-04', 70), record('2025-12-31', 75), record('2026-01-01', 73)];
  const before = structuredClone(input);
  assert.deepEqual(yearRecords(input, 2026).map((r) => r.date), ['2026-01-01', '2026-05-04']);
  assert.deepEqual(input, before);
});

test('stats measure selected year and recent consecutive run', () => {
  const input = [
    record('2025-12-31', 90), record('2026-01-01', 80),
    record('2026-02-26', 78), record('2026-02-28', 76), record('2026-03-01', 74),
  ];
  const summary = stats(input, 2026);
  assert.equal(summary.count, 4);
  assert.equal(summary.first.weight, 80);
  assert.equal(summary.last.weight, 74);
  assert.equal(summary.change, -6);
  assert.equal(summary.min, 74);
  assert.equal(summary.max, 80);
  assert.equal(summary.average, 77);
  assert.equal(summary.streak, 2);
  assert.equal(summary.streakStart, '2026-02-28');
  assert.equal(summary.streakEnd, '2026-03-01');
  assert.equal(stats(input.slice(0, 2), 2026).streak, 1);
});

test('empty statistics remain empty and one record has zero change', () => {
  assert.deepEqual(stats([], 2026), {
    count: 0, first: null, last: null, change: null, min: null, max: null,
    average: null, streak: 0, streakStart: null, streakEnd: null,
  });
  assert.equal(stats([record('2026-11-15', 70)], 2026).change, 0);
});

test('moving averages use calendar days and exclude missing observations', () => {
  const input = [record('2026-03-01', 80), record('2026-03-07', 70), record('2026-03-08', 68), record('2026-04-01', 64)];
  assert.deepEqual(movingAverage(input), [
    { date: '2026-03-01', weight: 80 }, { date: '2026-03-07', weight: 75 },
    { date: '2026-03-08', weight: 69 }, { date: '2026-04-01', weight: 64 },
  ]);
  assert.deepEqual(movingAverage(input, 1), input.map(({ date, weight }) => ({ date, weight })));
  assert.deepEqual(movingAverage([]), []);
  assert.throws(() => movingAverage(input, 0), RangeError);
});

test('30/90-day charts end at latest selected-year observation, inclusive', () => {
  const input = [
    record('2025-12-31', 90), record('2026-01-01', 80), record('2026-03-01', 78),
    record('2026-03-02', 77), record('2026-03-31', 74), record('2027-01-01', 73),
  ];
  assert.deepEqual(chartRecords(input, 2026, '30').map((r) => r.date), ['2026-03-02', '2026-03-31']);
  assert.equal(chartRecords(input, 2026, '90').length, 4);
  assert.equal(chartRecords(input, 2026, 'year').length, 4);
  assert.deepEqual(chartRecords([], 2026), []);
});

test('monthly stats retain twelve months and no phantom averages', () => {
  const input = [record('2025-01-01', 90), record('2026-01-01', 80), record('2026-01-31', 78), record('2026-03-01', 76)];
  const output = monthlyStats(input, 2026);
  assert.equal(output.length, 12);
  assert.deepEqual(output[0], { month: 1, count: 2, average: 79, change: -2 });
  assert.deepEqual(output[1], { month: 2, count: 0, average: null, change: null });
  assert.deepEqual(output[2], { month: 3, count: 1, average: 76, change: 0 });
});

/**
 * Dates as the app shows them, one Korean format everywhere: "10. 18. 오전 03:00", with the year
 * when it is not this year. `clock` is the time alone, for lists of one day's calls.
 */
export function dateTime(at: Date | string | number) {
  const date = new Date(at);
  const thisYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleString('ko-KR', { ...(!thisYear && { year: 'numeric' }), month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export const clock = (at: Date | string | number) => new Date(at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** Hours and minutes alone ("09:12"), for entries listed under their day. */
export const hourMinute = (at: Date | string | number) => new Date(at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

const dayStart = (at: Date | string | number) => {
  const date = new Date(at);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};

/** A day as a list's heading: "오늘 · 11월 1일", "어제 · 10월 31일", "10월 28일", with the year when it is not this year. */
export function dayLabel(at: Date | string | number, now: Date | number = Date.now()) {
  const date = new Date(at);
  const thisYear = date.getFullYear() === new Date(now).getFullYear();
  const day = date.toLocaleDateString('ko-KR', { ...(!thisYear && { year: 'numeric' }), month: 'long', day: 'numeric' });
  const ago = Math.round((dayStart(now) - dayStart(date)) / 86_400_000);
  return ago === 0 ? `오늘 · ${day}` : ago === 1 ? `어제 · ${day}` : day;
}

/** Items grouped by their day, in the order given (newest first stays newest first). */
export function byDay<T>(items: readonly T[], at: (item: T) => Date | string | number) {
  const days: { key: number; items: T[] }[] = [];
  for (const item of items) {
    const key = dayStart(at(item));
    const last = days.at(-1);
    if (last?.key === key) last.items.push(item);
    else days.push({ key, items: [item] });
  }
  return days;
}

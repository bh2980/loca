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

/* 編集するのは、このリストだけ。日時は必ずタイムゾーン付きのISO 8601形式で記入します。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RadioSchedule = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // 例: { title: 'おためし集合', start: '2026-12-01T21:00:00+09:00', end: '2026-12-01T21:30:00+09:00' }
  // 上記は書式の例です。実際の予定ではありません。
  const events = [];
  const zoned = /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?(?:Z|[+-]\d\d:\d\d)$/;
  function validTime(value) {
    if (typeof value !== 'string' || !zoned.test(value)) return false;
    const match = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d))?(Z|[+-]\d\d:\d\d)$/.exec(value);
    const [, y, m, d, h, min, sec = '0', zone] = match;
    const parts = [y, m, d, h, min, sec].map(Number);
    const [year, month, day, hour, minute, second] = parts;
    if (year < 2000 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
    const check = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return false;
    if (zone !== 'Z') {
      const zh = Number(zone.slice(1,3)), zm = Number(zone.slice(4,6));
      if (zh > 14 || zm > 59 || (zh === 14 && zm !== 0)) return false;
    }
    return Number.isFinite(Date.parse(value));
  }
  function upcoming(list, now) {
    if (!Array.isArray(list)) return [];
    return list.filter(event => event && typeof event.title === 'string' && event.title.trim() &&
      validTime(event.start) && validTime(event.end) &&
      Date.parse(event.end) > Date.parse(event.start) && Date.parse(event.end) > now)
      .slice().sort((a,b) => Date.parse(a.start)-Date.parse(b.start));
  }
  function format(event) {
    const date = new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',weekday:'short',hour:'2-digit',minute:'2-digit'});
    const end = new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
    return date.format(new Date(event.start)) + ' 〜 ' + end.format(new Date(event.end)) + '（日本時間）';
  }
  return {events, upcoming, format};
});

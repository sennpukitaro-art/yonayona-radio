const test = require('node:test');
const assert = require('node:assert/strict');
const { events, upcoming, format } = require('../public/schedule');
const now = Date.parse('2026-11-03T12:00:00Z');
test('no event is invented and past or malformed dates are not displayed', () => {
  assert.deepEqual(events, []);
  const make = (title,start,end) => ({title,start,end});
  const list = [
    make('later','2026-11-04T22:00:00+09:00','2026-11-04T23:00:00+09:00'),
    make('past','2026-11-03T19:00:00+09:00','2026-11-03T20:00:00+09:00'),
    make('invalid','2026-11-04T21:00:00','2026-11-04T22:00:00'),
    make('current','2026-11-03T20:00:00+09:00','2026-11-03T22:00:00+09:00'),
    make('backwards','2026-11-04T23:00:00+09:00','2026-11-04T22:00:00+09:00'),
    make('invalid date','2026-02-30T21:00:00+09:00','2026-03-04T22:00:00+09:00'),
    make('invalid zone','2026-11-04T21:00:00+14:59','2026-11-04T22:00:00+14:59')
  ];
  assert.deepEqual(upcoming(list, now).map(x=>x.title), ['current','later']);
  assert.match(format(list[0]), /日本時間/);
  assert.deepEqual(upcoming(list, Date.parse(list[0].end)), []);
});

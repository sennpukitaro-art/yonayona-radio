const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { aggregate, comparisonCSV } = require('../scripts/metrics_report_ui');
const rows = fs.readFileSync(path.join(__dirname, 'fixtures/metrics-summary.csv'), 'utf8').trim().split('\n').slice(1).map(line => {
  const [date_jst, source, event, count] = line.split(',');
  return { date_jst, source, event, count: Number(count) };
});

test('report compares totals, days and sources without mixing conversation units', () => {
  const result = aggregate(rows);
  assert.deepEqual(result.total, { page_view: 16, matching_attempt: 10, matched_participant: 8, conversation_participant: 6 });
  assert.equal(result.conversations, 3);
  assert.deepEqual(result.daily.map(row => row.conversations), [1, 2]);
  assert.deepEqual(result.daily.map(row => [row.date, row.page_view, row.matching_attempt, row.matched_participant, row.conversation_participant]),
    [['2026-11-03', 10, 6, 4, 2], ['2026-11-04', 6, 4, 4, 4]]);
  assert.deepEqual(result.sources.map(row => [row.source, row.page_view, row.conversation_participant]), [['x', 9, 3], ['direct', 3, 2], ['hiromeba', 4, 1]]);
  assert.equal(result.sources.some(row => row.source === 'all'), false);
  assert.equal(result.detail.length, 6);
  // Mixed-source conversations are never divided by two to infer per-source rooms.
  assert.equal(result.sources.find(row => row.source === 'x').conversation_participant, 3);
});

test('date and source filters include boundaries and keep unobserved values at zero', () => {
  const result = aggregate(rows, { from: '2026-11-04', to: '2026-11-04', source: 'hiromeba' });
  assert.deepEqual(result.total, { page_view: 1, matching_attempt: 1, matched_participant: 0, conversation_participant: 0 });
  assert.equal(result.daily.length, 1);
  assert.equal(result.detail.length, 1);
  assert.equal(result.conversations, null);
  const direct = aggregate(rows, { from: '2026-11-04', source: 'direct' });
  assert.equal(direct.total.matched_participant, 2);
  assert.equal(direct.total.matching_attempt, 1); // Crossing dates can make ratios misleading.
});

test('empty and missing periods stay distinguishable from observed zero counts', () => {
  const result = aggregate(rows, { from: '2026-11-05' });
  assert.equal(result.hasData, false);
  assert.deepEqual(result.daily, []);
  assert.deepEqual(result.sources, []);
  assert.equal(aggregate([]).hasData, false);
  const sparse = aggregate([rows[0], { ...rows[0], date_jst: '2026-11-06' }]);
  assert.deepEqual(sparse.daily.map(row => row.date), ['2026-11-03', '2026-11-06']);
});

test('reversed ranges are rejected, and comparison CSV contains only filtered counts', () => {
  assert.throws(() => aggregate(rows, { from: '2026-11-04', to: '2026-11-03' }), /開始日/);
  const csv = comparisonCSV(aggregate(rows, { from: '2026-11-04', source: 'direct' }));
  assert.ok(csv.startsWith('\ufeff'));
  assert.equal(csv.split('\r\n')[0], '\ufeff"date_jst","source","page_view","matching_attempt","matched_participant","conversation_participant"');
  assert.equal(csv.split('\r\n')[1], '"2026-11-04","direct","1","1","2","2"');
  assert.equal(csv.split('\r\n').length, 3);
  assert.doesNotMatch(csv, /conversion|rate|unique/);
});

// A minimal DOM harness exercises the shipped UI without third-party packages.
// It verifies interactions and text; it does not simulate browser layout/CSS.
class Element {
  constructor(tag = 'div') {
    this.tagName = tag; this.children = []; this.dataset = {}; this.style = {};
    this.listeners = {}; this.attributes = {}; this._text = ''; this._value = null;
    this.hidden = false; this.disabled = false;
    this.classList = { toggle() {} };
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set value(value) { this._value = value; }
  get value() { return this._value === null ? (this.children[0]?.value || '') : this._value; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this._text = ''; this.children = [...children]; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(type, callback) { this.listeners[type] = callback; }
  change(value) { this.value = value; this.listeners.change(); }
  click() { if (!this.disabled) this.listeners.click?.(); }
  remove() {}
}

function loadUI(inputRows = rows) {
  const template = fs.readFileSync(path.join(__dirname, '../scripts/metrics_report.html'), 'utf8');
  const nodes = Object.fromEntries([...template.matchAll(/id="([a-z-]+)"/g)].map(match => [match[1], new Element()]));
  nodes['report-data'].textContent = JSON.stringify({ rows: inputRows, input_format: 'csv', sample: true });
  nodes.source.value = 'all';
  const document = { title: '集客レポート', body: new Element('body'),
    getElementById: id => nodes[id], createElement: tag => new Element(tag) };
  let downloaded;
  const context = { document, Blob, URL: { createObjectURL(blob) { downloaded = blob; return 'blob:local-test'; }, revokeObjectURL() {} }, setTimeout(callback) { callback(); } };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../scripts/metrics_report_ui.js'), 'utf8'), context);
  return { nodes, document, downloaded: () => downloaded,
    values: () => nodes.stats.children.map(child => child.children[1].textContent) };
}

test('shipped UI renders sample counts, source/date filters, chart changes and reset', () => {
  const ui = loadUI(), { nodes } = ui;
  assert.deepEqual(ui.values(), ['16', '10', '8', '6']);
  assert.equal(nodes['sample-badge'].hidden, false);
  assert.match(ui.document.title, /^サンプル/);
  assert.match(nodes.programs.textContent, /番組数 3 件/);
  assert.match(nodes['daily-table'].textContent, /会話成立（番組）/);
  nodes.source.change('direct');
  assert.deepEqual(ui.values(), ['3', '2', '2', '2']);
  assert.match(nodes.programs.textContent, /流入元別には配分できません/);
  assert.doesNotMatch(nodes['daily-table'].textContent, /会話成立（番組）/);
  nodes.from.change('2026-11-04');
  assert.deepEqual(ui.values(), ['1', '1', '2', '2']);
  nodes['chart-metric'].change('matched_participant');
  assert.equal(nodes.chart.children[0].children[2].textContent, '2');
  nodes.reset.click();
  assert.deepEqual(ui.values(), ['16', '10', '8', '6']);
});

test('shipped UI clears stale counts for invalid/empty ranges and disables downloads', () => {
  const ui = loadUI(), { nodes } = ui;
  nodes.from.change('2026-11-05');
  assert.match(nodes.status.textContent, /開始日が終了日より後/);
  assert.deepEqual(ui.values(), ['—', '—', '—', '—']);
  assert.equal(nodes.export.disabled, true);
  nodes.to.change('2026-11-06');
  assert.match(nodes.status.textContent, /利用者0人を意味しません/);
  assert.equal(nodes.export.disabled, true);
  const empty = loadUI([]);
  assert.deepEqual(empty.values(), ['—', '—', '—', '—']);
  assert.match(empty.nodes['source-table'].textContent, /対象の記録がありません/);
});

test('shipped UI exports the currently selected sample counts as a local CSV', async () => {
  const ui = loadUI();
  ui.nodes.source.change('hiromeba');
  ui.nodes.from.change('2026-11-04');
  ui.nodes.export.click();
  assert.equal(ui.document.body.children[0].download, 'sample-metrics-comparison.csv');
  const csv = await ui.downloaded().text();
  assert.match(csv, /"2026-11-04","hiromeba","1","1","0","0"/);
  assert.doesNotMatch(csv, /"x"|"direct"|2026-11-03/);
});

/* Shared by the self-contained report and Node's built-in test runner. */
(function (root) {
  'use strict';
  const metrics = [
    { key: 'page_view', label: 'ページ表示', unit: 'GET要求ごと / 件' },
    { key: 'matching_attempt', label: 'マッチング開始', unit: '開始・やり直しごと / 件' },
    { key: 'matched_participant', label: 'マッチング成立', unit: '参加接続ごと / 件' },
    { key: 'conversation_participant', label: '会話成立', unit: '参加接続ごと / 件' }
  ];
  const empty = () => Object.fromEntries(metrics.map(metric => [metric.key, 0]));
  const add = (target, row) => { if (Object.hasOwn(target, row.event)) target[row.event] += row.count; };
  const labels = { x: 'X', hiromeba: 'ヒロメバ', tsukutta: 'ツクッタ', direct: '直接・参照元なし',
    share: '共有リンク', internal: '自サイト内', other: 'その他', appvillage: 'AppVILLAGE',
    viibo: 'viibo', freesoft100: 'フリーソフト100', tsukurulog: 'ツクルログ' };
  const sourceLabel = key => labels[key] || key;

  function aggregate(rows, { from = '', to = '', source = 'all' } = {}) {
    if (from && to && from > to) throw new Error('開始日が終了日より後です。日付を確認してください。');
    const dated = rows.filter(row => (!from || row.date_jst >= from) && (!to || row.date_jst <= to));
    const selected = dated.filter(row => source === 'all' || row.source === source);
    const total = empty(), days = new Map(), sources = new Map(), pairs = new Map();
    for (const row of selected) {
      if (!days.has(row.date_jst)) days.set(row.date_jst, { date: row.date_jst, conversations: 0, ...empty() });
      add(total, row); add(days.get(row.date_jst), row);
      if (row.event === 'conversation') days.get(row.date_jst).conversations += row.count;
      if (row.source === 'all') continue;
      if (!sources.has(row.source)) sources.set(row.source, { source: row.source, ...empty() });
      const pair = row.date_jst + '/' + row.source;
      if (!pairs.has(pair)) pairs.set(pair, { date: row.date_jst, source: row.source, ...empty() });
      add(sources.get(row.source), row); add(pairs.get(pair), row);
    }
    const bySource = [...sources.values()].sort((a, b) => b.conversation_participant - a.conversation_participant ||
      b.matched_participant - a.matched_participant || b.page_view - a.page_view || a.source.localeCompare(b.source));
    return { total, daily: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)), sources: bySource,
      detail: [...pairs.values()].sort((a, b) => a.date.localeCompare(b.date) || a.source.localeCompare(b.source)),
      conversations: source === 'all' ? dated.filter(row => row.event === 'conversation').reduce((sum, row) => sum + row.count, 0) : null,
      hasData: selected.length > 0 };
  }

  function comparisonCSV(result) {
    const fields = ['date_jst', 'source', ...metrics.map(metric => metric.key)];
    const quote = value => '"' + String(value).replace(/"/g, '""') + '"';
    return '\ufeff' + [fields, ...result.detail.map(row => [row.date, row.source, ...metrics.map(metric => row[metric.key])])]
      .map(row => row.map(quote).join(',')).join('\r\n') + '\r\n';
  }

  const api = { metrics, aggregate, comparisonCSV, sourceLabel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (!root.document) return;
  const document = root.document;
  const byId = id => document.getElementById(id);
  const data = JSON.parse(byId('report-data').textContent);
  const number = value => value.toLocaleString('ja-JP');
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function table(target, rows, firstLabel, keyLabel, columns = metrics) {
    const host = byId(target); host.replaceChildren();
    if (!rows.length) { host.append(element('p', '対象の記録がありません。利用がなかったとは判断できません。', 'empty')); return; }
    const node = element('table', undefined, 'responsive');
    node.setAttribute('aria-label', firstLabel + 'のイベント件数');
    const head = element('thead'), heading = element('tr');
    for (const label of [firstLabel, ...columns.map(metric => metric.label)]) {
      const cell = element('th', label); cell.scope = 'col'; heading.append(cell);
    }
    head.append(heading); node.append(head);
    const body = element('tbody');
    for (const row of rows) {
      const line = element('tr'), label = element('th', keyLabel(row)); label.scope = 'row'; line.append(label);
      for (const metric of columns) {
        const cell = element('td', number(row[metric.key]) + ' 件'); cell.dataset.label = metric.label; line.append(cell);
      }
      body.append(line);
    }
    node.append(body); host.append(node);
  }
  const dates = [...new Set(data.rows.map(row => row.date_jst))].sort();
  const initialFrom = dates[0] || '', initialTo = dates.at(-1) || '';
  byId('from').value = initialFrom; byId('to').value = initialTo;
  for (const key of [...new Set(data.rows.map(row => row.source))].filter(key => key !== 'all').sort()) {
    const option = element('option', sourceLabel(key)); option.value = key; byId('source').append(option);
  }
  for (const metric of metrics) { const option = element('option', metric.label); option.value = metric.key; byId('chart-metric').append(option); }
  byId('sample-badge').hidden = !data.sample;
  if (data.sample) document.title = 'サンプル | ' + document.title;
  byId('input-note').textContent = ' 入力形式：' + (data.input_format === 'csv' ? '集計CSV。' : '書き出したログ。');
  let current;
  function update() {
    const from = byId('from').value, to = byId('to').value, source = byId('source').value;
    const status = byId('status');
    const invalid = from && to && from > to;
    status.classList.toggle('error', !!invalid);
    byId('export').disabled = !!invalid;
    current = invalid ? aggregate([]) : aggregate(data.rows, { from, to, source });
    byId('export').disabled = !!invalid || !current.detail.length;
    status.textContent = invalid ? '開始日が終了日より後です。日付を確認してください。' : (data.sample ? 'サンプル / ' : '') + (from || '開始指定なし') + ' 〜 ' + (to || '終了指定なし') +
      ' / ' + (source === 'all' ? 'すべての流入元' : sourceLabel(source)) + ' / 記録のある日：' + current.daily.length + '日';
    if (!invalid && !current.hasData) status.textContent += '。対象イベントの記録がありません。利用者0人を意味しません。';
    const stats = byId('stats'); stats.replaceChildren();
    for (const metric of metrics) {
      const card = element('article', undefined, 'stat'); card.dataset.metric = metric.key;
      card.append(element('h2', metric.label), element('p', current.hasData ? number(current.total[metric.key]) : '—', 'value'), element('p', metric.unit, 'unit')); stats.append(card);
    }
    byId('programs').textContent = source !== 'all' ? '会話成立の番組数：流入元別には配分できません。全流入元で確認できます。' :
      current.hasData ? '補足：会話成立の番組数 ' + number(current.conversations) + ' 件（全流入元・1番組1件の記録）' : '会話成立の番組数：対象の記録がありません。';
    table('source-table', current.sources, '流入元', row => sourceLabel(row.source));
    const dailyColumns = source === 'all' ? [...metrics, { key: 'conversations', label: '会話成立（番組）' }] : metrics;
    table('daily-table', current.daily, '日付（JST）', row => row.date, dailyColumns);
    table('day-source-table', current.detail, '日付 / 流入元', row => row.date + ' / ' + sourceLabel(row.source));
    const chart = byId('chart'); chart.replaceChildren();
    const key = byId('chart-metric').value;
    const maximum = current.daily.reduce((max, row) => Math.max(max, row[key]), 0);
    if (!current.daily.length) chart.append(element('p', '対象の記録がありません。', 'empty'));
    for (const row of current.daily) {
      const line = element('div', undefined, 'bar-row'), track = element('div', undefined, 'track'), bar = element('div', undefined, 'bar');
      bar.style.width = (maximum ? row[key] / maximum * 100 : 0) + '%';
      track.setAttribute('aria-hidden', 'true'); track.append(bar);
      line.append(element('span', row.date), track, element('span', number(row[key]), 'count')); chart.append(line);
    }
  }
  for (const id of ['from', 'to', 'source', 'chart-metric']) byId(id).addEventListener('change', update);
  byId('reset').addEventListener('click', () => { byId('from').value = initialFrom; byId('to').value = initialTo; byId('source').value = 'all'; update(); });
  byId('export').addEventListener('click', () => {
    if (!current || byId('export').disabled) return;
    const url = URL.createObjectURL(new Blob([comparisonCSV(current)], { type: 'text/csv;charset=utf-8' }));
    const link = element('a'); link.href = url; link.download = (data.sample ? 'sample-' : '') + 'metrics-comparison.csv';
    document.body.append(link); link.click(); link.remove(); root.setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  update();
})(typeof window === 'undefined' ? globalThis : window);

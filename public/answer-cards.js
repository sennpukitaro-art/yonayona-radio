(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RadioAnswerCards = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MAX_LENGTH = 120;
  const APP_URL = 'https://yonayona-radio.onrender.com/';
  const FONT = '"Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif';
  const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('ja', { granularity: 'grapheme' }) : null;

  function characters(value, maximum = Infinity) {
    const result = [];
    const source = String(value || '');
    for (const item of segmenter ? segmenter.segment(source) : source) {
      if (result.length >= maximum) break;
      result.push(segmenter ? item.segment : item);
    }
    return result;
  }
  function limitAnswer(value) { return characters(value, MAX_LENGTH).join(''); }
  function cleanAnswer(value) { return limitAnswer(value).replace(/\s+/gu, ' ').trim(); }
  function resolveTopic(search, topics) {
    const id = new URLSearchParams(search || '').get('topic');
    return topics.find(topic => topic.id === id) || null;
  }
  function shareUrl(id) {
    if (!/^[a-z][a-z0-9-]{0,39}$/.test(id)) throw new Error('Invalid topic');
    const url = new URL(APP_URL);
    url.searchParams.set('topic', id);
    url.searchParams.set('utm_source', 'share');
    url.hash = 'answerCard';
    return url.href;
  }
  function tweetUrl(topic) {
    const url = new URL('https://twitter.com/intent/tweet');
    url.searchParams.set('text', '「' + topic.topic + '」あなたなら？\nもじもじラジオで、ひとこと答えてみました。');
    url.searchParams.set('url', shareUrl(topic.id));
    return url.href;
  }
  function wrapText(value, measure, maximumWidth) {
    const lines = [];
    let line = '';
    for (const character of characters(value)) {
      if (line && measure(line + character) > maximumWidth) {
        // Keep closing punctuation with the preceding character in Japanese text.
        if (/^[、。，．！？!?）」』】〕〉》]+$/u.test(character)) {
          const parts = characters(line);
          const carry = parts.pop();
          if (parts.length) lines.push(parts.join('').trimEnd());
          line = carry + character;
        } else {
          lines.push(line.trimEnd());
          line = character.trimStart();
        }
      } else line += character;
    }
    if (line.trim()) lines.push(line.trimEnd());
    return lines;
  }
  function fitText(context, value, width, height, largest, smallest, weight) {
    for (let size = largest; size >= smallest; size -= 2) {
      context.font = weight + ' ' + size + 'px ' + FONT;
      const lines = wrapText(value, text => context.measureText(text).width, width);
      const lineHeight = Math.ceil(size * 1.45);
      if (lines.length * lineHeight <= height) return { lines, size, lineHeight, height: lines.length * lineHeight };
    }
    throw new Error('Text does not fit');
  }
  function roundBox(context, x, y, width, height, radius) {
    context.beginPath();
    context.moveTo(x + radius, y);
    context.arcTo(x + width, y, x + width, y + height, radius);
    context.arcTo(x + width, y + height, x, y + height, radius);
    context.arcTo(x, y + height, x, y, radius);
    context.arcTo(x, y, x + width, y, radius);
    context.closePath();
  }
  function drawCard(canvas, topic, value) {
    const answer = cleanAnswer(value);
    if (!answer) throw new Error('Empty answer');
    canvas.width = 1080;
    canvas.height = 1080;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable');
    context.textBaseline = 'top';
    context.fillStyle = '#100f1b';
    context.fillRect(0, 0, 1080, 1080);
    context.fillStyle = '#241c37';
    context.beginPath(); context.arc(1040, 40, 300, 0, Math.PI * 2); context.fill();
    context.fillStyle = '#201a30';
    context.beginPath(); context.arc(40, 1080, 260, 0, Math.PI * 2); context.fill();
    context.fillStyle = '#f5f2ff';
    context.font = '700 34px ' + FONT;
    context.fillText('もじもじラジオ', 80, 70);
    context.textAlign = 'right';
    context.fillStyle = '#cbb8ff';
    context.font = '500 22px ' + FONT;
    context.fillText('お題にひとこと', 1000, 80);
    context.textAlign = 'left';
    context.fillStyle = '#b9accf';
    context.font = '500 22px ' + FONT;
    context.fillText('QUESTION', 80, 155);
    const question = fitText(context, topic.topic, 920, 142, 48, 30, '700');
    context.fillStyle = '#f5f2ff';
    question.lines.forEach((line, index) => context.fillText(line, 80, 199 + index * question.lineHeight));
    roundBox(context, 72, 366, 936, 444, 28);
    context.fillStyle = '#302443'; context.fill();
    context.strokeStyle = '#76608f'; context.lineWidth = 2; context.stroke();
    context.fillStyle = '#ceb8f6'; context.font = '500 24px ' + FONT;
    context.fillText('わたしの回答', 116, 403);
    const layout = fitText(context, answer, 848, 302, 86, 28, '700');
    context.fillStyle = '#ffffff';
    const answerTop = 462 + (302 - layout.height) / 2;
    layout.lines.forEach((line, index) => context.fillText(line, 116, answerTop + index * layout.lineHeight));
    context.fillStyle = '#eadfff'; context.font = '700 40px ' + FONT;
    context.fillText('あなたなら、どう答える？', 80, 867);
    context.fillStyle = '#c3b7d5'; context.font = '500 25px ' + FONT;
    context.fillText('声を出さずに、ふたりで雑談。', 80, 934);
    context.fillStyle = '#a394bb'; context.font = '500 24px ' + FONT;
    context.fillText('yonayona-radio.onrender.com', 80, 1000);
    return { answer, layout, question };
  }
  function imageBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => blob && blob.size ? resolve(blob) : reject(new Error('PNG unavailable')), 'image/png');
    });
  }
  function init(options = {}) {
    const doc = options.document || document;
    const nav = options.navigator || (typeof navigator !== 'undefined' ? navigator : {});
    const urlApi = options.urlApi || URL;
    const FileType = options.File || (typeof File === 'function' ? File : null);
    const get = id => doc.getElementById(id);
    const input = get('answerInput'), create = get('answerCreate'), status = get('answerStatus');
    const output = get('answerOutput'), preview = get('answerPreview'), save = get('answerSave'), share = get('answerShare');
    const drafts = new Map();
    let topic = null, card = null, version = 0, composing = false;
    function invalidate() {
      version++;
      if (card) urlApi.revokeObjectURL(card.objectUrl);
      card = null;
      output.classList.toggle('hidden', true);
      preview.removeAttribute('src');
      save.removeAttribute('href');
      share.disabled = true;
      create.disabled = !cleanAnswer(input.value);
    }
    function changed() {
      if (composing) return;
      input.value = limitAnswer(input.value);
      drafts.set(topic.id, input.value);
      get('answerCount').textContent = characters(input.value).length + ' / ' + MAX_LENGTH;
      invalidate();
      status.textContent = '';
    }
    function setTopic(next) {
      if (topic) drafts.set(topic.id, input.value);
      topic = next;
      input.value = drafts.get(next.id) || '';
      get('answerCount').textContent = characters(input.value).length + ' / ' + MAX_LENGTH;
      invalidate();
      status.textContent = '';
    }
    input.oninput = changed;
    input.oncompositionstart = () => { composing = true; invalidate(); create.disabled = true; status.textContent = ''; };
    input.oncompositionend = () => { composing = false; changed(); };
    create.onclick = async () => {
      const answer = cleanAnswer(input.value);
      if (!answer || composing) return;
      invalidate();
      const job = version, selected = topic;
      create.disabled = true;
      status.textContent = '画像を作っています…';
      try {
        if (doc.fonts && doc.fonts.ready) await doc.fonts.ready;
        const canvas = doc.createElement('canvas');
        drawCard(canvas, selected, answer);
        const blob = await imageBlob(canvas);
        if (version !== job) return;
        const filename = 'mojimoji-answer-' + selected.id + '.png';
        const file = FileType ? new FileType([blob], filename, { type: 'image/png' }) : null;
        const objectUrl = urlApi.createObjectURL(blob);
        const data = file ? { files: [file], title: 'もじもじラジオ｜お題にひとこと', text: '「' + selected.topic + '」あなたなら？', url: shareUrl(selected.id) } : null;
        card = { objectUrl, data, url: shareUrl(selected.id) };
        preview.src = objectUrl;
        preview.alt = 'お題「' + selected.topic + '」への自分の回答：' + answer;
        save.href = objectUrl;
        save.download = filename;
        get('answerLink').value = card.url;
        get('answerTweet').href = tweetUrl(selected);
        let canShare = false;
        try { canShare = !!(data && nav.share && nav.canShare && nav.canShare(data)); } catch (error) {}
        share.classList.toggle('hidden', !canShare);
        share.disabled = !canShare;
        output.classList.toggle('hidden', false);
        status.textContent = 'カードができました。画像を保存・共有できます。';
      } catch (error) {
        if (version === job) status.textContent = '画像を作れませんでした。回答はそのまま残っています。もう一度お試しください。';
      } finally {
        if (version === job) create.disabled = !cleanAnswer(input.value);
      }
    };
    share.onclick = async () => {
      const current = card;
      if (!current || !current.data || !nav.share) return;
      share.disabled = true;
      try {
        await nav.share(current.data);
        if (card === current) status.textContent = '共有画面を開きました。投稿の完了は共有先で確認してください。';
      } catch (error) {
        if (card === current) status.textContent = error.name === 'AbortError' ? '共有をキャンセルしました。カードはこの画面に残っています。' : 'この端末では画像を共有できませんでした。画像を保存してご利用ください。';
      } finally { if (card === current) share.disabled = false; }
    };
    get('answerCopy').onclick = async () => {
      const current = card;
      if (!current) return;
      try {
        if (!nav.clipboard || !nav.clipboard.writeText) throw new Error('Clipboard unavailable');
        await nav.clipboard.writeText(current.url);
        if (card === current) status.textContent = '同じお題のリンクをコピーしました。';
      } catch (error) {
        if (card === current) status.textContent = '下のリンク欄を長押し、または選択してコピーできます。';
      }
    };
    get('answerEntry').onclick = () => { get('demo').open = true; };
    get('answerCard').classList.toggle('hidden', false);
    get('soloEntry').classList.toggle('hidden', false);
    return { setTopic };
  }
  return { MAX_LENGTH, characters, limitAnswer, cleanAnswer, resolveTopic, shareUrl, tweetUrl, wrapText, fitText, drawCard, init };
});

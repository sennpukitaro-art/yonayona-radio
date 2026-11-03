const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const RadioTraffic = require('../public/traffic');

function bootstrap(overrides = {}) {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const elements = new Map();
  function element() {
    const classes = new Set();
    return {
      textContent: '', value: '', children: [], scrollHeight: 0,
      classList: {
        toggle(name, on) { if (on) classes.add(name); else classes.delete(name); },
        contains(name) { return classes.has(name); }
      },
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; }
    };
  }
  for (const match of html.matchAll(/id="([^"]+)"/g)) elements.set(match[1], element());
  for (const id of ['waiting', 'live', 'finished']) elements.get(id).classList.toggle('hidden', true);
  elements.get('name').value = 'テストMC';
  const sockets = [], timers = [];
  class FakeSocket {
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); }
    send(data) { this.sent.push(JSON.parse(data)); }
    message(data) { this.onmessage({ data: JSON.stringify(data) }); }
    open() { this.readyState = 1; this.onopen(); this.message({ type: 'identity', id: 'self' }); }
  }
  vm.runInNewContext(script, {
    document: { getElementById: id => elements.get(id), createElement: element },
    location: { protocol: 'https:', host: 'radio.example' },
    WebSocket: FakeSocket, confirm: () => true, RadioTraffic,
    setTimeout: (fn, delay) => timers.push({ fn, delay }),
    setInterval: () => 1, Date, console, ...overrides
  }, { filename: 'public/index.html script' });
  return { elements, sockets, timers };
}

test('home controls initialize, send matching requests, and recover after a waiting disconnect', () => {
  const { elements: el, sockets, timers } = bootstrap();
  assert.equal(sockets[0].url, 'wss://radio.example/?utm_source=direct');
  sockets[0].open();
  assert.equal(el.get('status').textContent, 'オンライン');
  el.get('start').onclick();
  assert.equal(sockets[0].sent.at(-1).type, 'queue');
  sockets[0].message({ type: 'waiting' });
  assert.equal(el.get('waiting').classList.contains('hidden'), false);
  sockets[0].readyState = 3;
  sockets[0].onclose();
  assert.equal(el.get('home').classList.contains('hidden'), false);
  assert.equal(el.get('waiting').classList.contains('hidden'), true);
  assert.match(el.get('toast').textContent, /マッチングを解除/);
  timers.find(timer => timer.delay === 2500).fn();
  sockets[1].open();
  assert.deepEqual(sockets[1].sent.map(message => message.type), ['name', 'list']);
});

test('joined screen shows messages as text and Japanese IME confirmation does not submit', () => {
  const { elements: el, sockets } = bootstrap();
  const socket = sockets[0];
  socket.open();
  socket.message({ type: 'joined', role: 'mc', room: {
    id: 'room', topic: 'テストのお題', started: Date.now(), listeners: 1,
    mcs: [{ name: 'A' }, { name: 'B' }], history: []
  } });
  assert.equal(el.get('live').classList.contains('hidden'), false);
  assert.equal(el.get('topic').textContent, 'テストのお題');
  socket.message({ type: 'chat', item: {
    role: 'listener', name: 'リスナー', text: '<img src=x onerror=alert(1)>'
  } });
  assert.equal(el.get('messages').children[0].children[1].textContent, '<img src=x onerror=alert(1)>');
  el.get('chatInput').value = 'こんばんは';
  const before = socket.sent.length;
  el.get('chatInput').onkeydown({ key: 'Enter', isComposing: true });
  assert.equal(socket.sent.length, before);
  el.get('chatInput').onkeydown({ key: 'Enter', isComposing: false });
  assert.equal(socket.sent.at(-1).type, 'chat');
  assert.equal(socket.sent.at(-1).text, 'こんばんは');
});

test('conversation examples stay separate from live matching and sharing reports actual copy results', async () => {
  let copied;
  const { elements: el, sockets } = bootstrap({ navigator: {
    clipboard: { writeText: async value => { copied = value; } }
  } });
  sockets[0].open();
  const before = sockets[0].sent.length;
  el.get('demoNext').onclick();
  assert.equal(el.get('demoMessages').children.length, 3);
  assert.match(el.get('demoMessages').children[0].children[0].textContent, /架空/);
  assert.equal(sockets[0].sent.length, before);
  assert.equal(el.get('live').classList.contains('hidden'), true);
  await el.get('shareHome').onclick();
  assert.equal(copied, 'https://yonayona-radio.onrender.com/?utm_source=share');
  assert.match(el.get('shareStatusHome').textContent, /コピーしました/);
  const fallback = bootstrap({ navigator: {
    clipboard: { writeText: async () => { throw new Error('Permission denied'); } }
  } }).elements;
  await fallback.get('shareWaiting').onclick();
  assert.equal(fallback.get('shareFallbackWaiting').classList.contains('hidden'), false);
  assert.doesNotMatch(fallback.get('shareStatusWaiting').textContent, /コピーしました/);
});

test('trial gathering notice disappears at the announced Japan-time end', () => {
  class TrialDate extends Date { static now() { return Date.parse('2026-11-03T21:29:59+09:00'); } }
  class AfterDate extends Date { static now() { return Date.parse('2026-11-03T21:30:00+09:00'); } }
  assert.equal(bootstrap({ Date: TrialDate }).elements.get('trialTimes').classList.contains('hidden'), false);
  assert.equal(bootstrap({ Date: AfterDate }).elements.get('trialTimes').classList.contains('hidden'), true);
});

test('waiting counts use server snapshots and become unknown on disconnect or old snapshots', () => {
  const { elements: el, sockets } = bootstrap();
  const socket = sockets[0];
  assert.equal(el.get('queueStatus').textContent, '待機人数を確認中…');
  socket.open();
  socket.message({type:'rooms',rooms:[],waitingCount:0});
  assert.equal(el.get('queueStatus').textContent, 'マッチング待機中 0人');
  socket.message({type:'waiting'});
  socket.message({type:'rooms',rooms:[],waitingCount:1});
  assert.equal(el.get('waitingCount').textContent, 'マッチング待機中 1人（自分を含む）');
  socket.message({type:'rooms',rooms:[]});
  assert.equal(el.get('queueStatus').textContent, '待機人数を確認中…');
  socket.message({type:'rooms',rooms:[],waitingCount:2});
  socket.onclose();
  assert.equal(el.get('queueStatus').textContent, '待機人数を確認中…');
});

test('only a classified source is sent to WebSocket, without private query parameters', () => {
  const {sockets}=bootstrap({location:{protocol:'https:',host:'radio.example',search:'?utm_source=x&email=private@example.test'}});
  assert.equal(sockets[0].url,'wss://radio.example/?utm_source=x');
});

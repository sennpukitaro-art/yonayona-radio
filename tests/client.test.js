const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const RadioTraffic = require('../public/traffic');
const RadioSchedule = require('../public/schedule');

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
  for (const id of ['waiting', 'inviteWaiting', 'live', 'finished', 'inviteOffer']) elements.get(id).classList.toggle('hidden', true);
  elements.get('name').value = 'テストMC';
  const sockets = [], timers = [], intervals = [];
  class FakeSocket {
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); }
    send(data) { this.sent.push(JSON.parse(data)); }
    message(data) { this.onmessage({ data: JSON.stringify(data) }); }
    open() { this.readyState = 1; this.onopen(); this.message({ type: 'identity', id: 'self' }); }
  }
  vm.runInNewContext(script, {
    document: { getElementById: id => elements.get(id), createElement: element },
    location: { protocol: 'https:', host: 'radio.example' },
    WebSocket: FakeSocket, confirm: () => true, RadioTraffic, RadioSchedule,
    setTimeout: (fn, delay) => timers.push({ fn, delay }),
    setInterval: (fn, delay) => { intervals.push({ fn, delay }); return intervals.length; }, Date, URL, URLSearchParams, console, ...overrides
  }, { filename: 'public/index.html script' });
  return { elements, sockets, timers, intervals };
}

test('home controls initialize, send matching requests, and recover after a waiting disconnect', () => {
  const { elements: el, sockets, timers } = bootstrap();
  assert.equal(sockets[0].url, 'wss://radio.example/?utm_source=direct');
  sockets[0].open();
  assert.equal(el.get('status').textContent, 'オンライン');
  el.get('name').value = '設定を押さずに参加';
  el.get('start').onclick();
  assert.deepEqual(sockets[0].sent.slice(-2).map(message => message.type), ['name', 'queue']);
  assert.equal(sockets[0].sent.at(-2).name, '設定を押さずに参加');
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

test('page elements have unique IDs so controls and gathering notes cannot be duplicated', () => {
  const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
  const ids=[...html.matchAll(/id="([^"]+)"/g)].map(match=>match[1]);
  assert.equal(ids.length,new Set(ids).size,'Each element ID must appear only once');
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


test('gathering notes stay hidden without plans and show the same configured time safely on both screens', () => {
  const empty=bootstrap().elements;
  for(const id of ['scheduleHome','scheduleWaiting'])assert.equal(empty.get(id).classList.contains('hidden'),true);
  const schedule = {...RadioSchedule, events:[{title:'<img src=x>',start:'2099-01-01T21:00:00+09:00',end:'2099-01-01T21:30:00+09:00'}]};
  const {elements:el,sockets}=bootstrap({RadioSchedule:schedule});
  for(const [panel,listId] of [['scheduleHome','scheduleList'],['scheduleWaiting','scheduleListWaiting']]){
    assert.equal(el.get(panel).classList.contains('hidden'),false);
    const list=el.get(listId);
    assert.equal(list.children[0].children[0].textContent,'<img src=x>');
    assert.match(list.children[0].children[2].textContent,/日本時間/);
    assert.equal(list.children[0].children[2].dateTime,schedule.events[0].start);
  }
  assert.equal(el.get('scheduleList').children[0].children[2].textContent,el.get('scheduleListWaiting').children[0].children[2].textContent);
  assert.equal(el.get('scheduleHeading').textContent,'次の集合時間');
  sockets[0].open();sockets[0].message({type:'waiting'});
  assert.equal(el.get('home').classList.contains('hidden'),true);
  assert.equal(el.get('waiting').classList.contains('hidden'),false);
  assert.equal(el.get('scheduleWaiting').classList.contains('hidden'),false);
});

test('gathering notes become current, advance, and disappear after the final end without reloading', () => {
  let now=Date.parse('2026-11-06T21:59:59+09:00');
  class Clock extends Date {static now(){return now;}}
  const events=[
    {title:'先の予定',start:'2026-11-07T22:00:00+09:00',end:'2026-11-07T22:15:00+09:00'},
    {title:'最初の予定',start:'2026-11-06T22:00:00+09:00',end:'2026-11-06T22:15:00+09:00'}
  ];
  const {elements:el,intervals}=bootstrap({Date:Clock,RadioSchedule:{...RadioSchedule,events}});
  const refresh=intervals.find(timer=>timer.delay===60000).fn;
  assert.equal(el.get('scheduleList').children[0].children[0].textContent,'最初の予定');
  now=Date.parse(events[1].start);refresh();
  assert.equal(el.get('scheduleHeading').textContent,'ただいまの集合時間');
  assert.equal(el.get('scheduleHeadingWaiting').textContent,'ただいまの集合時間');
  now=Date.parse(events[1].end);refresh();
  assert.equal(el.get('scheduleList').children[0].children[0].textContent,'先の予定');
  assert.equal(el.get('scheduleListWaiting').children[0].children[0].textContent,'先の予定');
  assert.equal(el.get('scheduleHeading').textContent,'次の集合時間');
  now=Date.parse(events[0].end);refresh();
  for(const id of ['scheduleHome','scheduleWaiting'])assert.equal(el.get(id).classList.contains('hidden'),true);
  for(const id of ['scheduleList','scheduleListWaiting'])assert.equal(el.get(id).children.length,0);
});

test('missing schedule code and malformed or ended plans do not invent a gathering', () => {
  const cases=[undefined,{...RadioSchedule,events:[
    {title:'不正な日時',start:'not-a-date',end:'not-a-date'},
    {title:'終了済み',start:'2020-01-01T22:00:00+09:00',end:'2020-01-01T22:15:00+09:00'}
  ]}];
  for(const schedule of cases){
    const {elements:el,sockets}=bootstrap({RadioSchedule:schedule});
    for(const id of ['scheduleHome','scheduleWaiting'])assert.equal(el.get(id).classList.contains('hidden'),true);
    sockets[0].open();el.get('start').onclick();
    assert.equal(sockets[0].sent.at(-1).type,'queue');
  }
});

test('host creates a dedicated invite, copies that link, and loses it on disconnect',async()=>{
  let copied;
  const {elements:el,sockets}=bootstrap({navigator:{clipboard:{writeText:async value=>{copied=value}}}});
  const socket=sockets[0];socket.open();
  el.get('name').value='招待した人';
  el.get('createInvite').onclick();
  assert.deepEqual(socket.sent.slice(-2).map(m=>m.type),['name','invite_create']);
  assert.equal(socket.sent.at(-2).name,'招待した人');
  const token='A'.repeat(24);
  socket.message({type:'invite_created',token,expiresAt:Date.now()+60000});
  assert.equal(el.get('inviteWaiting').classList.contains('hidden'),false);
  assert.equal(el.get('inviteCreateStatus').textContent,'');
  assert.equal(el.get('waiting').classList.contains('hidden'),true);
  await el.get('copyInvite').onclick();
  assert.equal(copied,'https://radio.example/?invite='+token+'&utm_source=share');
  assert.match(el.get('inviteShareStatus').textContent,/コピーしました/);
  socket.readyState=3;socket.onclose();
  assert.equal(el.get('inviteLink').value,'');
  assert.equal(el.get('inviteWaiting').classList.contains('hidden'),true);
  assert.equal(el.get('home').classList.contains('hidden'),false);
  assert.match(el.get('inviteCreateStatus').textContent,/無効/);
});

test('recipient checks but never auto-joins, then joins explicitly and clears consumed token',()=>{
  const token='B'.repeat(24);let replaced;
  const {elements:el,sockets}=bootstrap({
    location:{protocol:'https:',host:'radio.example',search:'?invite='+token+'&utm_source=share',href:'https://radio.example/?invite='+token+'&utm_source=share'},
    history:{replaceState:(_a,_b,url)=>{replaced=url}}
  });
  const socket=sockets[0];socket.open();
  assert.equal(socket.url,'wss://radio.example/?utm_source=share');
  assert.equal(socket.sent.at(-1).type,'invite_check');
  assert.equal(socket.sent.some(m=>m.type==='invite_join'),false);
  assert.equal(el.get('randomControls').classList.contains('hidden'),true);
  socket.message({type:'invite_ready',expiresAt:Date.now()+60000});
  assert.equal(el.get('joinInvite').disabled,false);
  el.get('name').value='招待された人';el.get('joinInvite').onclick();
  assert.equal(socket.sent.at(-1).type,'invite_join');
  assert.equal(socket.sent.at(-1).token,token);
  assert.equal(socket.sent.at(-2).name,'招待された人');
  socket.message({type:'joined',role:'mc',room:{id:'invite-room',mode:'invite',topic:'お題',started:Date.now(),mcs:[{name:'友達'},{name:'招待された人'}],listeners:0,history:[]}});
  assert.equal(replaced,'/?utm_source=share');
  assert.equal(el.get('live').classList.contains('hidden'),false);
  assert.match(el.get('inviteLiveNote').textContent,/公開番組/);
});

test('invalid and expired invites show a recoverable message without random matching',()=>{
  const invalid=bootstrap({location:{protocol:'https:',host:'radio.example',search:'?invite=broken'}});
  invalid.sockets[0].open();
  assert.equal(invalid.elements.get('joinInvite').disabled,true);
  assert.match(invalid.elements.get('inviteOfferStatus').textContent,/形式/);
  assert.equal(invalid.sockets[0].sent.some(m=>m.type==='invite_check'||m.type==='queue'),false);
  invalid.elements.get('clearInvite').onclick();
  assert.equal(invalid.elements.get('randomControls').classList.contains('hidden'),false);
  const valid=bootstrap({location:{protocol:'https:',host:'radio.example',search:'?invite='+'C'.repeat(24)}});
  valid.sockets[0].open();valid.sockets[0].message({type:'invite_error',message:'期限切れです'});
  assert.equal(valid.elements.get('joinInvite').disabled,true);
  assert.equal(valid.elements.get('inviteOfferStatus').textContent,'期限切れです');
});

test('invite copy failure never reports success and cancellation invalidates its UI',async()=>{
  const {elements:el,sockets}=bootstrap({navigator:{clipboard:{writeText:async()=>{throw Error('Denied')}}}});
  const socket=sockets[0];socket.open();el.get('createInvite').onclick();
  socket.message({type:'invite_created',token:'D'.repeat(24),expiresAt:Date.now()+60000});
  await el.get('copyInvite').onclick();
  assert.match(el.get('inviteShareStatus').textContent,/リンク欄/);
  assert.doesNotMatch(el.get('inviteShareStatus').textContent,/コピーしました/);
  el.get('cancelInvite').onclick();assert.equal(socket.sent.at(-1).type,'cancel');
  socket.message({type:'cancelled'});
  assert.equal(el.get('home').classList.contains('hidden'),false);
  assert.equal(el.get('inviteLink').value,'');
});


test('archive consent is optional, sent on explicit participation, reset per room, and cleared on reconnect',()=>{
  const {elements:el,sockets}=bootstrap(),ws=sockets[0];ws.open();
  assert.equal(el.get('archiveChoice').classList.contains('hidden'),false); // mock initial classes are empty
  ws.message({type:'identity',id:'self',archiveAvailable:false});
  assert.equal(el.get('archiveChoice').classList.contains('hidden'),true);
  el.get('archiveConsent').checked=true;el.get('start').onclick();
  assert.equal(ws.sent.at(-1).archiveConsent,false);
  ws.message({type:'identity',id:'self',archiveAvailable:true});
  assert.equal(el.get('archiveChoice').classList.contains('hidden'),false);
  el.get('start').onclick();assert.equal(ws.sent.at(-1).archiveConsent,true);
  ws.message({type:'joined',role:'mc',room:{id:'test',archiveRecording:true,topic:'お題',started:Date.now(),mcs:[{name:'A'},{name:'B'}],listeners:0,history:[]}});
  assert.match(el.get('archiveStatus').textContent,/保存中/);
  assert.equal(el.get('archiveConsent').checked,false);
  assert.equal(el.get('stopArchive').classList.contains('hidden'),false);
  el.get('stopArchive').onclick();assert.equal(ws.sent.at(-1).type,'archive_stop');
  ws.message({type:'archive_status',recording:false});
  assert.equal(el.get('stopArchive').classList.contains('hidden'),true);
  assert.match(el.get('toast').textContent,/保存済みの発言は削除されません/);
  el.get('archiveConsent').checked=true;ws.onclose();
  assert.equal(el.get('archiveConsent').checked,false);
  assert.equal(el.get('archiveChoice').classList.contains('hidden'),true);
});

test('listeners see recording status but cannot use the MC stop control',()=>{
 const {elements:el,sockets}=bootstrap(),ws=sockets[0];ws.open();
 ws.message({type:'joined',role:'listener',room:{id:'test',archiveRecording:true,topic:'お題',started:Date.now(),mcs:[{name:'A'},{name:'B'}],listeners:0,history:[]}});
 assert.match(el.get('archiveStatus').textContent,/リスナーコメントは保存対象外/);
 assert.equal(el.get('stopArchive').classList.contains('hidden'),true);
});

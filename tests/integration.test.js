const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const WebSocket = require('ws');

let child, base, startupOutput = '';
before(async () => {
  child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server startup timeout: ' + startupOutput)), 6000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => {
      clearTimeout(timer);
      reject(new Error('Server exited during startup (' + code + '): ' + startupOutput));
    });
    child.stderr.on('data', chunk => { startupOutput += chunk.toString(); });
    child.stdout.on('data', chunk => {
      startupOutput += chunk.toString();
      const match = startupOutput.match(/http:\/\/localhost:(\d+)/);
      if (match) { clearTimeout(timer); resolve('http://127.0.0.1:' + match[1]); }
    });
  });
});
after(async () => {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  await exited;
});

class Client {
  constructor(source='direct') {
    this.socket = new WebSocket(base.replace('http:', 'ws:')+'/?utm_source='+encodeURIComponent(source));
    this.inbox = [];
    this.waiters = [];
    this.socket.on('message', raw => { this.inbox.push(JSON.parse(raw)); this.pump(); });
    this.socket.on('error', () => {});
  }
  pump() {
    for (const waiter of [...this.waiters]) {
      const index = this.inbox.findIndex(message => message.type === waiter.type && waiter.predicate(message));
      if (index === -1) continue;
      this.waiters.splice(this.waiters.indexOf(waiter), 1);
      clearTimeout(waiter.timer);
      waiter.resolve(this.inbox.splice(index, 1)[0]);
    }
  }
  next(type, predicate = () => true) {
    return new Promise((resolve, reject) => {
      const waiter = { type, predicate, resolve };
      waiter.timer = setTimeout(() => {
        this.waiters = this.waiters.filter(item => item !== waiter);
        reject(new Error('Missing message: ' + type + '; received: ' + JSON.stringify(this.inbox)));
      }, 5000);
      this.waiters.push(waiter);
      this.pump();
    });
  }
  send(message) { this.socket.send(JSON.stringify(message)); }
  async name(name) {
    this.send({ type: 'name', name });
    await this.next('identity', message => message.name === name);
  }
}

test('shared preview assets and crawler files return usable content types', async () => {
  const image = await fetch(base + '/cover.png');
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.deepEqual([...new Uint8Array(await image.arrayBuffer()).slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const head = await fetch(base + '/icon.png', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-type'), 'image/png');
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  const sitemap = await fetch(base + '/sitemap.xml');
  assert.match(sitemap.headers.get('content-type'), /application\/xml/);
  assert.match(await sitemap.text(), /<loc>https:\/\/yonayona-radio\.onrender\.com\/<\/loc>/);
  const robots = await fetch(base + '/robots.txt');
  assert.match(await robots.text(), /Sitemap: https:\/\/yonayona-radio\.onrender\.com\/sitemap\.xml/);
});

test('two MCs match, listeners receive chat, and invalid data cannot stop the server', async t => {
  const health = await fetch(base + '/health');
  assert.equal(health.status, 200);
  assert.equal(await health.text(), 'ok');
  const page = await fetch(base + '/');
  assert.match(await page.text(), /もじもじラジオ/);

  const a = new Client(), b = new Client(), c = new Client();
  t.after(() => { for (const client of [a, b, c]) client.socket.terminate(); });
  await Promise.all([a.next('identity'), b.next('identity'), c.next('identity')]);
  await Promise.all([a.name('MC甲'), b.name('MC乙'), c.name('聴き手')]);

  a.send({ type: 'queue' });
  await a.next('waiting');
  a.send({ type: 'cancel' });
  await a.next('cancelled');
  b.send({ type: 'queue' });
  await b.next('waiting');
  a.send({ type: 'queue' });
  const [joinedA, joinedB] = await Promise.all([a.next('joined'), b.next('joined')]);
  assert.equal(joinedA.role, 'mc');
  assert.equal(joinedA.room.id, joinedB.room.id);
  assert.equal(joinedA.room.mcs.length, 2);
  assert.deepEqual(joinedA.room.mcs.map(mc => mc.name).sort(), ['MC乙', 'MC甲'].sort());
  const id = joinedA.room.id;

  c.send({ type: 'watch', id });
  assert.equal((await c.next('joined')).role, 'listener');
  await a.next('listeners', message => message.count === 1);
  a.send({ type: 'chat', text: 'こんばんは' });
  assert.equal((await b.next('chat')).item.text, 'こんばんは');
  assert.equal((await c.next('chat')).item.role, 'mc');
  c.send({ type: 'chat', text: '聞いています' });
  assert.equal((await a.next('chat', message => message.item.role === 'listener')).item.text, '聞いています');
  a.send({ type: 'chat', text: '連投' });
  assert.match((await a.next('error')).message, /連続投稿/);

  c.send({ type: 'topic' });
  c.send({ type: 'list' });
  const oldTopic = joinedA.room.topic;
  await c.next('rooms', message => message.rooms.some(room => room.id === id && room.topic === oldTopic));
  a.send({ type: 'topic' });
  const updated = await b.next('topic');
  assert.equal(typeof updated.topic, 'string');
  await c.next('topic', message => message.topic === updated.topic);
  b.send({ type: 'topic' });
  assert.match((await b.next('error')).message, /3秒/);

  for (const invalid of ['null', '42', '[]', '{broken']) c.socket.send(invalid);
  c.send({ type: 'name', name: { toString: null } });
  c.send({ type: 'chat', text: { toString: null } });
  c.send({ type: 'list' });
  await c.next('rooms', message => message.rooms.some(room => room.id === id));
  assert.equal((await fetch(base + '/health')).status, 200);

  c.send({ type: 'leave' });
  await c.next('left');
  await a.next('listeners', message => message.count === 0);
  c.send({ type: 'watch', id });
  const rejoined = await c.next('joined');
  assert.equal(rejoined.room.history.length, 2);

  a.socket.close();
  assert.match((await b.next('ended')).reason, /切断/);
  await c.next('ended');
  await b.next('rooms', message => message.rooms.length === 0);
  assert.equal((await fetch(base + '/health')).status, 200);
});

function metrics(){return startupOutput.split('\n').flatMap(line=>{try{const item=JSON.parse(line);return item.type==='radio_metric'?[item]:[]}catch{return []}})}
async function waitMetrics(predicate){
  const deadline=Date.now()+3000;
  while(Date.now()<deadline){const items=metrics();if(predicate(items))return items;await new Promise(resolve=>setTimeout(resolve,15))}
  throw new Error('Expected metric not observed');
}

test('only successful GET page requests are counted, and logs contain categories without private data',async()=>{
  const baseline=metrics().filter(x=>x.event==='page_view').length;
  await fetch(base+'/?utm_source=x&email=private@example.test',{headers:{referer:'https://hiromeba.com/secret?token=secret'}});
  await fetch(base+'/index.html?utm_source=hiromeba');
  await fetch(base+'/?utm_source=x',{method:'HEAD'});
  await fetch(base+'/health');
  await fetch(base+'/cover.png');
  await fetch(base+'/missing-page');
  const items=await waitMetrics(items=>items.filter(x=>x.event==='page_view').length>=baseline+2);
  const added=items.filter(x=>x.event==='page_view').slice(baseline);
  assert.deepEqual(added.map(x=>x.source),['x','hiromeba']);
  assert.doesNotMatch(JSON.stringify(items),/private@example|token|referer|secret/);
  for(const entry of added)assert.deepEqual(Object.keys(entry).sort(),['event','source','time','type']);
});

test('waiting count follows queue/cancel/leave/disconnect and a conversation requires both MCs',async t=>{
  const a=new Client('x'),b=new Client('hiromeba'),c=new Client('share');
  t.after(()=>{for(const client of[a,b,c])client.socket.terminate()});
  await Promise.all([a.next('identity'),b.next('identity'),c.next('identity')]);
  await Promise.all([a.name('非記録MC甲'),b.name('非記録MC乙')]);
  const snapshot=async expected=>{c.inbox=c.inbox.filter(m=>m.type!=='rooms');c.send({type:'list'});return c.next('rooms',m=>m.waitingCount===expected)};
  await snapshot(0);
  const before=metrics();
  const count=(items,event)=>items.filter(x=>x.event===event).length;
  a.send({type:'queue'});await a.next('waiting');await snapshot(1);
  a.send({type:'queue'});await a.next('waiting');await snapshot(1);
  a.send({type:'cancel'});await a.next('cancelled');await snapshot(0);
  a.send({type:'queue'});await a.next('waiting');await snapshot(1);
  a.send({type:'leave'});await a.next('left');await snapshot(0);
  a.send({type:'queue'});await a.next('waiting');await snapshot(1);
  a.send({type:'watch',id:'missing'});await a.next('error');await snapshot(0);
  a.send({type:'queue'});await a.next('waiting');await snapshot(1);
  b.send({type:'queue'});
  const joined=await a.next('joined');await b.next('joined');await snapshot(0);
  c.send({type:'watch',id:joined.room.id});await c.next('joined');
  a.send({type:'chat',text:'本文は記録しません甲'});await b.next('chat');
  c.send({type:'chat',text:'リスナーだけでは会話成立にならない'});await a.next('chat',m=>m.item.role==='listener');
  assert.equal(count(metrics(),'conversation'),count(before,'conversation'));
  b.send({type:'chat',text:'本文は記録しません乙'});await a.next('chat',m=>m.item.sender===joined.room.mcs.find(mc=>mc.id!==joined.self).id);
  const items=await waitMetrics(items=>count(items,'conversation')===count(before,'conversation')+1);
  assert.equal(count(items,'matching_attempt')-count(before,'matching_attempt'),5);
  assert.equal(count(items,'matched_participant')-count(before,'matched_participant'),2);
  assert.equal(count(items,'listener_join')-count(before,'listener_join'),1);
  assert.deepEqual(items.filter(x=>x.event==='conversation_participant').slice(-2).map(x=>x.source).sort(),['hiromeba','x']);
  assert.doesNotMatch(JSON.stringify(items),/非記録|本文は|リスナーだけ|sender|room|name/);
  a.socket.close();await b.next('ended');await c.next('ended');
  b.send({type:'queue'});await b.next('waiting');await snapshot(1);
  b.socket.close();await c.next('rooms',m=>m.waitingCount===0&&m.rooms.length===0);
});

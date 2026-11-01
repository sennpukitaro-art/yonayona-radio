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
  constructor() {
    this.socket = new WebSocket(base.replace('http:', 'ws:'));
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

test('two MCs match, listeners receive chat, and invalid data cannot stop the server', async t => {
  const health = await fetch(base + '/health');
  assert.equal(health.status, 200);
  assert.equal(await health.text(), 'ok');
  const page = await fetch(base + '/');
  assert.match(await page.text(), /よなよなラジオ/);

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

const test=require('node:test');
const assert=require('node:assert/strict');
const InviteLinks=require('../invite-links');

test('invite links reserve one slot, reject malformed values, and are consumed once',()=>{
  const links=new InviteLinks();
  const first=links.create('host-a'),second=links.create('host-b');
  assert.match(first.token,/^[A-Za-z0-9_-]{24}$/);
  assert.notEqual(first.token,second.token);
  assert.equal(links.create('host-a'),first);
  for(const invalid of [null,{},[],1,'',first.token+'x','<script>'])assert.equal(links.get(invalid),undefined);
  assert.equal(links.take(first.token),first);
  assert.equal(links.take(first.token),undefined);
  assert.equal(links.forHost('host-a'),undefined);
  assert.equal(links.get(second.token),second);
});

test('expiration boundary and host cancellation release capacity without reviving old links',()=>{
  let time=1000;
  const links=new InviteLinks({now:()=>time,ttlMs:100,limit:2});
  const a=links.create('a'),b=links.create('b');
  assert.equal(links.create('c'),undefined);
  time=1099;assert.equal(links.get(a.token),a);
  time=1100;assert.equal(links.get(a.token),undefined);
  assert.equal(links.take(a.token),undefined);
  assert.deepEqual(links.expire(),[a,b]);
  assert.equal(links.links.size,0);
  const fresh=links.create('a');
  assert.notEqual(fresh.token,a.token);
  assert.equal(links.cancel('a'),fresh);
  assert.equal(links.get(fresh.token),undefined);
  assert.equal(links.cancel('a'),undefined);
  assert.ok(links.create('c'));
});

const test=require('node:test');
const assert=require('node:assert/strict');
const traffic=require('../public/traffic');

test('traffic sources are limited to categories and explicit tags take priority',()=>{
  assert.equal(traffic.source('?utm_source=x','https://hiromeba.com/apps/example'),'x');
  assert.equal(traffic.source('?utm_source=X_COMMUNITY',''),'x');
  assert.equal(traffic.source('?utm_source=alice%40example.test',''),'other');
  assert.equal(traffic.source('','https://www.hiromeba.com/private/path?token=secret'),'hiromeba');
  assert.equal(traffic.source('','https://x.com.evil.test/'),'other');
  assert.equal(traffic.source('','not a URL'),'other');
  assert.equal(traffic.source('',''),'direct');
  assert.equal(traffic.source('?utm_source=','https://t.co/example'),'x');
});

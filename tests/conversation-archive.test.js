const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createArchive,parseKey,encrypt,decrypt}=require('../conversation-archive');
const {readRecords,render}=require('../scripts/read_conversations');
const keyHex='11'.repeat(32),key=parseKey(keyHex);
function room(){return {mode:'invite',topic:'お題',mcs:['a','b']}}
const a={id:'a',role:'mc',archiveConsent:true},b={id:'b',role:'mc',archiveConsent:true};
test('archive is off without a key and requires strict consent from both MCs',()=>{
  const lines=[];const disabled=createArchive(undefined,x=>lines.push(x)),r=room();
  disabled.start(r,a,b);disabled.message(r,a,'保存しない');assert.equal(disabled.enabled,false);
  const enabled=createArchive(keyHex,x=>lines.push(x));
  for(const consent of [false,undefined,'true',1]){enabled.start(r,a,{...b,archiveConsent:consent});enabled.message(r,a,'保存しない')}
  assert.deepEqual(lines,[]);assert.throws(()=>createArchive('invalid'),/32-byte/);
});
test('encrypted archive omits nicknames, traffic source, client IDs and listener text; stopping is final',()=>{
  const lines=[],archive=createArchive(keyHex,x=>lines.push(x)),r=room();
  archive.start(r,a,b);archive.message(r,a,'<script>サンプル</script>');
  archive.message(r,{id:'listener',role:'listener'},'保存対象外リスナー');
  archive.stop(r,'opt_out');archive.message(r,b,'停止後の本文');archive.stop(r);
  assert.equal(lines.length,3);assert.doesNotMatch(lines.join('\n'),/サンプル|<script>|保存対象外リスナー|停止後|"nickname"|"source"/);
  const rows=readRecords(lines,key);assert.deepEqual(rows.map(x=>x.event),['start','message','end']);
  assert.equal(rows[1].speaker,'MC A');assert.deepEqual(Object.keys(rows[1]).sort(),['event','index','room','speaker','text','time','topic']);
  assert.notEqual(rows[0].room,'a');assert.equal(rows[2].reason,'opt_out');
});
test('GCM rejects wrong keys and tampering rather than returning partial plaintext',()=>{
  const e=encrypt({text:'架空の本文'},key);assert.equal(decrypt(e,key).text,'架空の本文');
  assert.throws(()=>decrypt(e,Buffer.alloc(32,2)));
  const data=Buffer.from(e.data,'base64');data[0]^=1;
  assert.throws(()=>decrypt({...e,data:data.toString('base64')},key));
  assert.throws(()=>readRecords([JSON.stringify(e)],Buffer.alloc(32,2)),/復号/);
});
test('reader accepts timestamp prefixes, deduplicates overlap and escapes HTML; missing records stay visible',()=>{
  const lines=[],archive=createArchive(keyHex,x=>lines.push(x)),r=room();archive.start(r,a,b);
  archive.message(r,a,'<img src=x onerror=alert(1)>');archive.stop(r);
  const rows=readRecords(['unrelated',...lines.map(x=>'2026-11-05 '+x),...lines],key);assert.equal(rows.length,3);
  const html=render(rows);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img|<script/);
  assert.match(html,/default-src 'none'/);assert.match(render(rows.slice(1)),/取得は一部/);
  assert.match(render(rows),/保存開始から保存終了/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const cards = require('../public/answer-cards');
const topics = [{id:'free',topic:'一生無料になるなら何を選ぶ？'},{id:'holiday',topic:'自分だけの祝日を作るなら？'}];
function context() {
  return {font:'',fillRect(){},beginPath(){},arc(){},fill(){},stroke(){},moveTo(){},arcTo(){},closePath(){},fillText(){},
    measureText(text){return {width:cards.characters(text).length*Number(/(\d+)px/.exec(this.font)[1])};}};
}
function fixture(navigator={}, options={}) {
  const nodes=new Map(), revoked=[], completions=[];
  const ids=['answerCard','answerInput','answerCreate','answerStatus','answerOutput','answerPreview','answerSave','answerShare','answerCount','answerLink','answerTweet','answerCopy','answerEntry','soloEntry','demo'];
  for(const id of ids){const classes=new Set();nodes.set(id,{value:'',textContent:'',disabled:false,
    classList:{toggle(name,state){state?classes.add(name):classes.delete(name);},contains(name){return classes.has(name);}},removeAttribute(name){delete this[name];}});}
  let serial=0;
  const document={getElementById:id=>nodes.get(id),fonts:{ready:Promise.resolve()},createElement(tag){
    assert.equal(tag,'canvas');return {getContext:()=>options.noCanvas?null:context(),toBlob(done,type){
      assert.equal(type,'image/png');if(options.defer)completions.push(done);else done({size:1200,type});}};
  }};
  class FakeFile{constructor(parts,name,attributes){this.parts=parts;this.name=name;this.type=attributes.type;}}
  const controller=cards.init({document,navigator,File:FakeFile,urlApi:{createObjectURL:()=> 'blob:test-'+(++serial),revokeObjectURL:url=>revoked.push(url)}});
  controller.setTopic(topics[0]);
  const input=text=>{nodes.get('answerInput').value=text;nodes.get('answerInput').oninput();};
  return {nodes,controller,input,revoked,completions};
}
test('shared links select a known topic without copying private query data',()=>{
  assert.equal(cards.resolveTopic('?topic=holiday&answer=private&invite=secret',topics),topics[1]);
  for(const query of ['', '?topic=999','?topic=<script>','?topic=__proto__'])assert.equal(cards.resolveTopic(query,topics),null);
  const url=new URL(cards.shareUrl('free'));
  assert.equal(url.origin,'https://yonayona-radio.onrender.com');
  assert.deepEqual([...url.searchParams.entries()],[['topic','free'],['utm_source','share']]);
  assert.equal(url.hash,'#answerCard');assert.throws(()=>cards.shareUrl('../private'));
  assert.equal(new URL(cards.tweetUrl(topics[0])).searchParams.get('url'),cards.shareUrl('free'));
});
test('120-character limit preserves compound emoji and normalizes multiline answers',()=>{
  const emoji='👨‍👩‍👧‍👦';assert.equal(cards.characters(emoji).length,1);
  assert.equal(cards.limitAnswer('あ'.repeat(119)+emoji+'次'),'あ'.repeat(119)+emoji);
  assert.equal(cards.cleanAnswer('  家賃\n 毎月助かる。 '),'家賃 毎月助かる。');
  assert.equal(cards.cleanAnswer('\n\t  '),'');
});
test('long Japanese, long Latin words, and literal markup fit the image without losing answer text',()=>{
  for(const answer of ['あ'.repeat(120),'W'.repeat(120),'家賃。毎月助かるから。','<img src=x onerror=alert(1)>']){
    const ctx=context(),canvas={getContext:()=>ctx};const result=cards.drawCard(canvas,topics[0],answer);
    assert.equal(canvas.width,1080);assert.equal(canvas.height,1080);
    assert.equal(result.layout.lines.join('').replace(/\s/g,''),answer.replace(/\s/g,''));
    assert.ok(result.layout.height<=302);ctx.font='700 '+result.layout.size+'px sans-serif';
    for(const line of result.layout.lines)assert.ok(ctx.measureText(line).width<=848);
  }
  assert.deepEqual(cards.wrapText('あいう。え',text=>text.length,3),['あい','う。え']);
});
test('card creation supplies PNG download and same-topic link when native sharing is absent',async()=>{
  const f=fixture();assert.equal(f.nodes.get('answerCreate').disabled,true);
  f.input('家賃。');await f.nodes.get('answerCreate').onclick();
  assert.equal(f.nodes.get('answerOutput').classList.contains('hidden'),false);
  assert.equal(f.nodes.get('answerSave').download,'mojimoji-answer-free.png');
  assert.match(f.nodes.get('answerSave').href,/^blob:/);
  assert.equal(f.nodes.get('answerLink').value,cards.shareUrl('free'));
  assert.equal(f.nodes.get('answerShare').classList.contains('hidden'),true);
  assert.match(f.nodes.get('answerPreview').alt,/家賃。/);
});
test('editing invalidates the old image and changing topics keeps separate drafts',async()=>{
  const f=fixture();f.input('家賃');await f.nodes.get('answerCreate').onclick();f.input('アイス');
  assert.equal(f.nodes.get('answerOutput').classList.contains('hidden'),true);
  assert.equal(f.nodes.get('answerSave').href,undefined);assert.deepEqual(f.revoked,['blob:test-1']);
  f.controller.setTopic(topics[1]);assert.equal(f.nodes.get('answerInput').value,'');
  f.input('二度寝の日');f.controller.setTopic(topics[0]);assert.equal(f.nodes.get('answerInput').value,'アイス');
  f.controller.setTopic(topics[1]);assert.equal(f.nodes.get('answerInput').value,'二度寝の日');
});
test('an earlier asynchronous export cannot replace an edited answer',async()=>{
  const f=fixture({}, {defer:true});f.input('前の回答');const pending=f.nodes.get('answerCreate').onclick();
  await Promise.resolve();f.input('新しい回答');f.completions[0]({size:100,type:'image/png'});await pending;
  assert.equal(f.nodes.get('answerOutput').classList.contains('hidden'),true);
  assert.equal(f.nodes.get('answerInput').value,'新しい回答');assert.equal(f.nodes.get('answerStatus').textContent,'');
});
test('Japanese IME composition cannot create a half-confirmed card',async()=>{
  const f=fixture();f.nodes.get('answerInput').oncompositionstart();f.input('あ'.repeat(121));
  await f.nodes.get('answerCreate').onclick();assert.equal(f.nodes.get('answerCreate').disabled,true);
  assert.equal(f.nodes.get('answerOutput').classList.contains('hidden'),true);
  f.nodes.get('answerInput').oncompositionend();assert.equal(f.nodes.get('answerInput').value.length,120);
  assert.equal(f.nodes.get('answerCount').textContent,'120 / 120');
});
test('clipboard refusal leaves a copyable link and never claims success',async()=>{
  const f=fixture({clipboard:{writeText:async()=>{throw Error('Denied');}}});
  f.input('家賃');await f.nodes.get('answerCreate').onclick();await f.nodes.get('answerCopy').onclick();
  assert.equal(f.nodes.get('answerLink').value,cards.shareUrl('free'));
  assert.doesNotMatch(f.nodes.get('answerStatus').textContent,/コピーしました/);assert.match(f.nodes.get('answerStatus').textContent,/リンク欄/);
});
test('native share cancellation keeps the image and is never reported as a completed post',async()=>{
  let payload;const f=fixture({canShare:data=>data.files[0].type==='image/png',share:async data=>{payload=data;const error=Error();error.name='AbortError';throw error;}});
  f.input('アイス');await f.nodes.get('answerCreate').onclick();await f.nodes.get('answerShare').onclick();
  assert.equal(payload.files[0].name,'mojimoji-answer-free.png');assert.equal(payload.url,cards.shareUrl('free'));
  assert.match(f.nodes.get('answerStatus').textContent,/キャンセル/);assert.doesNotMatch(f.nodes.get('answerStatus').textContent,/投稿.*完了/);
  assert.equal(f.nodes.get('answerOutput').classList.contains('hidden'),false);
});
test('image failure preserves the answer and allows retry',async()=>{
  const f=fixture({}, {noCanvas:true});f.input('家賃');await f.nodes.get('answerCreate').onclick();
  assert.equal(f.nodes.get('answerInput').value,'家賃');assert.equal(f.nodes.get('answerCreate').disabled,false);
  assert.equal(f.nodes.get('answerOutput').classList.contains('hidden'),true);assert.match(f.nodes.get('answerStatus').textContent,/作れませんでした/);
});

#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const {parseKey,decrypt}=require('../conversation-archive');
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function readRecords(lines,key) {
  const records=new Map();let failed=0;
  for (const line of lines) {
    const start=line.indexOf('{');if(start<0)continue;
    let envelope;try{envelope=JSON.parse(line.slice(start))}catch{continue}
    if(envelope?.type!=='radio_transcript')continue;
    let r;try{r=decrypt(envelope,key)}catch{failed++;continue}
    if (!r || typeof r.room!=='string' || !/^[a-f0-9-]{36}$/.test(r.room) || !Number.isSafeInteger(r.index) || r.index<0 || !Number.isFinite(Date.parse(r.time)) || !['start','message','end'].includes(r.event)) {failed++;continue}
    if(r.event==='message' && (!['MC A','MC B'].includes(r.speaker) || typeof r.text!=='string' || r.text.length>300)){failed++;continue}
    const id=r.room+':'+r.index;
    if(records.has(id) && JSON.stringify(records.get(id))!==JSON.stringify(r))throw Error('Conflicting transcript records');
    records.set(id,r);
    if(records.size>100000)throw Error('Too many transcript records');
  }
  // Never silently report a complete readable archive with the wrong key.
  if(failed)throw Error('会話ログを復号・検証できません。鍵の相違、破損、異なる鍵の混在を確認してください。');
  return [...records.values()].sort((a,b)=>a.time.localeCompare(b.time)||a.index-b.index);
}
function render(records) {
  const rooms=new Map();for(const r of records){if(!rooms.has(r.room))rooms.set(r.room,[]);rooms.get(r.room).push(r)}
  const date=time=>new Date(time).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'});
  let n=0;
  const sections=[...rooms.values()].map(items=>{
    items.sort((a,b)=>a.index-b.index);n++;
    const complete=items[0].event==='start' && items.at(-1).event==='end' && items.every((x,i)=>x.index===i);
    return `<section><h2>番組 ${n}</h2><p>${esc(date(items[0].time))}（日本時間）</p><p class="note">${complete?'保存開始から保存終了までの記録があります。':'取得は一部です。番組の継続中・ログの欠落・取得範囲外の可能性があります。'}</p>${items.filter(r=>r.event==='message').map(r=>`<article><small>${esc(r.speaker)} · ${esc(date(r.time))}</small><p class="topic">お題：${esc(r.topic)}</p><p class="message">${esc(r.text)}</p></article>`).join('')}</section>`;
  }).join('');
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>もじもじラジオ 保存会話</title><style>body{font:16px/1.7 system-ui,sans-serif;max-width:760px;margin:auto;padding:20px;background:#f4f1fa;color:#272035}section{background:white;padding:18px;border-radius:16px;margin:20px 0}article{padding:12px;border:1px solid #ddd;border-radius:10px;margin:10px 0}.message{white-space:pre-wrap;overflow-wrap:anywhere}.topic,small,.note{font-size:13px;color:#625573}h1{font-size:24px}</style><h1>もじもじラジオ 保存会話</h1><p>運営確認用・非公開。MC2人が保存に同意した番組のみ。リスナーコメント・ニックネームは保存対象外です。完全な会話履歴や実人数を示すものではありません。</p><p>${rooms.size}番組・${records.filter(r=>r.event==='message').length}発言。ファイルには復号済みの本文が含まれます。</p>${sections||'<p>取得範囲に保存会話の記録はありません。</p>'}</html>`;
}
function main(args) {
  if(args.length!==4 || args[0]!=='--key-file')throw Error('使い方: node scripts/read_conversations.js --key-file PRIVATE_KEY_FILE EXPORTED_LOG OUTPUT.html');
  const key=parseKey(fs.readFileSync(args[1],'utf8').trim());
  const records=readRecords(fs.readFileSync(args[2],'utf8').split('\n'),key);
  fs.writeFileSync(args[3],render(records),{flag:'wx',mode:0o600});
  console.log('会話レポートを作成しました。');
}
if(require.main===module){try{main(process.argv.slice(2))}catch{console.error('会話レポートを作成できません。引数・鍵・ログ・出力先を確認してください（既存ファイルには上書きしません）。');process.exitCode=1}}
module.exports={readRecords,render,main};

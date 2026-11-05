'use strict';
const crypto = require('node:crypto');
const AAD = Buffer.from('mojimoji-radio/transcript/v1');
function parseKey(value) {
  if (typeof value !== 'string' || !/^[a-fA-F0-9]{64}$/.test(value)) throw Error('RADIO_ARCHIVE_KEY must be a 32-byte hexadecimal key');
  return Buffer.from(value, 'hex');
}
function encrypt(record, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(AAD);
  const data = Buffer.concat([cipher.update(JSON.stringify(record), 'utf8'), cipher.final()]);
  return {type:'radio_transcript',v:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')};
}
function decrypt(entry, key) {
  if (!entry || entry.type !== 'radio_transcript' || entry.v !== 1) throw Error('Unsupported transcript');
  for (const field of ['iv','tag','data']) if (typeof entry[field] !== 'string' || entry[field].length > 8192 || !/^[A-Za-z0-9+/]+={0,2}$/.test(entry[field])) throw Error('Invalid transcript');
  const iv=Buffer.from(entry.iv,'base64'),tag=Buffer.from(entry.tag,'base64');
  if (iv.length!==12 || tag.length!==16) throw Error('Invalid transcript');
  const cipher=crypto.createDecipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(AAD);cipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([cipher.update(Buffer.from(entry.data,'base64')),cipher.final()]).toString('utf8'));
}
function createArchive(value, write = line => console.log(line)) {
  const key = value ? parseKey(value) : null;
  function record(room, item) {
    if (!key || !room.archive) return;
    const payload={room:room.archive.id,index:room.archive.index++,time:new Date().toISOString(),...item};
    // Never log the plaintext, nicknames, client IDs, invite tokens, or traffic source.
    write(JSON.stringify(encrypt(payload,key)));
  }
  return {
    enabled:!!key,
    start(room,a,b) {
      room.archive = key && a.archiveConsent === true && b.archiveConsent === true ? {id:crypto.randomUUID(),index:0} : null;
      record(room,{event:'start',mode:room.mode,topic:room.topic});
    },
    message(room,client,text) {
      const seat=room.mcs.indexOf(client.id);
      if (seat<0 || client.role!=='mc') return;
      record(room,{event:'message',speaker:seat===0?'MC A':'MC B',topic:room.topic,text});
    },
    stop(room,reason='ended') {
      record(room,{event:'end',reason});room.archive=null;
    }
  };
}
module.exports={createArchive,parseKey,encrypt,decrypt};

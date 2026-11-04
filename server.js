const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const {WebSocketServer,WebSocket}=require('ws');
const traffic=require('./public/traffic');
const InviteLinks=require('./invite-links');
const metricEvents=new Set(['page_view','matching_attempt','matched_participant','listener_join','conversation','conversation_participant']);
function metric(event,source){if(!metricEvents.has(event))return;const entry={type:'radio_metric',time:new Date().toISOString(),event};if(source!==undefined)entry.source=traffic.normalize(source);console.log(JSON.stringify(entry))}
const PORT=process.env.PORT||3000, ROOT=path.join(__dirname,'public');
const topics=['一生無料になるなら何を選ぶ？','最近ちょっと嬉しかったこと','子どもの頃に信じていたこと','人生で一番しょうもない嘘','一日だけ透明人間になれたら？','無人島に一つだけ持っていくなら？','自分だけの祝日を作るなら？','一生ひとつの料理しか食べられないなら？'];
const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost');if(url.pathname==='/health'){res.writeHead(200,{'Content-Type':'text/plain'});return res.end('ok')}const file=url.pathname==='/'?'index.html':url.pathname.slice(1);const full=path.resolve(ROOT,file);if(!full.startsWith(ROOT+path.sep)&&full!==path.join(ROOT,'index.html')){res.writeHead(403);return res.end()};fs.readFile(full,(e,data)=>{if(e){res.writeHead(404);return res.end('Not found')}const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.xml':'application/xml; charset=utf-8','.txt':'text/plain; charset=utf-8'};res.setHeader('Content-Type',mime[path.extname(full)]||'application/octet-stream');res.setHeader('X-Content-Type-Options','nosniff');if(url.searchParams.has('invite')){res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store')}if(req.method==='GET'&&full===path.join(ROOT,'index.html'))metric('page_view',traffic.source(url.search,req.headers.referer));res.end(req.method==='HEAD'?undefined:data)})});
const wss=new WebSocketServer({server,maxPayload:4096});const clients=new Map(),rooms=new Map(),invites=new InviteLinks();let queue=[];
const uid=()=>crypto.randomUUID().slice(0,8),pick=()=>topics[Math.floor(Math.random()*topics.length)];
function send(ws,data){if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify(data))}
function broadcast(room,data){for(const id of [...room.mcs,...room.listeners])send(clients.get(id)?.ws,data)}
function safeName(v){return typeof v==='string'?(v.trim().slice(0,18)||'匿名'):'匿名'}
function state(room){return {id:room.id,mode:room.mode,topic:room.topic,started:room.started,mcs:room.mcs.map(id=>({id,name:clients.get(id)?.name||'退出'})),listeners:room.listeners.size,history:room.history}}
function publishRooms(){queue=queue.filter(id=>{const c=clients.get(id);return c&&!c.room&&c.ws.readyState===WebSocket.OPEN});const list=[...rooms.values()].filter(r=>!r.ended).map(r=>({id:r.id,topic:r.topic,mcs:r.mcs.map(id=>clients.get(id)?.name||'匿名'),listeners:r.listeners.size,started:r.started}));for(const c of clients.values())send(c.ws,{type:'rooms',rooms:list,waitingCount:queue.length})}
function leave(c,reason='退出'){if(!c)return;invites.cancel(c.id);const wasQueued=queue.includes(c.id);queue=queue.filter(id=>id!==c.id);const room=rooms.get(c.room);c.room=null;c.role=null;if(!room){if(wasQueued)publishRooms();return}if(room.mcs.includes(c.id)){room.ended=true;broadcast(room,{type:'ended',reason:`MCが${reason}したため番組終了`,partner:room.mcs.find(id=>id!==c.id)});for(const id of [...room.mcs,...room.listeners]){const p=clients.get(id);if(p){p.room=null;p.role=null}}rooms.delete(room.id)}else{room.listeners.delete(c.id);broadcast(room,{type:'listeners',count:room.listeners.size})}publishRooms()}
function join(c,room,role){c.room=room.id;c.role=role;if(role==='listener'){room.listeners.add(c.id);metric('listener_join',c.source)}send(c.ws,{type:'joined',role,self:c.id,room:state(room)});broadcast(room,{type:'listeners',count:room.listeners.size});publishRooms()}
function startRoom(a,b,mode='random'){
  const room={id:uid(),mode,mcs:[a.id,b.id],listeners:new Set(),topic:pick(),started:Date.now(),history:[],ended:false,spokenMCs:new Set(),countedConversation:false};
  rooms.set(room.id,room);join(a,room,'mc');join(b,room,'mc');
  metric('matched_participant',a.source);metric('matched_participant',b.source);
}
function match(){while(queue.length>=2){const a=clients.get(queue.shift()),b=clients.get(queue.shift());if(!a||!b||a.ws.readyState!==WebSocket.OPEN||b.ws.readyState!==WebSocket.OPEN||a.room||b.room){if(a&&!a.room&&a.ws.readyState===WebSocket.OPEN)queue.unshift(a.id);continue}startRoom(a,b)}}
function inviteError(c,message){send(c.ws,{type:'invite_error',message})}
function expireInvites(){for(const link of invites.expire()){const host=clients.get(link.hostId);if(host)inviteError(host,'招待リンクの有効期限が切れました。新しいリンクを作成してください。')}}
const inviteCleanup=setInterval(expireInvites,30000);inviteCleanup.unref();
function inviteEvent(c,msg){
  expireInvites();
  if(msg.type==='invite_create'){
    if(c.room){inviteError(c,'番組から退出してから、招待リンクを作成してください。');return}
    let link=invites.forHost(c.id);
    if(!link){
      if(invites.links.size>=invites.limit){inviteError(c,'現在、招待が混み合っています。少し時間をおいてお試しください。');return}
      leave(c);link=invites.create(c.id);metric('matching_attempt',c.source);
    }
    send(c.ws,{type:'invite_created',token:link.token,expiresAt:link.expiresAt});publishRooms();return;
  }
  const link=invites.get(msg.token),host=link&&clients.get(link.hostId);
  if(!link||!host||host.room||host.ws.readyState!==WebSocket.OPEN){inviteError(c,'この招待リンクは使えません。作成した友達に新しいリンクをもらってください。');return}
  if(host.id===c.id){inviteError(c,'自分で作成した招待です。リンクを友達に送って、この画面でお待ちください。');return}
  if(msg.type==='invite_check'){send(c.ws,{type:'invite_ready',expiresAt:link.expiresAt});return}
  if(c.room){inviteError(c,'今の番組から退出してから、招待に参加してください。');return}
  // Single-threaded consumption prevents two visitors taking the second MC slot.
  if(!invites.take(msg.token)){inviteError(c,'この招待は参加済みです。新しいリンクをもらってください。');return}
  leave(c);metric('matching_attempt',c.source);startRoom(host,c,'invite');
}
function event(c,raw){let msg;try{msg=JSON.parse(raw)}catch{return}if(!msg||typeof msg!=='object'||Array.isArray(msg))return;const type=msg.type;if(['invite_create','invite_check','invite_join'].includes(type)){inviteEvent(c,msg);return}if(type==='name'){c.name=safeName(msg.name);send(c.ws,{type:'identity',id:c.id,name:c.name});return}if(type==='list'){publishRooms();return}if(type==='queue'){if(queue.includes(c.id)){send(c.ws,{type:'waiting'});publishRooms();return}leave(c);queue.push(c.id);metric('matching_attempt',c.source);send(c.ws,{type:'waiting'});match();publishRooms();return}if(type==='cancel'){invites.cancel(c.id);queue=queue.filter(id=>id!==c.id);send(c.ws,{type:'cancelled'});publishRooms();return}if(type==='watch'){leave(c);const r=rooms.get(typeof msg.id==='string'?msg.id:'');if(!r)return send(c.ws,{type:'error',message:'番組が終了しました'});join(c,r,'listener');return}if(type==='leave'){leave(c);send(c.ws,{type:'left'});return}const r=rooms.get(c.room);if(!r||r.ended)return;if(type==='topic'){if(c.role!=='mc')return;const now=Date.now();if(now-(r.lastTopicChange||0)<3000)return send(c.ws,{type:'error',message:'お題変更は3秒待ってください'});r.lastTopicChange=now;r.topic=pick();broadcast(r,{type:'topic',topic:r.topic});publishRooms();return}if(type==='chat'){if(c.role!=='mc'&&c.role!=='listener')return;const text=typeof msg.text==='string'?msg.text.trim().slice(0,300):'';if(!text)return;const now=Date.now();if(now-c.lastMessage<1000)return send(c.ws,{type:'error',message:'連続投稿は少し待ってください'});c.lastMessage=now;const item={id:uid(),sender:c.id,name:c.name,role:c.role,text,time:now};r.history.push(item);if(r.history.length>120)r.history.shift();if(c.role==='mc')r.spokenMCs.add(c.id);if(!r.countedConversation&&r.mcs.every(id=>r.spokenMCs.has(id))){r.countedConversation=true;metric('conversation');for(const id of r.mcs)metric('conversation_participant',clients.get(id)?.source)}broadcast(r,{type:'chat',item});return}}
wss.on('connection',(ws,req)=>{const url=new URL(req.url,'http://localhost');const c={id:crypto.randomUUID(),ws,name:'匿名',room:null,role:null,lastMessage:0,source:traffic.source(url.search,req.headers.referer)};clients.set(c.id,c);send(ws,{type:'identity',id:c.id,name:c.name});publishRooms();ws.on('message',raw=>event(c,raw));ws.on('close',()=>{leave(c,'切断');clients.delete(c.id);publishRooms()});ws.on('error',()=>{})});
server.listen(PORT,()=>console.log('もじもじラジオ http://localhost:'+server.address().port));

(function(root){
  'use strict';
  const allowed=new Set(['direct','x','hiromeba','tsukutta','appvillage','viibo','freesoft100','tsukurulog','share','internal','other']);
  const domains={'x.com':'x','t.co':'x','twitter.com':'x','hiromeba.com':'hiromeba','tsukutta.app':'tsukutta','app-village.jp':'appvillage','viibo.jp':'viibo','freesoft-100.com':'freesoft100','tsukurulog.com':'tsukurulog','yonayona-radio.onrender.com':'internal'};
  function normalize(value){
    if(typeof value!=='string'||!value.trim())return 'direct';
    const key=value.trim().toLowerCase();
    if(key==='twitter'||key==='x_community')return 'x';
    return allowed.has(key)?key:'other';
  }
  function source(search,referrer){
    const tag=new URLSearchParams(search||'').get('utm_source');
    if(tag&&tag.trim())return normalize(tag);
    if(!referrer)return 'direct';
    try{const host=new URL(referrer).hostname.toLowerCase().replace(/^www\./,'');return domains[host]||'other'}
    catch{return 'other'}
  }
  const api={normalize,source};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.RadioTraffic=api;
})(typeof globalThis!=='undefined'?globalThis:this);

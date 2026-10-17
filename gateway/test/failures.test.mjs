import assert from 'node:assert/strict';
import http from 'node:http';
import {test} from 'node:test';
import {createServer} from '../server.js';
import {handleRequest} from '../worker.mjs';
const key='f'.repeat(64), endpoint='/telegram?bot=angel&key='+key;
const config={APPS_SCRIPT_URL:'https://upstream.example/exec',ANGEL_WEBHOOK_KEY:key};
async function invoke(kind,{path=endpoint,method='POST',body='{"update_id":1}',env=config,fetchImpl=async()=>({ok:true,status:200,text:async()=> 'ok'}),headers={}}={}) {
  if(kind==='worker') {
    const r=await handleRequest(new Request('https://gateway.example'+path,{method,headers,...(!['GET','HEAD'].includes(method)?{body}:{})}),env,fetchImpl);
    return {status:r.status,text:await r.text()};
  }
  const server=createServer({appsScriptUrl:env.APPS_SCRIPT_URL,webhookKeys:{angel:env.ANGEL_WEBHOOK_KEY},fetchImpl});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try { return await new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port:server.address().port,path,method,headers},res=>{
      const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,text:Buffer.concat(chunks).toString()}));
    });req.on('error',reject);req.end(body);
  }); } finally {await new Promise(resolve=>server.close(resolve));}
}
for(const kind of ['server','worker']) {
  for(const [label,args,status,text] of [
    ['unknown path',{path:'/elsewhere'},404,'not found'],['wrong method',{method:'GET'},404,'not found'],
    ['missing key configuration',{env:{APPS_SCRIPT_URL:config.APPS_SCRIPT_URL}},503,'gateway unavailable'],
    ['missing upstream configuration',{env:{ANGEL_WEBHOOK_KEY:key}},503,'gateway unavailable'],
    ['malformed JSON',{body:'{'},503,'gateway unavailable']
  ]) test(kind+' '+label+' does not forward',async()=>{
    let calls=0; const result=await invoke(kind,{...args,fetchImpl:async()=>{calls++;throw new Error('must not forward');}});
    assert.deepEqual(result,{status,text});assert.equal(calls,0);
  });
  for(const [label,status,body] of [['HTTP failure',500,'ok'],['missing acknowledgement',200,'retry'],['empty acknowledgement',200,'']]) test(kind+' '+label+' remains retryable',async()=>{
    let calls=0;const r=await invoke(kind,{fetchImpl:async()=>{calls++;return {ok:status===200,status,text:async()=>body};}});
    assert.deepEqual(r,{status:503,text:'upstream unavailable'});assert.equal(calls,1);
  });
  for(const stage of ['network','timeout','response read']) test(kind+' '+stage+' logs no exception data',async()=>{
    const marker=['synthetic','private','diagnostic'].join('-'); const logs=[],original=console.error;
    console.error=(...args)=>logs.push(args.join(' '));
    try {
      const fail=()=>{const error=new Error(marker);if(stage==='timeout')error.name='TimeoutError';throw error;};
      const r=await invoke(kind,{fetchImpl:async(_url,options)=>{assert.ok(options.signal instanceof AbortSignal);return stage==='response read'?{ok:true,status:200,text:fail}:fail();}});
      assert.deepEqual(r,{status:503,text:'gateway unavailable'});assert.equal(logs.length,1);assert.ok(!logs.join('').includes(marker),'logs must omit arbitrary upstream/request content');
    } finally {console.error=original;}
  });
  for(const size of [1024*1024,1024*1024+1]) test(kind+' body byte boundary '+size,async()=>{
    const body='"'+'x'.repeat(size-2)+'"';let calls=0;
    const r=await invoke(kind,{body,fetchImpl:async(_url,options)=>{calls++;assert.equal(options.body.byteLength,size);return {ok:true,status:200,text:async()=> ' ok\n'};}});
    assert.equal(r.status,size===1024*1024?200:413);assert.equal(calls,size===1024*1024?1:0);
  });
  test(kind+' forwarding preserves body, role, key and response whitespace contract',async()=>{
    let called=false;const body=JSON.stringify({update_id:9,message:{text:'fixture'}});
    const r=await invoke(kind,{body,fetchImpl:async(url,options)=>{called=true;const u=new URL(url);assert.equal(u.origin,'https://upstream.example');assert.equal(u.searchParams.get('bot'),'angel');assert.equal(u.searchParams.get('key'),key);assert.equal(Buffer.from(options.body).toString(),body);assert.equal(options.method,'POST');assert.equal(options.redirect,'follow');return {ok:true,status:200,text:async()=> ' ok\n'};}});
    assert.deepEqual(r,{status:200,text:'ok'});assert.equal(called,true);
  });
}
test('worker oversized announced length avoids reading the body',async()=>{
  const r=await handleRequest({url:'https://gateway.example'+endpoint,method:'POST',headers:new Headers({'content-length':String(1024*1024+1)}),arrayBuffer:()=>{throw new Error('must not read');}},config,()=>{throw new Error('must not fetch');});assert.equal(r.status,413);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,stat,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {build} from '../../../node_modules/esbuild/lib/main.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
await build({entryPoints:[resolve(root,'../../apps/electron/src/main/visual-review-host.ts')],outfile:join(root,'dist/host-test.mjs'),bundle:true,platform:'node',format:'esm',logLevel:'silent'});
const {VisualReviewHost}=await import('../dist/host-test.mjs');
const exec=promisify(execFile);

test('packaged review host lifecycle',async t=>{
 const fixture=await mkdtemp(join(tmpdir(),'craft-review-host-'));
 const file=join(fixture,'page.html');await writeFile(file,'<!doctype html><h1 id="title">Review fixture</h1>');
 const workers=[];
 const host=new VisualReviewHost({configDirectory:fixture,resourcesDirectory:join(root,'dist'),version:'0.1.0',spawnWorker:(entry,args)=>{
   const child=spawn(process.execPath,[entry,...args],{env:{PATH:'/usr/bin:/bin',CRAFT_VISUAL_REVIEW_BUNDLED:'1'},stdio:['ignore','pipe','pipe']});workers.push(child);return child;
 }});
 await host.start();
 const descriptor=join(fixture,'visual-review/runtime.json'),runtime=JSON.parse(await readFile(descriptor,'utf8'));
 const request={outputDirectory:join(fixture,'feedback'),files:[file]};
 const post=(body,token=runtime.token)=>fetch(runtime.url+'/open',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)});
 try{
  await t.test('runtime discovery is private',async()=>assert.equal((await stat(descriptor)).mode&0o777,0o600));
  await t.test('unauthorized requests are rejected',async()=>assert.equal((await post(request,'wrong')).status,403));
  await t.test('browser-origin requests are rejected',async()=>{
   const r=await fetch(runtime.url+'/open',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+runtime.token,Origin:'https://example.com'},body:JSON.stringify(request)});assert.equal(r.status,403);
  });
  let opened;
  await t.test('concurrent opens share one ready worker',async()=>{
   const results=await Promise.all([post(request),post(request)]);opened=await results[0].json();const other=await results[1].json();assert.equal(opened.url,other.url);assert.equal(workers.length,1);assert.equal(opened.links[0].file,await realpath(file));
  });
  await t.test('packaged worker serves all browser resources without node_modules',async()=>{
   for(const path of ['','app.js','fabric.js','region-editor.js','html-bridge.js','assets'])assert.equal((await fetch(opened.url+path)).status,200,path);
   const assets=await(await fetch(opened.url+'assets')).json();assert.equal(assets[0].name,'page.html');
  });
  await t.test('bundled helper uses the active application host',async()=>{
   const {stdout}=await exec(process.execPath,[join(root,'dist/open-review.cjs'),request.outputDirectory,file],{env:{CRAFT_CONFIG_DIR:fixture,PATH:'/usr/bin:/bin'}});const result=JSON.parse(stdout);assert.equal(result.url,opened.url);
  });
  await t.test('changed input gets a new worker instead of stale snapshots',async()=>{
   await writeFile(file,'<!doctype html><h1>Changed fixture content</h1>');const changed=await(await post(request)).json();assert.notEqual(changed.url,opened.url);assert.equal(workers.length,2);
  });
  await t.test('invalid paths cannot become commands',async()=>assert.equal((await post({...request,files:['not-an-absolute-path']})).status,400));
  await t.test('shutdown removes discovery and kills owned workers',async()=>{
   host.stop();await assert.rejects(readFile(descriptor));await new Promise(done=>setTimeout(done,100));assert.ok(workers.every(child=>child.exitCode!==null||child.signalCode!==null));await assert.rejects(fetch(opened.url));
  });
 }finally{host.stop();for(const child of workers)child.kill();await rm(fixture,{recursive:true,force:true});}
});

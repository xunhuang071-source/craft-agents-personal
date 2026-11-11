#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const candidate=fs.realpathSync(process.argv[2]||'');
const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'craft-review-electron-'));
const app=path.join(fixture,'Craft Review Test.app');
const resources=path.join(candidate,'Contents/Resources/app/dist/resources/visual-review');
const model=path.join(root,'extensions/visual-review/dist/host-test.mjs');
if(!fs.existsSync(model))throw Error('Run the visual review tests first');
function run(command,args,options={}){const r=spawnSync(command,args,{encoding:'utf8',timeout:45000,maxBuffer:8*1024*1024,...options});if(r.error||r.status!==0)throw Error(`${path.basename(command)}: ${r.error||r.stderr||r.stdout}`);return r.stdout;}
try{
 fs.cpSync(candidate,app,{recursive:true,verbatimSymlinks:true,filter:source=>{const rel=path.relative(candidate,source);return rel!=='Contents/Resources/app'&&!rel.startsWith('Contents/Resources/app/');}});
 const target=path.join(app,'Contents/Resources/app');fs.mkdirSync(target,{recursive:true});
 fs.writeFileSync(path.join(target,'package.json'),JSON.stringify({name:'visual-review-fixture',main:'main.cjs'}));
 fs.writeFileSync(path.join(fixture,'sample.html'),'<!doctype html><h1>Local test only</h1>');
 const main=`const {app,utilityProcess}=require('electron');const fs=require('node:fs');const path=require('node:path');
app.setPath('userData',${JSON.stringify(path.join(fixture,'profile'))});app.setAppLogsPath(${JSON.stringify(path.join(fixture,'logs'))});
app.whenReady().then(async()=>{let host;try{app.dock?.hide();const {VisualReviewHost}=await import(${JSON.stringify('file://'+model)});host=new VisualReviewHost({configDirectory:${JSON.stringify(fixture)},resourcesDirectory:${JSON.stringify(resources)},version:'0.1.0',spawnWorker:(entry,args)=>utilityProcess.fork(entry,args,{stdio:'pipe',env:{PATH:'/usr/bin:/bin',CRAFT_VISUAL_REVIEW_BUNDLED:'1'}})});await host.start();const runtime=JSON.parse(fs.readFileSync(${JSON.stringify(path.join(fixture,'visual-review/runtime.json'))},'utf8'));const response=await fetch(runtime.url+'/open',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+runtime.token},body:JSON.stringify({outputDirectory:${JSON.stringify(path.join(fixture,'feedback'))},files:[${JSON.stringify(path.join(fixture,'sample.html'))}]})});const opened=await response.json();if(!response.ok)throw Error(opened.error);for(const asset of ['','fabric.js','app.js','region-editor.js','assets'])if(!(await fetch(opened.url+asset)).ok)throw Error('Resource failed: '+asset);const {execFile}=require('node:child_process');const {promisify}=require('node:util');const helper=await promisify(execFile)(${JSON.stringify(path.join(candidate,'Contents/Resources/app/vendor/bun/bun'))},[${JSON.stringify(path.join(resources,'open-review.cjs'))},${JSON.stringify(path.join(fixture,'feedback'))},${JSON.stringify(path.join(fixture,'sample.html'))}],{env:{CRAFT_CONFIG_DIR:${JSON.stringify(fixture)},PATH:'/usr/bin:/bin'}});if(JSON.parse(helper.stdout).url!==opened.url)throw Error('Helper did not reuse the host');host.stop();await new Promise(r=>setTimeout(r,200));let closed=false;try{await fetch(opened.url)}catch{closed=true}if(!closed)throw Error('Worker survived shutdown');process.stdout.write(JSON.stringify({electron:process.versions.electron,node:process.versions.node,utilityProcess:true,bundledBunHelper:true,resourcesLoaded:true,workerClosed:true,realProfileUsed:false})+'\\n');app.exit(0)}catch(error){host?.stop();process.stderr.write(error.stack+'\\n');app.exit(1)}});`;
 fs.writeFileSync(path.join(target,'main.cjs'),main);
 run('/usr/bin/codesign',['--force','--deep','--sign','-','--preserve-metadata=entitlements,requirements,flags,runtime',app]);
 const executable=path.join(app,'Contents/MacOS/Craft Agents');
 console.log(run(executable,['--no-first-run'],{env:{HOME:fixture,USERPROFILE:fixture,CRAFT_CONFIG_DIR:fixture,PATH:'/usr/bin:/bin',TMPDIR:os.tmpdir()}}).trim());
}finally{fs.rmSync(fixture,{recursive:true,force:true});}

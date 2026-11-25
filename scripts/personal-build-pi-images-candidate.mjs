#!/usr/bin/env node
/** Build the Pi image processor and its resources against the verified stable app. */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const [baseArg,outArg,version]=process.argv.slice(2)
if(!baseArg||!outArg||!/^wallee-v\d+\.\d+\.\d+-rc\.\d+$/.test(version||''))throw Error('Usage: node scripts/personal-build-pi-images-candidate.mjs VERIFIED_BASE_APP NEW_OUTPUT_DIR VERSION')
const base=fs.realpathSync(baseArg),out=path.resolve(outArg),app=path.join(out,'Craft Agents.app'),lockPath=path.join(root,'docs/personal/baselines/wallee-v1.5.2.json'),baseline=JSON.parse(fs.readFileSync(lockPath,'utf8'))
if(baseline.version!=='wallee-v1.5.2')throw Error('Review baseline first')
if(fs.existsSync(out)||out.startsWith('/Applications/')||app===base||app.startsWith(base+path.sep)||base.startsWith(app+path.sep))throw Error('Choose a fresh non-overlapping output directory')
const staging=fs.mkdtempSync(path.join(os.tmpdir(),'craft-pi-images-build-')),bun=path.join(base,'Contents/Resources/app/vendor/bun/bun')
const env={HOME:staging,USERPROFILE:staging,CRAFT_CONFIG_DIR:path.join(staging,'config'),PATH:'/usr/bin:/bin:/usr/sbin:/sbin',TMPDIR:os.tmpdir()}
function run(command,args){const p=spawnSync(command,args,{cwd:root,env,encoding:'utf8',maxBuffer:16*1024*1024});if(p.error||p.status!==0)throw Error(`${path.basename(command)}: ${p.error||p.stderr||p.stdout}`);if(p.stdout)console.log(p.stdout.trim());return p.stdout.trim()}
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')
try{
 const esbuild=path.join(root,'node_modules/.bin/esbuild')
 if(run(bun,['--version'])!==baseline.build.bun||run(esbuild,['--version'])!==baseline.build.esbuild)throw Error('Use pinned build tools')
 for(const name of ['pi-coding-agent','pi-agent-core','pi-ai'])if(JSON.parse(fs.readFileSync(path.join(root,'node_modules/@earendil-works',name,'package.json'),'utf8')).version!=='1.4.0')throw Error('Pi SDK must remain 1.4.0')
 run('/usr/bin/python3',['scripts/personal-app-inventory.py','--app',base,'--lock',lockPath,'--output',path.join(staging,'baseline.json')])
 const piDir=path.join(staging,'pi'), piFiles=['index.js','image-resize-worker.js','photon_rs_bg.wasm']
 run(bun,['run','packages/pi-agent-server/build.ts',piDir])
 fs.mkdirSync(out);fs.cpSync(base,app,{recursive:true,preserveTimestamps:true,verbatimSymlinks:true})
 const piRel='Contents/Resources/app/resources/pi-agent-server'
 for(const file of piFiles) fs.copyFileSync(path.join(piDir,file),path.join(app,piRel,file))
 const lock=structuredClone(baseline);lock.version=version;lock.previousAcceptance=baseline.acceptance;lock.acceptance={version,installedByUser:false,manualReview:'pending',publicationAuthorizedByUser:false};lock.expectedBuild.standardPiSha256=sha(path.join(piDir,'index.js'))
 for(const file of piFiles.slice(1)) lock.frozen.files[`${piRel}/${file}`]=sha(path.join(piDir,file))
 fs.writeFileSync(path.join(out,'component-lock.json'),JSON.stringify(lock,null,2)+'\n');fs.copyFileSync(path.join(staging,'baseline.json'),path.join(out,'baseline-application-files.json'))
 run('/usr/bin/codesign',['--force','--deep','--sign','-','--preserve-metadata=entitlements,requirements,flags,runtime',app])
 run('/usr/bin/python3',['scripts/personal-app-inventory.py','--app',app,'--lock',path.join(out,'component-lock.json'),'--output',path.join(out,'application-files.json')])
 const sourceCommit=run('/usr/bin/git',['rev-parse','HEAD']),dirty=run('/usr/bin/git',['status','--porcelain'])
 fs.writeFileSync(path.join(out,'candidate-manifest.json'),JSON.stringify({schemaVersion:1,version,baselineVersion:baseline.version,sourceCommit,sourceDirty:!!dirty,...lock.expectedBuild,installed:false,published:false},null,2)+'\n')
 run('/usr/bin/python3',['scripts/personal-audit-candidate.py','--base-app',base,'--app',app,'--baseline-inventory',path.join(out,'baseline-application-files.json'),'--inventory',path.join(out,'application-files.json'),'--out',out,'--scope','pi-images'])
 console.log(JSON.stringify({version,app,installed:false,published:false}))
}finally{fs.rmSync(staging,{recursive:true,force:true})}

#!/usr/bin/env node
/** OSS 1140 + 1134 backport: only main and interceptor may change. */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const [baseArg,outArg,version]=process.argv.slice(2)
if(!baseArg||!outArg||!/^wallee-v\d+\.\d+\.\d+-rc\.\d+$/.test(version||''))throw Error('Usage: node scripts/personal-build-context-openai-candidate.mjs VERIFIED_BASE_APP NEW_OUTPUT_DIR VERSION')
const base=fs.realpathSync(baseArg),out=path.resolve(outArg),app=path.join(out,'Craft Agents.app'),lockPath=path.join(root,'docs/personal/baselines/wallee-v1.5.0.json'),baseline=JSON.parse(fs.readFileSync(lockPath,'utf8'))
if(baseline.version!=='wallee-v1.5.0')throw Error('Review baseline first')
if(fs.existsSync(out)||out.startsWith('/Applications/')||app===base||app.startsWith(base+path.sep)||base.startsWith(app+path.sep))throw Error('Choose a fresh non-overlapping output directory')
const staging=fs.mkdtempSync(path.join(os.tmpdir(),'craft-context-openai-build-')),bun=path.join(base,'Contents/Resources/app/vendor/bun/bun')
const env={HOME:staging,USERPROFILE:staging,CRAFT_CONFIG_DIR:path.join(staging,'config'),PATH:'/usr/bin:/bin:/usr/sbin:/sbin',TMPDIR:os.tmpdir()}
function run(command,args){const p=spawnSync(command,args,{cwd:root,env,encoding:'utf8',maxBuffer:16*1024*1024});if(p.error||p.status!==0)throw Error(`${path.basename(command)}: ${p.error||p.stderr||p.stdout}`);if(p.stdout)console.log(p.stdout.trim());return p.stdout.trim()}
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')
try{
 const esbuild=path.join(root,'node_modules/.bin/esbuild')
 if(run(bun,['--version'])!==baseline.build.bun||run(esbuild,['--version'])!==baseline.build.esbuild)throw Error('Use pinned build tools')
 for(const name of ['pi-coding-agent','pi-agent-core','pi-ai'])if(JSON.parse(fs.readFileSync(path.join(root,'node_modules/@earendil-works',name,'package.json'),'utf8')).version!=='1.4.0')throw Error('Pi SDK must remain 1.4.0')
 run('/usr/bin/python3',['scripts/personal-app-inventory.py','--app',base,'--lock',lockPath,'--output',path.join(staging,'baseline.json')])
 const main=path.join(staging,'main.cjs'),interceptor=path.join(staging,'interceptor.cjs'),graph=path.join(staging,'main-graph.json')
 const defines=['SLACK_OAUTH_CLIENT_ID','SLACK_OAUTH_CLIENT_SECRET','MICROSOFT_OAUTH_CLIENT_ID','MICROSOFT_OAUTH_CLIENT_SECRET','SENTRY_ELECTRON_INGEST_URL','CRAFT_DEV_RUNTIME'].map(k=>`--define:process.env.${k}=""`)
 run(esbuild,['apps/electron/src/main/index.ts','--bundle','--platform=node','--format=cjs',`--outfile=${main}`,`--metafile=${graph}`,'--external:electron','--alias:node-fetch=./apps/electron/src/main/shims/node-fetch.cjs','--alias:abort-controller=./apps/electron/src/main/shims/abort-controller.cjs',...defines])
 if(/claude-agent-sdk|managed-antigravity|antigravity-(menu|service|controller)/.test(fs.readFileSync(graph,'utf8')))throw Error('Retired runtime in graph')
 run(esbuild,['packages/shared/src/unified-network-interceptor.ts','--bundle','--platform=node','--format=cjs',`--outfile=${interceptor}`])
 fs.mkdirSync(out);fs.cpSync(base,app,{recursive:true,preserveTimestamps:true,verbatimSymlinks:true})
 const prefix='Contents/Resources/app',interceptorRel=`${prefix}/dist/interceptor.cjs`
 fs.copyFileSync(main,path.join(app,prefix,'dist/main.cjs'));fs.copyFileSync(interceptor,path.join(app,interceptorRel))
 const lock=structuredClone(baseline);lock.version=version;lock.previousAcceptance=baseline.acceptance;lock.acceptance={version,installedByUser:false,manualReview:'pending',publicationAuthorizedByUser:false};lock.expectedBuild.mainSha256=sha(main);lock.frozen.files[interceptorRel]=sha(interceptor);lock.contextOpenaiUpdate={baselineVersion:baseline.version,upstreamCommit:'4932ebb68db8',contextScanBounded:true,openaiSchemaPreserved:true,piSdk:'1.4.0',buildScript:'scripts/personal-build-context-openai-candidate.mjs',compiledSourceCommit:run('/usr/bin/git',['rev-parse','HEAD'])}
 fs.writeFileSync(path.join(out,'component-lock.json'),JSON.stringify(lock,null,2)+'\n');fs.copyFileSync(path.join(staging,'baseline.json'),path.join(out,'baseline-application-files.json'))
 run('/usr/bin/codesign',['--force','--deep','--sign','-','--preserve-metadata=entitlements,requirements,flags,runtime',app])
 run('/usr/bin/python3',['scripts/personal-app-inventory.py','--app',app,'--lock',path.join(out,'component-lock.json'),'--output',path.join(out,'application-files.json')])
 const sourceCommit=run('/usr/bin/git',['rev-parse','HEAD']),dirty=run('/usr/bin/git',['status','--porcelain'])
 fs.writeFileSync(path.join(out,'candidate-manifest.json'),JSON.stringify({schemaVersion:1,version,baselineVersion:baseline.version,sourceCommit,sourceDirty:!!dirty,...lock.expectedBuild,interceptorSha256:sha(interceptor),installed:false,published:false},null,2)+'\n')
 run('/usr/bin/python3',['scripts/personal-audit-candidate.py','--base-app',base,'--app',app,'--baseline-inventory',path.join(out,'baseline-application-files.json'),'--inventory',path.join(out,'application-files.json'),'--out',out,'--scope','context-openai'])
 console.log(JSON.stringify({version,app,installed:false,published:false}))
}finally{fs.rmSync(staging,{recursive:true,force:true})}

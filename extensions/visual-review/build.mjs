import { createRequire } from 'node:module';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const here=dirname(fileURLToPath(import.meta.url));
const local=createRequire(import.meta.url),root=createRequire(new URL('../../package.json',import.meta.url));
const {build,version}=root('esbuild');
if(version!=='0.25.12')throw new Error('Use pinned esbuild 0.25.12');
const out=resolve(process.argv[2]||join(here,'dist'));
await mkdir(out,{recursive:true});
await build({entryPoints:[join(here,'server.mjs')],outfile:join(out,'server.cjs'),bundle:true,platform:'node',format:'cjs',
  define:{'import.meta.url':'__reviewModuleURL'},banner:{js:"const __reviewModuleURL=require('node:url').pathToFileURL(__filename).href;"},logLevel:'warning'});
await build({entryPoints:[join(here,'open-review.mjs')],outfile:join(out,'open-review.cjs'),bundle:true,platform:'node',format:'cjs',logLevel:'warning'});
const files=['index.html','app.js','region-editor.js','html-bridge.js'];
for(const file of files)await copyFile(join(here,file),join(out,file));
await copyFile(local.resolve('fabric'),join(out,'fabric.js'));
// Both dependencies are pure JavaScript; no npm, Node installation or native add-ons at runtime.
const notices=['Visual Review 0.1.0 — Apache-2.0','Fabric.js 6.9.1 — MIT','pngjs 7.0.0 — MIT'];
for(const dependency of ['fabric','pngjs']){
  const start=dirname(local.resolve(dependency));
  const license=join(start,'..','LICENSE');
  notices.push(await readFile(license,'utf8'));
}
await writeFile(join(out,'THIRD-PARTY-NOTICES.txt'),notices.join('\n\n'));
const artifacts=['server.cjs','open-review.cjs',...files,'fabric.js','THIRD-PARTY-NOTICES.txt'];
const hashes={};for(const file of artifacts)hashes[file]=createHash('sha256').update(await readFile(join(out,file))).digest('hex');
await writeFile(join(out,'module-manifest.json'),JSON.stringify({schemaVersion:1,name:'@craft-agent/visual-review',version:'0.1.0',feedbackSchemaVersion:2,build:{esbuild:version},files:hashes},null,2)+'\n');
console.log(out);

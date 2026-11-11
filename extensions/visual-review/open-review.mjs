#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

async function main(){
const [outputDirectory,...files]=process.argv.slice(2);
if(!outputDirectory||!files.length){console.error('Usage: open-review.cjs FEEDBACK_DIRECTORY IMAGE_OR_HTML [...]');process.exit(2);}
try{
  const config=process.env.CRAFT_CONFIG_DIR||join(homedir(),'.craft-agent');
  const runtime=JSON.parse(await readFile(join(config,'visual-review','runtime.json'),'utf8'));
  const url=new URL(runtime.url);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||typeof runtime.token!=='string')throw new Error('Invalid review host descriptor');
  const response=await fetch(new URL('/open',url),{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${runtime.token}`},
    body:JSON.stringify({outputDirectory:resolve(outputDirectory),files:files.map(file=>resolve(file))}),signal:AbortSignal.timeout(25000)});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'Unable to open visual review');
  console.log(JSON.stringify(result,null,2));
}catch(error){console.error('无法打开内置批注工作台：'+error.message+'。请确认支持批注工作台的个人版 Craft 正在运行。');process.exitCode=1;}

}
main().catch(error=>{console.error(error.message);process.exitCode=1;});

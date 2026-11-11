import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile, rename } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { PNG } from 'pngjs';

async function main(){
const [outputDirectory, ...paths] = process.argv.slice(2);
if (!outputDirectory || !paths.length) { console.error('Usage: node server.mjs <feedback-directory> <image-or-html> [...]'); process.exit(2); }
const output = resolve(outputDirectory);
const types = { '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.html':'text/html','.htm':'text/html' };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const assets = await Promise.all(paths.map(async (path,id) => {
  const source=await realpath(path), mime=types[extname(source).toLowerCase()];
  if (!mime) throw new Error(`Unsupported file: ${source}`);
  const bytes=await readFile(source);
  return {id,source,mime,bytes,revision:sha256(bytes),name:basename(source)};
}));
const token=randomUUID();
const fabricAsset=process.env.CRAFT_VISUAL_REVIEW_BUNDLED==='1'?'fabric.js':'node_modules/fabric/dist/index.min.js';
await mkdir(output,{recursive:true});
await mkdir(resolve(output,'drafts'),{recursive:true});
const draftPath=asset=>resolve(output,'drafts',sha256(asset.source+'\n'+asset.revision)+'.json');
async function atomic(path,data) { const tmp=path+'.'+randomUUID()+'.part'; await writeFile(tmp,data,{mode:0o600}); await rename(tmp,path); }
function send(r,status,type,body) { r.writeHead(status,{'Content-Type':type,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});r.end(body); }
const json=(r,status,body)=>send(r,status,'application/json; charset=utf-8',JSON.stringify(body));
async function body(req) { let size=0;const parts=[];for await(const part of req){size+=part.length;if(size>32_000_000)throw new Error('批注超过 32MB，请减少选区或拆分批次');parts.push(part);}return JSON.parse(Buffer.concat(parts)); }
function dimensions(a) { return Number.isInteger(a.width)&&Number.isInteger(a.height)&&a.width>0&&a.height>0&&a.width<=12000&&a.height<=12000&&a.width*a.height<=32_000_000; }
function validOperations(a) {
  if(!Array.isArray(a.operations)||a.operations.length>400)return false;
  let total=0;
  return a.operations.every(op=>['brush','erase','rect'].includes(op.tool)&&Number.isFinite(op.width)&&op.width>0&&op.width<=2000&&
    Array.isArray(op.points)&&op.points.length>0&&(total+=op.points.length)<=60000&&
    (op.tool!=='rect'||op.points.length===2)&&op.points.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&p[0]>=0&&p[1]>=0&&p[0]<a.width&&p[1]<a.height));
}
function validAnchor(a,mime) {
  if(!a||typeof a!=='object')return false;
  if(a.kind==='region')return dimensions(a)&&validOperations(a)&&typeof a.maskData==='string'&&a.maskData.length<12_000_000&&
    (mime!=='text/html'||(a.space==='html-document'&&a.viewport&&Number.isFinite(a.viewport.width)&&Number.isFinite(a.viewport.height)));
  if(mime==='text/html') {
    if(a.kind==='point')return a.space==='html-document'&&dimensions(a)&&Number.isFinite(a.x)&&Number.isFinite(a.y)&&a.x>=0&&a.x<a.width&&a.y>=0&&a.y<a.height;
    if(!['element','text-range'].includes(a.kind)||typeof a.selector!=='string'||a.selector.length<1||a.selector.length>2000)return false;
    if(a.kind==='element')return true;
    return typeof a.quote==='string'&&a.quote.trim().length>0&&a.quote.length<=12000&&
      [a.start,a.end].every(p=>p&&Array.isArray(p.path)&&p.path.length<=100&&p.path.every(n=>Number.isInteger(n)&&n>=0)&&Number.isInteger(p.offset)&&p.offset>=0);
  }
  return ['point','rect','line','text'].includes(a.kind)&&['x','y',...(['rect','line'].includes(a.kind)?['x2','y2']:[])].every(k=>Number.isFinite(a[k])&&a[k]>=0&&a[k]<=50000);
}
function validEntries(list,mime) { return Array.isArray(list)&&list.length<=100&&list.every(item=>['feedback','overlay'].includes(item.intent)&&typeof item.text==='string'&&item.text.trim().length>0&&item.text.length<=4000&&validAnchor(item.anchor,mime)); }
function decodeMask(a,asset) {
  const prefix='data:image/png;base64,';
  if(!a.maskData.startsWith(prefix))throw new Error('选区需要 PNG 蒙版');
  const bytes=Buffer.from(a.maskData.slice(prefix.length),'base64');
  if(bytes.length<24||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.readUInt32BE(16)!==a.width||bytes.readUInt32BE(20)!==a.height)throw new Error('蒙版尺寸不一致');
  if(asset.mime==='image/png'&&(asset.bytes.readUInt32BE(16)!==a.width||asset.bytes.readUInt32BE(20)!==a.height))throw new Error('蒙版必须对应原图尺寸');
  const png=PNG.sync.read(bytes), mask=new PNG({width:a.width,height:a.height}), markup=new PNG({width:a.width,height:a.height});
  let count=0,x0=a.width,y0=a.height,x1=-1,y1=-1;
  for(let p=0;p<png.data.length;p+=4){
    const selected=png.data[p+3]>=128;
    mask.data[p]=mask.data[p+1]=mask.data[p+2]=selected?255:0;mask.data[p+3]=255;
    markup.data[p]=216;markup.data[p+1]=65;markup.data[p+2]=35;markup.data[p+3]=selected?100:0;
    if(selected){const i=p/4,x=i%a.width,y=Math.floor(i/a.width);count++;x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
  }
  if(!count)throw new Error('选区为空，请先涂抹或框选');
  return {mask:PNG.sync.write(mask),markup:PNG.sync.write(markup),bbox:{x:x0,y:y0,width:x1-x0+1,height:y1-y0+1},selectedPixels:count};
}
const server=createServer(async(req,res)=>{
  const origin=`http://127.0.0.1:${server.address().port}`;
  if(req.headers.host!==new URL(origin).host)return json(res,403,{error:'无效的主机'});
  const url=new URL(req.url,origin), relative=url.pathname.startsWith(`/${token}/`)?url.pathname.slice(token.length+2):null;
  if(relative===null)return json(res,404,{error:'未找到'});
  try{
    if(req.method==='GET'){
      const files={'':['index.html','text/html; charset=utf-8'],'app.js':['app.js','text/javascript'],'region-editor.js':['region-editor.js','text/javascript'],'html-bridge.js':['html-bridge.js','text/javascript'],'fabric.js':[fabricAsset,'text/javascript']};
      if(files[relative]){const [path,type]=files[relative];return send(res,200,type,await readFile(new URL(path,import.meta.url)));}
      if(relative==='assets')return json(res,200,assets.map(({id,mime,revision,name})=>({id,mime,revision,name})));
      const match=relative.match(/^(asset|draft)\/(\d+)$/), asset=match&&assets[Number(match[2])];
      if(asset&&match[1]==='asset')return send(res,200,asset.mime==='text/html'?'text/plain; charset=utf-8':asset.mime,asset.bytes);
      if(asset&&match[1]==='draft'){
        try{return send(res,200,'application/json',await readFile(draftPath(asset)));}catch(e){if(e.code!=='ENOENT')throw e;return json(res,200,null);}
      }
    }
    if(req.method==='POST'&&['feedback','draft'].includes(relative)){
      if(req.headers.origin!==origin||!req.headers['content-type']?.startsWith('application/json'))return json(res,403,{error:'无效的提交来源'});
      const input=await body(req), asset=Number.isInteger(input.assetId)&&assets[input.assetId];
      if(!asset||asset.revision!==input.revision||sha256(await readFile(asset.source))!==asset.revision)return json(res,409,{error:'文件版本已变化，请重新打开工作台'});
      if(!validEntries(input.annotations,asset.mime))return json(res,400,{error:'批注位置或内容无效'});
      if(relative==='draft'){
        if(typeof input.note!=='string'||input.note.length>4000||!Array.isArray(input.pendingOperations)||input.pendingOperations.length>400)return json(res,400,{error:'草稿无效'});
        await atomic(draftPath(asset),JSON.stringify(input));return json(res,200,{saved:true});
      }
      if(!input.annotations.length)return json(res,400,{error:'请先加入批注'});
      // Validate every bitmap before writing any submission artifact.
      const decoded=input.annotations.map(item=>item.anchor.kind==='region'?decodeMask(item.anchor,asset):null);
      const submissionId=randomUUID(), annotations=[];
      for(const [index,item]of input.annotations.entries()){
        const entry=structuredClone(item), a=entry.anchor, region=decoded[index];
        if(region){
          const maskPath=resolve(output,`${submissionId}-${index}-mask.png`),markupPath=resolve(output,`${submissionId}-${index}-markup.png`);
          await atomic(maskPath,region.mask);await atomic(markupPath,region.markup);
          delete a.maskData;Object.assign(a,{maskPath,markupPath,bbox:region.bbox,selectedPixels:region.selectedPixels,maskConvention:'white-selected-black-unselected'});
        }
        annotations.push(entry);
      }
      const feedback={schemaVersion:2,submissionId,asset:{path:asset.source,mime:asset.mime,revision:asset.revision},createdAt:new Date().toISOString(),annotations};
      const path=resolve(output,`${submissionId}.json`);await atomic(path,JSON.stringify(feedback,null,2)+'\n');
      return json(res,201,{submissionId,path,prompt:`请读取这个本地批注批次，核对文件版本，按文字范围或区域蒙版修改并交付可继续批注的新版：${path}`});
    }
    json(res,404,{error:'未找到'});
  }catch(error){json(res,400,{error:error.message});}
});
server.listen(0,'127.0.0.1',()=>console.log(`http://127.0.0.1:${server.address().port}/${token}/`));

}
main().catch(error=>{console.error(error.message);process.exitCode=1;});

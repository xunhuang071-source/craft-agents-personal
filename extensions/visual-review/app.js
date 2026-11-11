import { RegionEditor } from './region-editor.js';
import { installHtmlReview } from './html-bridge.js';
const ids=['asset','mode','brush','brush-value','brush-label','undo','redo','clear','visibility','smaller','larger','hint','stage','target','note','add','save-draft','draft-state','notes','submit','status','transfer','handoff','copy'];
const ui=Object.fromEntries(ids.map(id=>[id,document.getElementById(id)]));
const assets=await(await fetch('assets')).json();
let active,editor,scene,frame,channel,anchor=null,operations=[],annotations=[],scale=1,image,wrap,loading=0,ready=false,timer,saving=Promise.resolve();
const requests=new Map();
const brief=a=>a.kind==='text-range'?`文字「${a.quote}」` : a.kind==='element'?`元素 ${a.selector}` : a.kind==='region'?`区域 · ${a.operations?.length||0} 笔` : `点位 (${a.x}, ${a.y})`;
const tell=data=>frame?.contentWindow.postMessage({channel,...data},'*');
function pick(value){anchor=value;ui.target.textContent=value?brief(value):'选择文字，或涂抹你想修改的区域。';ui.add.disabled=!value||(value.kind==='region'&&!value.operations?.length);}
function accept(value){if(value.kind==='region')operations=value.operations;pick(value);schedule();}
function draft(){return{assetId:active.id,revision:active.revision,annotations,note:ui.note.value,pendingOperations:operations,pendingAnchor:anchor,mode:ui.mode.value};}
async function saveDraft(){
  if(!ready)return;
  const payload=JSON.stringify(draft());
  // Serialize writes so a slow older request cannot overwrite the newest draft.
  saving=saving.catch(()=>{}).then(async()=>{
    const r=await fetch('draft',{method:'POST',headers:{'Content-Type':'application/json'},body:payload});
    const result=await r.json();if(!r.ok)throw new Error(result.error);
    ui['draft-state'].textContent='草稿已保存在本机。';
  });
  try{await saving;}catch(e){ui['draft-state'].textContent='草稿未保存：'+e.message;}
}
function schedule(){if(!ready)return;clearTimeout(timer);ui['draft-state'].textContent='正在保存草稿…';timer=setTimeout(saveDraft,650);}
function configure(){
  const mode=ui.mode.value,size=Number(ui.brush.value);
  ui['brush-value'].value=size;
  ui['brush-label'].hidden=!['brush','erase'].includes(mode);
  ui.hint.textContent=mode==='text-range'?'拖动选择几个字或一句话，再填写修改要求。':mode==='element'?'点击要修改的页面元素。':'涂到哪里就选中哪里；多笔可组成一个区域，橡皮擦仅扣除选区。';
  if(editor){editor.tool=mode;editor.brushSize=size/scale;const diameter=Math.min(124,size+4);const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${diameter}" height="${diameter}"><circle cx="50%" cy="50%" r="${size/2}" fill="none" stroke="black" stroke-width="1"/></svg>`;editor.canvas.style.cursor=['brush','erase'].includes(mode)?`url("data:image/svg+xml,${encodeURIComponent(svg)}") ${diameter/2} ${diameter/2}, crosshair`:'crosshair';}
  tell({type:'configure',mode,size});
}
function list(){
  ui.notes.replaceChildren();
  for(const [index,item]of annotations.entries()){
    const li=document.createElement('li');li.textContent=brief(item.anchor)+' · '+item.text;
    const edit=document.createElement('button');edit.textContent='编辑';edit.onclick=()=>{
      const value=annotations.splice(index,1)[0];ui.note.value=value.text;operations=structuredClone(value.anchor.operations||[]);
      if(value.anchor.kind==='region'){ui.mode.value='brush';if(editor)editor.restore(operations);tell({type:'restore',operations});}
      else {if(editor)editor.restore([]);tell({type:'restore',operations:[]});ui.mode.value=value.anchor.kind==='text-range'?'text-range':value.anchor.kind==='element'?'element':'point';}
      pick(value.anchor);configure();list();schedule();
    };
    const remove=document.createElement('button');remove.textContent='移除';remove.onclick=()=>{annotations.splice(index,1);list();schedule();};
    li.append(document.createElement('br'),edit,remove);ui.notes.append(li);
  }
  ui.submit.disabled=!annotations.length;
}
function resize(next){if(!scene||!image)return;scale=next;scene.setDimensions({width:Math.round(image.width*scale),height:Math.round(image.height*scale)});scene.setZoom(scale);wrap.style.width=Math.round(image.width*scale)+'px';wrap.style.height=Math.round(image.height*scale)+'px';configure();}
async function html(source,ticket){
  const doc=new DOMParser().parseFromString(source,'text/html');
  for(const node of doc.querySelectorAll('base,meta[http-equiv],iframe,object,embed,script'))node.remove();
  const bridge=doc.createElement('script');channel=crypto.randomUUID();
  bridge.textContent=`const RegionEditor=${RegionEditor.toString()};(${installHtmlReview.toString()})(RegionEditor,${JSON.stringify(channel)}).catch(error=>parent.postMessage({channel:${JSON.stringify(channel)},type:'error',message:error.message},'*'));`;
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(bridge.textContent));
  if(ticket!==loading)return;
  const policy=doc.createElement('meta');policy.httpEquiv='Content-Security-Policy';policy.content=`default-src 'none'; script-src 'sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; form-action 'none'; base-uri 'none'`;
  doc.head.prepend(policy);doc.head.append(bridge);
  frame=document.createElement('iframe');frame.title='HTML 文字与图形批注';frame.setAttribute('sandbox','allow-scripts');frame.style.width='900px';frame.style.height='680px';frame.srcdoc='<!doctype html>'+doc.documentElement.outerHTML;ui.stage.append(frame);
}
addEventListener('message',event=>{
  if(!frame||event.source!==frame.contentWindow||event.data?.channel!==channel)return;
  const data=event.data;
  if(data.type==='error')ui.status.textContent=data.message;
  if(data.type==='ready'){tell({type:'restore',operations});configure();}
  if(data.type==='anchor')accept(data.anchor);
  if(data.type==='export'){const done=requests.get(data.requestId);if(done){requests.delete(data.requestId);done(data.anchor);}}
});
async function exportAnchor(){
  if(anchor?.kind!=='region')return structuredClone(anchor);
  if(editor)return editor.export();
  return new Promise((resolve,reject)=>{const requestId=crypto.randomUUID();const timeout=setTimeout(()=>{requests.delete(requestId);reject(new Error('HTML 选区尚未就绪，请稍后重试'));},5000);requests.set(requestId,value=>{clearTimeout(timeout);resolve(value);});tell({type:'export',requestId});});
}
async function openAsset(){
  clearTimeout(timer);if(ready)await saveDraft();ready=false;const ticket=++loading;
  if(scene)await scene.dispose();scene=editor=frame=image=wrap=null;channel=null;
  active=assets[Number(ui.asset.value)];ui.stage.replaceChildren();ui.transfer.hidden=true;ui.status.textContent='';
  annotations=[];operations=[];ui.note.value='';pick(null);
  for(const option of ui.mode.options)option.disabled=active.mime!=='text/html'&&['text-range','element'].includes(option.value);
  ui.smaller.hidden=ui.larger.hidden=active.mime==='text/html';
  const stored=await(await fetch(`draft/${active.id}`)).json();if(ticket!==loading)return;
  if(stored){annotations=stored.annotations||[];operations=stored.pendingOperations||[];ui.note.value=stored.note||'';pick(stored.pendingAnchor||null);}
  ui.mode.value=stored?.mode||(active.mime==='text/html'?'text-range':'brush');
  if(active.mime==='text/html')await html(await(await fetch(`asset/${active.id}`)).text(),ticket);
  else{
    const loaded=await fabric.FabricImage.fromURL(`asset/${active.id}`);if(ticket!==loading)return;
    image=loaded;image.set({selectable:false,evented:false});
    wrap=document.createElement('div');wrap.className='image-wrap';ui.stage.append(wrap);
    const base=document.createElement('canvas');wrap.append(base);
    scene=new fabric.StaticCanvas(base,{enableRetinaScaling:false});scene.add(image);
    const overlay=document.createElement('canvas');wrap.append(overlay);
    editor=new RegionEditor(overlay,image.width,image.height,accept);editor.restore(operations);
    resize(Math.min(1,(ui.stage.clientWidth-12)/image.width,650/image.height));
  }
  if(ticket!==loading)return;ready=true;configure();list();ui['draft-state'].textContent=stored?'已恢复本机草稿。':'草稿会自动保存在本机。';
}
for(const item of assets)ui.asset.add(new Option(item.name,item.id));
const requested=new URLSearchParams(location.search).get('asset');if(assets.some(a=>String(a.id)===requested))ui.asset.value=requested;
ui.asset.onchange=()=>openAsset().catch(e=>ui.status.textContent=e.message);
ui.mode.onchange=()=>{configure();schedule();};ui.brush.oninput=configure;
for(const name of ['undo','redo','clear','visibility'])ui[name].onclick=()=>{if(editor)editor.command(name);else tell({type:'command',command:name});};
ui.smaller.onclick=()=>resize(Math.max(.1,scale/1.25));ui.larger.onclick=()=>resize(Math.min(3,scale*1.25));
ui.note.oninput=schedule;ui['save-draft'].onclick=saveDraft;
ui.add.onclick=async()=>{
  const text=ui.note.value.trim();if(!text){ui.note.focus();return;}
  try{
    const value=await exportAnchor();if(!value)throw new Error('选区为空，请先选择区域。');
    annotations.push({intent:'feedback',text,anchor:value});operations=[];pick(null);ui.note.value='';
    if(editor)editor.restore([]);tell({type:'restore',operations:[]});list();await saveDraft();
  }catch(e){ui.status.textContent=e.message;}
};
ui.submit.onclick=async()=>{
  ui.submit.disabled=true;
  try{
    await saveDraft();const response=await fetch('feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({assetId:active.id,revision:active.revision,annotations})});const result=await response.json();if(!response.ok)throw new Error(result.error);
    ui.handoff.value=result.prompt;ui.transfer.hidden=false;ui.status.textContent=`已保存 ${annotations.length} 条批注。复制指令回到当前对话。`;
  }catch(e){ui.status.textContent=e.message;}finally{list();}
};
ui.copy.onclick=async()=>{ui.handoff.select();try{await navigator.clipboard.writeText(ui.handoff.value);ui.status.textContent='回传指令已复制。';}catch{ui.status.textContent='回传指令已选中，可以手动复制。';}};
try{await openAsset();}catch(error){ui.status.textContent=error.message;}

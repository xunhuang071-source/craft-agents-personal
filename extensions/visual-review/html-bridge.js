// Serialized into a sandboxed frame; no filesystem/network capabilities.
export async function installHtmlReview(RegionEditor, channel) {
  await Promise.all([...document.images].map(img=>img.decode().catch(()=>{})));
  await document.fonts.ready;
  const root=document.body;
  const overlay=document.createElement('canvas');
  overlay.dataset.reviewUi='true';
  Object.assign(overlay.style,{position:'absolute',left:'0',top:'0',zIndex:'2147483646',pointerEvents:'none'});
  const width=Math.max(innerWidth,document.documentElement.scrollWidth), height=Math.max(innerHeight,document.documentElement.scrollHeight);
  document.documentElement.append(overlay);
  overlay.style.width=width+'px';overlay.style.height=height+'px';
  const viewport={width:innerWidth,height:innerHeight,documentWidth:width,documentHeight:height};
  let mode='text-range';
  const post=data=>parent.postMessage({channel,...data},'*');
  function selector(element){
    const parts=[];
    for(let node=element;node&&node.nodeType===1;node=node.parentElement){
      if(node.id&&document.querySelectorAll('#'+CSS.escape(node.id)).length===1){parts.unshift('#'+CSS.escape(node.id));break;}
      let index=1;for(let previous=node.previousElementSibling;previous;previous=previous.previousElementSibling)if(previous.localName===node.localName)index++;
      parts.unshift(node.localName+':nth-of-type('+index+')');
    }
    return parts.join(' > ');
  }
  function path(node){const indices=[];for(let n=node;n&&n!==root;n=n.parentNode)indices.unshift([...n.parentNode.childNodes].indexOf(n));return indices;}
  function bounds(element){const r=element.getBoundingClientRect();return{x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height};}
  function context(box){
    if(!box)return[];
    return [...root.querySelectorAll('img,svg,canvas,h1,h2,h3,p,button,a')].filter(e=>{
      const b=bounds(e);return b.width&&b.height&&b.x<box.x+box.width&&b.x+b.width>box.x&&b.y<box.y+box.height&&b.y+b.height>box.y;
    }).slice(0,24).map(e=>({selector:selector(e),tag:e.localName,text:(e.textContent||e.getAttribute('alt')||'').slice(0,300),bbox:bounds(e),
      ...(e instanceof HTMLImageElement?{image:{naturalWidth:e.naturalWidth,naturalHeight:e.naturalHeight,objectFit:getComputedStyle(e).objectFit,objectPosition:getComputedStyle(e).objectPosition}}:{})}));
  }
  const editor=new RegionEditor(overlay,width,height,value=>{
    if(value.kind==='point'){
      overlay.style.pointerEvents='none';
      const element=document.elementFromPoint(value.x-scrollX,value.y-scrollY);
      overlay.style.pointerEvents='auto';
      value.elements=element?[{selector:selector(element),tag:element.localName,bbox:bounds(element),text:(element.textContent||element.getAttribute('alt')||'').slice(0,300)}]:[];
    }
    post({type:'anchor',anchor:{...value,space:'html-document',viewport}});
  });
  function captureText(){
    if(mode!=='text-range')return;
    const selection=getSelection();
    if(!selection?.rangeCount||selection.isCollapsed)return;
    const range=selection.getRangeAt(0);
    if(!root.contains(range.startContainer)||!root.contains(range.endContainer))return;
    const quote=selection.toString();if(!quote.trim()||quote.length>12000)return;
    const common=range.commonAncestorContainer.nodeType===1?range.commonAncestorContainer:range.commonAncestorContainer.parentElement;
    const element=common.closest('[id]')||common;
    const rects=[...range.getClientRects()].slice(0,100).map(r=>({x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height}));
    const before=range.cloneRange();before.selectNodeContents(root);before.setEnd(range.startContainer,range.startOffset);
    const after=range.cloneRange();after.selectNodeContents(root);after.setStart(range.endContainer,range.endOffset);
    post({type:'anchor',anchor:{kind:'text-range',selector:selector(element),quote,prefix:before.toString().slice(-40),suffix:after.toString().slice(0,40),
      start:{path:path(range.startContainer),offset:range.startOffset},end:{path:path(range.endContainer),offset:range.endOffset},
      offsetEncoding:'utf-16',root:'body',viewport,rects,context:element.textContent.slice(0,1000)}});
  }
  document.addEventListener('mouseup',()=>setTimeout(captureText,0));
  document.addEventListener('keyup',captureText);
  document.addEventListener('click',event=>{
    if(overlay===event.target)return;
    if(event.target.closest('a,button'))event.preventDefault();
    if(mode!=='element')return;
    const element=event.target;
    post({type:'anchor',anchor:{kind:'element',selector:selector(element),text:element.textContent.trim().slice(0,300),bbox:bounds(element),viewport}});
  },true);
  addEventListener('message',event=>{
    if(event.source!==parent||event.data?.channel!==channel)return;
    const data=event.data;
    if(data.type==='configure'){
      mode=data.mode;editor.tool=mode;editor.brushSize=data.size;
      overlay.style.pointerEvents=['brush','erase','rect','point'].includes(mode)?'auto':'none';
      overlay.style.cursor=mode==='brush'||mode==='erase'?`url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${Math.min(120,data.size+4)}' height='${Math.min(120,data.size+4)}'><circle cx='50%' cy='50%' r='${Math.min(58,data.size/2)}' fill='none' stroke='black'/></svg>`)}") ${Math.min(60,(data.size+4)/2)} ${Math.min(60,(data.size+4)/2)}, crosshair`:'crosshair';
    }
    if(data.type==='command')editor.command(data.command);
    if(data.type==='restore')editor.restore(data.operations||[]);
    if(data.type==='export'){
      const value=editor.export();
      post({type:'export',requestId:data.requestId,anchor:value?{...value,space:'html-document',viewport,elements:context(value.bbox)}:null});
    }
  });
  post({type:'ready',viewport});
}

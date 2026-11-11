// The class is also injected into the isolated HTML preview. Keep it self-contained.
export class RegionEditor {
  constructor(canvas, width, height, onChange = () => {}) {
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>12000||height>12000||width*height>32000000)throw new Error('画面尺寸过大，请拆分页面或缩小图片后再批注。');
    this.canvas = canvas;
    this.canvas.width = width;
    this.canvas.height = height;
    this.mask = document.createElement('canvas');
    this.mask.width = width;
    this.mask.height = height;
    this.width = width;
    this.height = height;
    this.ops = [];
    this.redoStack = [];
    this.tool = 'brush';
    this.brushSize = 40;
    this.visible = true;
    this.onChange = onChange;
    this.canvas.style.touchAction = 'none';
    this.canvas.addEventListener('pointerdown', e => this.down(e));
    this.canvas.addEventListener('pointermove', e => this.move(e));
    this.canvas.addEventListener('pointerup', e => this.up(e));
    this.canvas.addEventListener('pointercancel', () => { this.current = null; this.render(); });
  }
  point(e) {
    const r = this.canvas.getBoundingClientRect();
    return [Math.max(0, Math.min(this.width - 1, (e.clientX - r.left) * this.width / r.width)),
      Math.max(0, Math.min(this.height - 1, (e.clientY - r.top) * this.height / r.height))];
  }
  down(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    this.selectedPoint = null;
    this.current = { tool: this.tool, width: this.brushSize, points: [this.point(e)] };
    this.render();
  }
  move(e) {
    if (!this.current) return;
    const merged = e.getCoalescedEvents?.();
    const events = merged?.length ? merged : [e];
    for (const event of events) {
      const p = this.point(event), prev = this.current.points.at(-1);
      if (Math.hypot(p[0] - prev[0], p[1] - prev[1]) >= .5) {
        if (this.current.tool === 'rect') this.current.points[1] = p;
        else if (this.current.points.length < 12000) this.current.points.push(p);
      }
    }
    this.render();
  }
  up(e) {
    if (!this.current) return;
    if (this.current.tool === 'point') {
      const [x, y] = this.point(e);
      this.current = null;
      this.selectedPoint = [x,y];
      this.render();
      this.onChange({ kind: 'point', x: Math.round(x), y: Math.round(y), width: this.width, height: this.height });
      return;
    }
    if (this.current.tool === 'rect' && this.current.points.length < 2) this.current = null;
    if (this.current) { this.ops.push(this.current); this.current = null; this.redoStack = []; }
    this.render();
    this.changed();
  }
  draw(ctx, op) {
    ctx.save();
    ctx.globalCompositeOperation = op.tool === 'erase' ? 'destination-out' : 'source-over';
    ctx.fillStyle = ctx.strokeStyle = '#fff';
    ctx.lineWidth = op.width;
    ctx.lineCap = ctx.lineJoin = 'round';
    if (op.tool === 'rect') {
      if (op.points.length === 2) {
        const [a,b] = op.points;
        ctx.fillRect(Math.min(a[0],b[0]), Math.min(a[1],b[1]), Math.abs(a[0]-b[0]), Math.abs(a[1]-b[1]));
      }
    } else if (op.tool !== 'point') {
      const [first, ...others] = op.points;
      ctx.beginPath();
      if (!others.length) { ctx.arc(first[0], first[1], op.width/2, 0, 2*Math.PI); ctx.fill(); }
      else { ctx.moveTo(...first); for (const point of others) ctx.lineTo(...point); ctx.stroke(); }
    }
    ctx.restore();
  }
  render() {
    const m = this.mask.getContext('2d');
    m.clearRect(0,0,this.width,this.height);
    for (const op of this.ops) this.draw(m,op);
    if (this.current) this.draw(m,this.current);
    const ctx = this.canvas.getContext('2d');
    ctx.clearRect(0,0,this.width,this.height);
    if (!this.visible) return;
    ctx.drawImage(this.mask,0,0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = 'rgba(216,65,35,.38)';
    ctx.fillRect(0,0,this.width,this.height);
    ctx.globalCompositeOperation = 'source-over';
    if(this.selectedPoint){
      const [x,y]=this.selectedPoint;
      ctx.strokeStyle='#9d2e18';ctx.lineWidth=Math.max(2,this.width/500);
      ctx.beginPath();ctx.arc(x,y,Math.max(8,this.width/100),0,2*Math.PI);ctx.stroke();
    }
  }
  changed() { this.onChange({ kind: 'region', width: this.width, height: this.height, operations: structuredClone(this.ops) }); }
  command(name) {
    this.current = null;
    if (name === 'undo' && this.ops.length) this.redoStack.push(this.ops.pop());
    if (name === 'redo' && this.redoStack.length) this.ops.push(this.redoStack.pop());
    if (name === 'clear') { this.ops = []; this.redoStack = []; this.selectedPoint = null; }
    if (name === 'visibility') this.visible = !this.visible;
    this.render(); this.changed();
  }
  restore(ops = []) { this.selectedPoint = null; this.ops = structuredClone(ops); this.redoStack = []; this.current = null; this.render(); }
  export() {
    // Threshold once so overlapping strokes and preview opacity don't alter selection semantics.
    const ctx = this.mask.getContext('2d'), pixels = ctx.getImageData(0,0,this.width,this.height);
    let x0=this.width, y0=this.height, x1=-1,y1=-1, count=0;
    for (let p=0;p<pixels.data.length;p+=4) {
      const selected = pixels.data[p+3] >= 128;
      pixels.data[p]=pixels.data[p+1]=pixels.data[p+2]=255;
      pixels.data[p+3]=selected?255:0;
      if (selected) { const i=p/4,x=i%this.width,y=Math.floor(i/this.width);x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);count++; }
    }
    if (!count) return null;
    const binary=document.createElement('canvas');binary.width=this.width;binary.height=this.height;
    binary.getContext('2d').putImageData(pixels,0,0);
    return {kind:'region',width:this.width,height:this.height,bbox:{x:x0,y:y0,width:x1-x0+1,height:y1-y0+1},
      operations:structuredClone(this.ops),maskData:binary.toDataURL('image/png'),selectedPixels:count};
  }
}

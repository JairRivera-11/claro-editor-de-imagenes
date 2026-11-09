// Motor de pincel compartido con pruebas: solo modifica una máscara de 8 bits.
// Historial por teselas para que un trazo pequeño no copie fotografías completas.
export class MaskBrush {
  constructor(alpha, width, height, budget = 64 * 1024 * 1024) {
    if (alpha.length !== width * height) throw new Error('Máscara inválida.');
    this.alpha = new Uint8ClampedArray(alpha); this.width = width; this.height = height;
    this.budget = budget; this.undoStack = []; this.redoStack = []; this.bytes = 0; this.stroke = null;
  }
  begin(mode, radius, softness) {
    if (this.stroke || !['erase', 'restore'].includes(mode) || !Number.isFinite(radius) || radius < 0.5 || radius > 500 || !Number.isFinite(softness) || softness < 0 || softness > 1) throw new Error('Pincel inválido.');
    this.stroke = { mode, radius, softness, tiles: new Map(), last: null };
  }
  tile(x, y) {
    const tx = Math.floor(x / 64) * 64, ty = Math.floor(y / 64) * 64;
    const key = ty * this.width + tx;
    if (!this.stroke.tiles.has(key)) {
      const w = Math.min(64, this.width - tx), h = Math.min(64, this.height - ty);
      const before = new Uint8ClampedArray(w * h);
      for (let row = 0; row < h; row++) before.set(this.alpha.subarray((ty+row)*this.width+tx, (ty+row)*this.width+tx+w), row*w);
      this.stroke.tiles.set(key, { x: tx, y: ty, w, h, before });
    }
    return this.stroke.tiles.get(key);
  }
  dab(cx, cy) {
    const { radius, softness, mode } = this.stroke, hard = radius * (1 - softness);
    const left = Math.max(0, Math.floor(cx-radius)), right = Math.min(this.width-1, Math.ceil(cx+radius));
    const top = Math.max(0, Math.floor(cy-radius)), bottom = Math.min(this.height-1, Math.ceil(cy+radius));
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
      const d = Math.hypot(x+0.5-cx, y+0.5-cy);
      if (d >= radius) continue;
      const t = d <= hard ? 1 : (radius-d)/(radius-hard);
      const opacity = t*t*(3-2*t); // caída suave y continua, sin escalón en el contorno
      const tile = this.tile(x,y), base = tile.before[(y-tile.y)*tile.w+x-tile.x];
      const index = y*this.width+x;
      const value = Math.round(mode === 'erase' ? base*(1-opacity) : base+(255-base)*opacity);
      // La superposición dentro del mismo trazo no acumula opacidad según los FPS.
      this.alpha[index] = mode === 'erase' ? Math.min(this.alpha[index],value) : Math.max(this.alpha[index],value);
    }
  }
  move(x, y) {
    if (!this.stroke || !Number.isFinite(x) || !Number.isFinite(y)) return;
    x = Math.max(-this.stroke.radius, Math.min(this.width+this.stroke.radius,x));
    y = Math.max(-this.stroke.radius, Math.min(this.height+this.stroke.radius,y));
    const previous = this.stroke.last || { x, y };
    const steps = Math.max(1, Math.ceil(Math.hypot(x-previous.x,y-previous.y)/Math.max(0.5,this.stroke.radius/4)));
    for (let i=1;i<=steps;i++) this.dab(previous.x+(x-previous.x)*i/steps,previous.y+(y-previous.y)*i/steps);
    this.stroke.last = {x,y};
  }
  end() {
    if (!this.stroke) return false;
    const tiles = [];
    for (const tile of this.stroke.tiles.values()) {
      const after = new Uint8ClampedArray(tile.w*tile.h);
      for (let row=0;row<tile.h;row++) after.set(this.alpha.subarray((tile.y+row)*this.width+tile.x,(tile.y+row)*this.width+tile.x+tile.w),row*tile.w);
      if (after.some((v,i)=>v!==tile.before[i])) tiles.push({...tile,after});
    }
    this.stroke = null;
    if (!tiles.length) return false;
    this.redoStack = [];
    this.undoStack.push(tiles);
    this.bytes = this.undoStack.reduce((sum,entry)=>sum+entry.reduce((n,t)=>n+t.before.length*2,0),0);
    while (this.bytes > this.budget && this.undoStack.length > 1) this.bytes -= this.undoStack.shift().reduce((n,t)=>n+t.before.length*2,0);
    return true;
  }
  apply(tiles, key) {
    for (const t of tiles) for (let row=0;row<t.h;row++) this.alpha.set(t[key].subarray(row*t.w,(row+1)*t.w),(t.y+row)*this.width+t.x);
  }
  undo() { if (this.stroke) return; const entry=this.undoStack.pop(); if (entry) {this.apply(entry,'before');this.redoStack.push(entry);} }
  redo() { if (this.stroke) return; const entry=this.redoStack.pop(); if (entry) {this.apply(entry,'after');this.undoStack.push(entry);} }
}

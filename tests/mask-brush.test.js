import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MaskBrush } from '../public/mask-brush.js';

test('pincel borra/restaura solo la máscara, con borde suave y fuera del trazo intacto', () => {
  const original=new Uint8Array(10000).fill(255), brush=new MaskBrush(original,100,100);
  brush.begin('erase',10,0.5);brush.move(50.5,50.5);brush.end();
  assert.equal(brush.alpha[50*100+50],0);assert.equal(brush.alpha[50*100+70],255);
  assert.ok(brush.alpha[50*100+58]>0&&brush.alpha[50*100+58]<255);
  assert.ok(original.every(v=>v===255));
  const erased=brush.alpha.slice();
  brush.begin('restore',4,0);brush.move(50.5,50.5);brush.end();
  assert.equal(brush.alpha[50*100+50],255);assert.equal(brush.alpha[50*100+58],erased[50*100+58]);
  brush.undo();assert.deepEqual(brush.alpha,erased);brush.undo();assert.deepEqual(brush.alpha,new Uint8ClampedArray(original));
  brush.redo();assert.deepEqual(brush.alpha,erased);
});
test('trazos continuos sin huecos y sin acumulación por eventos repetidos',()=>{
  const brush=new MaskBrush(new Uint8Array(10000).fill(255),100,100);
  brush.begin('erase',3,0);brush.move(10.5,50.5);brush.move(90.5,50.5);brush.end();
  for(let x=10;x<=90;x++)assert.equal(brush.alpha[50*100+x],0);
  brush.begin('erase',8,1);brush.move(30.5,30.5);const once=brush.alpha.slice();
  for(let i=0;i<20;i++)brush.move(30.5,30.5);
  assert.deepEqual(brush.alpha,once);brush.end();
});
test('un trazo nuevo invalida rehacer y el historial elimina entradas antiguas al llegar al límite',()=>{
  const brush=new MaskBrush(new Uint8Array(16384).fill(255),128,128,8192);
  for(const x of [10,70,20]){brush.begin('erase',3,0);brush.move(x,10);brush.end();}
  assert.equal(brush.undoStack.length,1);
  brush.undo();assert.equal(brush.redoStack.length,1);
  brush.begin('erase',3,0);brush.move(90,90);brush.end();assert.equal(brush.redoStack.length,0);
  assert.throws(()=>brush.begin('erase',Infinity,1));
});

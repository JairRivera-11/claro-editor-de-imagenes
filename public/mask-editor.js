import { MaskBrush } from './mask-brush.js';

export function createMaskEditor({ loadImage, save, applied }) {
  const $ = id => document.getElementById(id), dialog = $('mask-dialog'), canvas = $('mask-canvas');
  let brush, original, before, rendered, pointer, frame, saving = false;
  const message = (text, error = false) => { $('mask-status').textContent = text; $('mask-status').classList.toggle('error', error); };
  function render() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (!brush) return;
      const mode = $('mask-compare').value;
      const alpha = mode === 'before' ? before : brush.alpha;
      for (let i=0;i<alpha.length;i++) rendered.data[i*4+3] = mode === 'original' ? original.data[i*4+3] : Math.round(original.data[i*4+3]*alpha[i]/255);
      canvas.getContext('2d').putImageData(rendered,0,0);
      $('mask-undo').disabled = saving || !brush.undoStack.length;
      $('mask-redo').disabled = saving || !brush.redoStack.length;
      $('mask-cursor').hidden = true;
    });
  }
  function zoom() {
    if (!brush) return;
    const stage = $('mask-stage');
    const fit = Math.min((stage.clientWidth-24)/brush.width,(stage.clientHeight-24)/brush.height,1);
    const factor = Math.max(0.05,fit)*Number($('mask-zoom').value);
    canvas.style.width = `${brush.width*factor}px`; canvas.style.height = `${brush.height*factor}px`;
    $('mask-zoom-value').textContent = `${Math.round(Number($('mask-zoom').value)*100)}%`;
  }
  function finish(event) {
    if (pointer === undefined || (event && event.pointerId !== pointer)) return;
    const id=pointer; pointer=undefined;
    brush.end(); if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    render();
  }
  function point(event) {
    const rect=canvas.getBoundingClientRect();
    return { x:(event.clientX-rect.left)*brush.width/rect.width, y:(event.clientY-rect.top)*brush.height/rect.height };
  }
  canvas.addEventListener('pointerdown',event=>{
    if (saving || !brush || pointer !== undefined || (event.pointerType==='mouse' && event.button!==0) || $('mask-compare').value!=='edited') return;
    event.preventDefault(); pointer=event.pointerId; canvas.setPointerCapture(pointer);
    brush.begin($('mask-mode').value,Number($('mask-size').value)/2,Number($('mask-softness').value)/100);
    const p=point(event); brush.move(p.x,p.y); render();
  });
  canvas.addEventListener('pointermove',event=>{
    if (!brush || saving) return;
    if (event.pointerId===pointer) { const p=point(event); brush.move(p.x,p.y); render(); }
    else if ($('mask-compare').value==='edited') {
      const rect=canvas.getBoundingClientRect(), stage=$('mask-stage'), sr=stage.getBoundingClientRect();
      const size=Number($('mask-size').value)*rect.width/brush.width, cursor=$('mask-cursor');
      cursor.style.width=cursor.style.height=`${size}px`;
      cursor.style.left=`${event.clientX-sr.left+stage.scrollLeft-size/2}px`;
      cursor.style.top=`${event.clientY-sr.top+stage.scrollTop-size/2}px`;cursor.hidden=false;
    }
  });
  for(const event of ['pointerup','pointercancel','lostpointercapture']) canvas.addEventListener(event,finish);
  canvas.addEventListener('pointerleave',()=>{$('mask-cursor').hidden=true;});
  $('mask-undo').addEventListener('click',()=>{finish();brush?.undo();render();});
  $('mask-redo').addEventListener('click',()=>{finish();brush?.redo();render();});
  $('mask-compare').addEventListener('change',()=>{finish();render();});
  $('mask-zoom').addEventListener('input',zoom);
  for (const name of ['size','softness']) $(`mask-${name}`).addEventListener('input',()=>{
    $(`mask-${name}-value`).textContent=$(`mask-${name}`).value+(name==='size'?' px':'%');
  });
  $('mask-background').addEventListener('change',()=>{
    const color=$('mask-background').value;
    canvas.classList.toggle('checker',color==='checker');canvas.style.backgroundColor=color==='checker'?'':color;
  });
  $('mask-cancel').addEventListener('click',()=>{if(!saving){finish();dialog.close();}});
  dialog.addEventListener('cancel',event=>{if(saving)event.preventDefault();else finish();});
  dialog.addEventListener('close',()=>{cancelAnimationFrame(frame);brush=original=before=rendered=null;canvas.width=canvas.height=1;});
  dialog.addEventListener('keydown',event=>{
    if(saving || !brush || !(event.ctrlKey||event.metaKey))return;
    const key=event.key.toLowerCase();
    if(key==='z'||key==='y'){event.preventDefault();finish();if(key==='y'||event.shiftKey)brush.redo();else brush.undo();render();}
  });
  $('mask-save').addEventListener('click',async()=>{
    if(!brush||saving)return;
    finish();saving=true;$('mask-controls').disabled=true;message('Guardando retoques…');
    try{
      const maskCanvas=document.createElement('canvas');maskCanvas.width=brush.width;maskCanvas.height=brush.height;
      const ctx=maskCanvas.getContext('2d'), pixels=ctx.createImageData(brush.width,brush.height);
      for(let i=0;i<brush.alpha.length;i++){pixels.data[i*4]=pixels.data[i*4+1]=pixels.data[i*4+2]=brush.alpha[i];pixels.data[i*4+3]=255;}
      ctx.putImageData(pixels,0,0);
      const blob=await new Promise((resolve,reject)=>maskCanvas.toBlob(b=>b?resolve(b):reject(new Error('No se pudo codificar la máscara.')),'image/png'));
      maskCanvas.width=maskCanvas.height=1;
      const result=await save(new File([blob],'mascara.png',{type:'image/png'}));
      await applied(result);dialog.close();
    }catch(error){message(error.message,true);}
    finally{saving=false;$('mask-controls').disabled=false;if(brush)render();}
  });
  new ResizeObserver(()=>{if(dialog.open)zoom();}).observe($('mask-stage'));
  return { async open(sourceUrl,maskUrl) {
    const [source,mask]=await Promise.all([loadImage(sourceUrl),loadImage(maskUrl)]);
    if(source.naturalWidth!==mask.naturalWidth||source.naturalHeight!==mask.naturalHeight)throw new Error('La máscara no coincide con la fotografía.');
    canvas.width=source.naturalWidth;canvas.height=source.naturalHeight;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(source,0,0);
    original=ctx.getImageData(0,0,canvas.width,canvas.height);rendered=new ImageData(new Uint8ClampedArray(original.data),canvas.width,canvas.height);
    ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(mask,0,0);
    const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    before=new Uint8ClampedArray(canvas.width*canvas.height);for(let i=0;i<before.length;i++)before[i]=data[i*4];
    brush=new MaskBrush(before,canvas.width,canvas.height);pointer=undefined;
    $('mask-compare').value='edited';$('mask-zoom').value='1';
    message('Borra residuos o restaura píxeles de la fotografía original. Acerca la imagen para revisar los bordes.');
    dialog.showModal();zoom();render();
  }};
}

(()=>{
  const root=document.documentElement;
  const shell=document.getElementById('shell');
  const canvas=document.getElementById('canvas');
  const world=document.getElementById('world');
  const toast=document.getElementById('toast');

  let zoom=.82;
  let panX=0;
  let panY=20;
  let selected=null;
  let playing=false;
  let current=40;
  let timer=null;
  let pulseT=0;
  let pulseOn=true;

  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const say=(message)=>{
    toast.textContent=message;
    toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer=setTimeout(()=>toast.classList.remove('show'),1200);
  };
  const render=()=>{
    world.style.transform=`translate(${panX}px,${panY}px) scale(${zoom})`;
    document.getElementById('zoomLabel').textContent=Math.round(zoom*100)+'%';
  };
  render();

  document.getElementById('assetsBtn').addEventListener('click',()=>shell.classList.toggle('side-open'));
  document.getElementById('inspectBtn').addEventListener('click',()=>shell.classList.toggle('inspect-open'));
  document.getElementById('inspectTopBtn').addEventListener('click',()=>shell.classList.toggle('inspect-open'));

  document.querySelectorAll('[data-folder]').forEach(head=>{
    head.addEventListener('click',()=>{
      const body=head.nextElementSibling;
      body.hidden=!body.hidden;
      head.querySelector('.chev').textContent=body.hidden?'⌄':'⌃';
    });
  });

  document.querySelectorAll('[data-asset]').forEach(asset=>{
    asset.addEventListener('click',()=>{
      document.querySelectorAll('[data-asset]').forEach(item=>item.classList.remove('selected'));
      asset.classList.add('selected');
      say(asset.textContent.trim());
    });
  });

  document.querySelectorAll('[data-person]').forEach(person=>{
    person.addEventListener('click',()=>{
      document.querySelectorAll('[data-person]').forEach(item=>item.classList.remove('active'));
      person.classList.add('active');
      document.getElementById('avatarName').textContent=person.dataset.person;
      say(person.dataset.person+' selected');
    });
  });

  document.querySelectorAll('[data-connect]').forEach(button=>{
    button.addEventListener('click',()=>{
      button.textContent=button.textContent==='Connect'?'On':'Connect';
      say('Connection updated');
    });
  });

  document.querySelectorAll('[data-msg]').forEach(button=>{
    button.addEventListener('click',()=>say(button.dataset.msg));
  });

  document.querySelectorAll('.tabs button').forEach(button=>{
    button.addEventListener('click',()=>{
      document.querySelectorAll('.tabs button').forEach(item=>item.classList.remove('active'));
      button.classList.add('active');
    });
  });

  document.querySelectorAll('[data-switch]').forEach(button=>{
    button.addEventListener('click',()=>{
      button.classList.toggle('on');
      if(button.id==='pulseSwitch') pulseOn=button.classList.contains('on');
      if(button.id==='ambientSwitch') {
        document.querySelector('.ambient').style.display=button.classList.contains('on')?'':'none';
      }
    });
  });

  document.getElementById('modelBtn').addEventListener('click',event=>{
    event.currentTarget.textContent=event.currentTarget.textContent.startsWith('Qwen')?'Gemini ▾':'Qwen ▾';
    say('Model switched');
  });

  const glow=document.getElementById('glowRange');
  const glowValue=document.getElementById('glowVal');
  glow.addEventListener('input',()=>{
    glowValue.textContent=glow.value+'%';
    root.style.setProperty('--glow-strength',(Number(glow.value)/72).toFixed(2));
  });

  const path=document.getElementById('pathRange');
  const pathValue=document.getElementById('pathVal');
  path.addEventListener('input',()=>{
    pathValue.textContent=path.value+'%';
    document.getElementById('liveWire').style.opacity=(.25+Number(path.value)/100*.75).toFixed(2);
  });

  document.getElementById('glowQuick').addEventListener('click',()=>{
    const value=Number(glow.value)>20?12:72;
    glow.value=value;
    glow.dispatchEvent(new Event('input'));
    say(value<20?'Glow reduced':'Glow restored');
  });

  document.getElementById('zoomIn').addEventListener('click',()=>{
    zoom=clamp(zoom+.08,.5,1.35);
    render();
  });
  document.getElementById('zoomOut').addEventListener('click',()=>{
    zoom=clamp(zoom-.08,.5,1.35);
    render();
  });
  document.getElementById('fitBtn').addEventListener('click',()=>{
    zoom=.82;
    panX=0;
    panY=20;
    render();
    say('Canvas fitted');
  });

  let pan=null;
  canvas.addEventListener('pointerdown',event=>{
    if(event.target.closest('.node,.float-panel,button,input,textarea,[contenteditable]')) return;
    pan={x:event.clientX,y:event.clientY,px:panX,py:panY};
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove',event=>{
    if(!pan) return;
    panX=pan.px+event.clientX-pan.x;
    panY=pan.py+event.clientY-pan.y;
    render();
  });
  canvas.addEventListener('pointerup',()=>pan=null);
  canvas.addEventListener('pointercancel',()=>pan=null);

  document.querySelectorAll('[data-node]').forEach(node=>{
    const head=node.querySelector('.node-head');
    let drag=null;

    node.addEventListener('pointerdown',()=>{
      if(selected) selected.classList.remove('selected');
      selected=node;
      node.classList.add('selected');
    });

    head.addEventListener('pointerdown',event=>{
      event.stopPropagation();
      if(selected) selected.classList.remove('selected');
      selected=node;
      node.classList.add('selected');
      drag={
        x:event.clientX,
        y:event.clientY,
        left:parseFloat(getComputedStyle(node).left),
        top:parseFloat(getComputedStyle(node).top)
      };
      head.setPointerCapture(event.pointerId);
    });

    head.addEventListener('pointermove',event=>{
      if(!drag) return;
      node.style.left=drag.left+(event.clientX-drag.x)/zoom+'px';
      node.style.top=drag.top+(event.clientY-drag.y)/zoom+'px';
    });

    head.addEventListener('pointerup',()=>drag=null);
    head.addEventListener('pointercancel',()=>drag=null);
  });

  const fill=document.getElementById('fill');
  const timeNow=document.getElementById('timeNow');
  const updateVideo=()=>{
    current=clamp(current,0,92);
    fill.style.width=current/92*100+'%';
    timeNow.textContent=Math.floor(current/60)+':'+String(Math.floor(current%60)).padStart(2,'0');
  };

  const playButton=document.getElementById('playBtn');
  playButton.addEventListener('click',()=>{
    playing=!playing;
    playButton.textContent=playing?'Ⅱ':'▶';
    clearInterval(timer);
    if(playing){
      timer=setInterval(()=>{
        current=current>=92?0:current+1;
        updateVideo();
      },1000);
    }
  });

  document.querySelectorAll('[data-skip]').forEach(button=>{
    button.addEventListener('click',()=>{
      current+=Number(button.dataset.skip);
      updateVideo();
    });
  });
  updateVideo();

  const liveButton=document.getElementById('liveBtn');
  liveButton.addEventListener('click',()=>{
    liveButton.classList.toggle('active');
    document.getElementById('liveWire').style.display=liveButton.classList.contains('active')?'':'none';
    say(liveButton.classList.contains('active')?'Live glow on':'Live glow off');
  });

  const flowButton=document.getElementById('flowBtn');
  flowButton.addEventListener('click',()=>{
    flowButton.classList.add('active');
    flowButton.textContent='Running…';
    document.querySelectorAll('.live-node').forEach((node,index)=>{
      setTimeout(()=>node.classList.add('selected'),index*160);
      setTimeout(()=>node.classList.remove('selected'),700+index*160);
    });
    setTimeout(()=>{
      flowButton.textContent='Completed';
      say('Flow completed');
      setTimeout(()=>{
        flowButton.classList.remove('active');
        flowButton.textContent='Run flow';
      },1000);
    },1150);
  });

  const pulse=document.getElementById('pulse');
  const animatePulse=()=>{
    pulseT=(pulseT+.0045)%1;
    const p=pulseT;
    const x=760+(850-760)*p;
    const smooth=p*p*(3-2*p);
    const y=473+(388-473)*smooth;
    pulse.setAttribute('cx',x);
    pulse.setAttribute('cy',y);
    pulse.style.opacity=pulseOn?'1':'0';
    requestAnimationFrame(animatePulse);
  };
  if(!matchMedia('(prefers-reduced-motion: reduce)').matches) animatePulse();
  else pulse.style.opacity='0';

  document.getElementById('search').addEventListener('input',event=>{
    const query=event.target.value.trim().toLowerCase();
    document.querySelectorAll('.asset,.person,.service').forEach(element=>{
      element.style.display=!query||element.textContent.toLowerCase().includes(query)?'':'none';
    });
  });

  document.getElementById('backBtn').addEventListener('click',()=>say('Workspace root'));
})();
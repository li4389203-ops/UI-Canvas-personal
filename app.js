(()=>{
  const root=document.documentElement;
  const shell=document.getElementById('shell');
  const canvas=document.getElementById('canvas');
  const world=document.getElementById('world');
  const connectionsGroup=document.getElementById('connections');
  const draftWire=document.getElementById('draftWire');
  const toast=document.getElementById('toast');
  const selectionToolbar=document.getElementById('selectionToolbar');
  const selectedLabel=document.getElementById('selectedLabel');
  const nodeTemplate=document.getElementById('nodeTemplate');

  const STORAGE_KEY='ui-canvas-graph-v2';
  const initialConnections=[
    {id:'c1',from:'model-out',to:'load-in',warm:true},
    {id:'c2',from:'load-out',to:'sampler-model'},
    {id:'c3',from:'prompt-out',to:'sampler-cond'},
    {id:'c4',from:'sampler-out',to:'decode-in',warm:true},
    {id:'c5',from:'decode-out',to:'preview-in',warm:true}
  ];

  let zoom=.82;
  let panX=28;
  let panY=22;
  let selectedNode=null;
  let selectedConnection=null;
  let linking=null;
  let panState=null;
  let playing=false;
  let current=40;
  let videoTimer=null;
  let liveMode=true;
  let pulseOn=true;
  let connections=[...initialConnections];
  let dynamicCounter=1;

  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const uid=(prefix)=>prefix+'-'+Date.now().toString(36)+'-'+(dynamicCounter++);
  const isEditing=()=>/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName||'') || document.activeElement?.isContentEditable;

  const say=(message)=>{
    toast.textContent=message;
    toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer=setTimeout(()=>toast.classList.remove('show'),1250);
  };

  const renderView=()=>{
    world.style.transform=`translate(${panX}px,${panY}px) scale(${zoom})`;
    document.getElementById('zoomLabel').textContent=Math.round(zoom*100)+'%';
    const grid=Math.max(8,20*zoom);
    canvas.style.backgroundSize=`${grid}px ${grid}px`;
    canvas.style.backgroundPosition=`${panX%grid}px ${panY%grid}px`;
  };

  const clientToWorld=(clientX,clientY)=>{
    const r=canvas.getBoundingClientRect();
    return {
      x:(clientX-r.left-panX)/zoom,
      y:(clientY-r.top-panY)/zoom
    };
  };

  const portPoint=(port)=>{
    const pr=port.getBoundingClientRect();
    const cr=canvas.getBoundingClientRect();
    return {
      x:(pr.left+pr.width/2-cr.left-panX)/zoom,
      y:(pr.top+pr.height/2-cr.top-panY)/zoom
    };
  };

  const curvePath=(a,b)=>{
    const dx=Math.max(70,Math.abs(b.x-a.x)*.46);
    const c1=a.x+dx;
    const c2=b.x-dx;
    return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} C ${c1.toFixed(1)} ${a.y.toFixed(1)}, ${c2.toFixed(1)} ${b.y.toFixed(1)}, ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  };

  const updateCounts=()=>{
    document.getElementById('nodeCount').textContent=document.querySelectorAll('[data-node]').length+' nodes';
    document.getElementById('connectionCount').textContent=connections.length+' links';
  };

  const selectConnection=(id)=>{
    clearNodeSelection();
    selectedConnection=id;
    renderConnections();
    selectedLabel.textContent='Connection';
    document.getElementById('duplicateNodeBtn').hidden=true;
    selectionToolbar.hidden=false;
  };

  const clearConnectionSelection=()=>{
    selectedConnection=null;
    document.getElementById('duplicateNodeBtn').hidden=false;
  };

  const renderConnections=()=>{
    connectionsGroup.replaceChildren();

    for(const connection of connections){
      const from=document.querySelector(`[data-port="${CSS.escape(connection.from)}"]`);
      const to=document.querySelector(`[data-port="${CSS.escape(connection.to)}"]`);
      if(!from||!to) continue;

      const d=curvePath(portPoint(from),portPoint(to));
      const path=document.createElementNS('http://www.w3.org/2000/svg','path');
      path.setAttribute('d',d);
      path.setAttribute('data-connection-id',connection.id);
      path.setAttribute('class','wire'+((connection.warm||liveMode)?' live':'')+(selectedConnection===connection.id?' selected':''));
      connectionsGroup.append(path);

      const hit=document.createElementNS('http://www.w3.org/2000/svg','path');
      hit.setAttribute('d',d);
      hit.setAttribute('class','connection-hit');
      hit.setAttribute('data-connection-id',connection.id);
      hit.addEventListener('pointerdown',(event)=>{
        event.stopPropagation();
        selectConnection(connection.id);
      });
      connectionsGroup.append(hit);
    }

    updateCounts();
  };

  const saveState=()=>{
    const nodes=[...document.querySelectorAll('[data-node]')].map(node=>({
      id:node.dataset.nodeId,
      type:node.dataset.nodeType||null,
      left:parseFloat(node.style.left)||0,
      top:parseFloat(node.style.top)||0,
      title:node.querySelector('.node-title')?.textContent||null,
      body:node.dataset.nodeType==='note' ? node.querySelector('.dynamic-body')?.textContent||'' : null
    }));
    const state={zoom,panX,panY,connections,nodes};
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state))}catch(_){}
  };

  const selectNode=(node)=>{
    clearConnectionSelection();
    if(selectedNode&&selectedNode!==node) selectedNode.classList.remove('selected');
    selectedNode=node;
    node.classList.add('selected');
    selectedLabel.textContent=node.querySelector('.node-title')?.textContent || node.querySelector('.node-head')?.childNodes?.[1]?.textContent?.trim() || node.dataset.nodeId;
    selectionToolbar.hidden=false;
  };

  const clearNodeSelection=()=>{
    if(selectedNode) selectedNode.classList.remove('selected');
    selectedNode=null;
    if(!selectedConnection) selectionToolbar.hidden=true;
  };

  const deleteConnection=(id)=>{
    connections=connections.filter(c=>c.id!==id);
    selectedConnection=null;
    selectionToolbar.hidden=true;
    renderConnections();
    saveState();
  };

  const deleteNode=(node)=>{
    if(!node) return;
    const id=node.dataset.nodeId;
    const portIds=[...node.querySelectorAll('.port')].map(p=>p.dataset.port);
    connections=connections.filter(c=>!portIds.includes(c.from)&&!portIds.includes(c.to));
    node.remove();
    selectedNode=null;
    selectionToolbar.hidden=true;
    renderConnections();
    saveState();
    say('Node deleted');
  };

  const duplicateNode=(node)=>{
    if(!node) return;
    const type=node.dataset.nodeType || (node.classList.contains('model-node')?'model':node.classList.contains('sampler-node')?'sampler':node.classList.contains('decode-node')?'decode':node.classList.contains('preview-node')?'preview':'prompt');
    const left=(parseFloat(node.style.left)||0)+34;
    const top=(parseFloat(node.style.top)||0)+34;
    const clone=createNode(type,{x:left,y:top},true);
    selectNode(clone);
    say('Node duplicated');
  };

  const dynamicBodyHTML=(type)=>{
    if(type==='model') return '<div class="row"><span>model</span><span class="value">custom</span></div><div class="row"><span>device</span><span class="value">auto</span></div>';
    if(type==='prompt') return '<div class="prompt-box" contenteditable="true">Describe light, motion and visual conditions…</div>';
    if(type==='sampler') return '<div class="row"><span>steps</span><span class="value">12</span></div><div class="row"><span>cfg</span><span class="value">1.0</span></div><div class="row"><span>sampler</span><span class="value">euler</span></div>';
    if(type==='decode') return '<div class="row"><span>samples</span><span class="value">VIDEO</span></div><div class="row"><span>vae</span><span class="value">Auto</span></div>';
    if(type==='preview') return '<div class="preview-mini"><span>Preview output</span><b>16:9</b></div>';
    if(type==='note') return 'Double-click or select this note to edit. Use it for grouping ideas, prompts or comments.';
    return '<div class="row"><span>value</span><span class="value">default</span></div>';
  };

  const typeTitle=(type)=>({
    model:'Model',
    prompt:'Text Prompt',
    sampler:'KSampler',
    decode:'VAE Decode',
    preview:'Preview Output',
    note:'Note'
  }[type]||'Node');

  function createNode(type,position,silent=false,saved=null){
    const fragment=nodeTemplate.content.cloneNode(true);
    const node=fragment.querySelector('[data-node]');
    const nodeId=saved?.id||uid(type);
    node.dataset.nodeId=nodeId;
    node.dataset.nodeType=type;
    node.style.left=(saved?.left??position.x)+'px';
    node.style.top=(saved?.top??position.y)+'px';

    const title=typeTitle(type);
    node.querySelector('.node-title').textContent=saved?.title||title;
    node.querySelector('.node-sub').textContent=type==='note'?'memo':type==='preview'?'output':'custom';
    if(['sampler','decode','preview'].includes(type)) node.classList.add('live-node');
    node.classList.add(type+'-node');

    const input=node.querySelector('.port.in');
    const output=node.querySelector('.port.out');
    input.dataset.port=nodeId+'-in';
    output.dataset.port=nodeId+'-out';

    if(type==='model') input.remove();
    if(type==='preview') output.remove();
    if(type==='note'){
      input.remove();
      output.remove();
      node.classList.add('note-node');
    }

    const body=node.querySelector('.dynamic-body');
    body.innerHTML=dynamicBodyHTML(type);
    if(type==='note'){
      body.contentEditable='true';
      if(saved?.body) body.textContent=saved.body;
    }

    world.append(node);
    bindNode(node);
    renderConnections();
    if(!silent){
      selectNode(node);
      saveState();
      say(title+' added');
    }
    return node;
  }

  const addNodeAtViewportCenter=(type)=>{
    const r=canvas.getBoundingClientRect();
    const center=clientToWorld(r.left+r.width/2,r.top+r.height/2);
    const jitter=(document.querySelectorAll('[data-node]').length%5)*14;
    createNode(type,{x:center.x-110+jitter,y:center.y-70+jitter});
  };

  const startLink=(port,event)=>{
    event.stopPropagation();
    if(port.dataset.dir!=='out') return;

    linking={from:port,start:portPoint(port),point:clientToWorld(event.clientX,event.clientY)};
    port.classList.add('connecting');
    document.querySelectorAll('.port[data-dir="in"]').forEach(p=>{
      if(p.closest('[data-node]')!==port.closest('[data-node]')) p.classList.add('valid-target');
    });
    draftWire.hidden=false;
    draftWire.setAttribute('d',curvePath(linking.start,linking.point));
  };

  const finishLink=(target)=>{
    if(!linking) return;
    const from=linking.from;
    const valid=target?.matches?.('.port[data-dir="in"]') && target.closest('[data-node]')!==from.closest('[data-node]');

    if(valid){
      const fromId=from.dataset.port;
      const toId=target.dataset.port;
      connections=connections.filter(c=>c.to!==toId);
      const duplicate=connections.some(c=>c.from===fromId&&c.to===toId);
      if(!duplicate){
        connections.push({id:uid('c'),from:fromId,to:toId,warm:from.classList.contains('warm')||target.classList.contains('warm')});
        say('Connected');
      }
    }

    from.classList.remove('connecting');
    document.querySelectorAll('.port.valid-target').forEach(p=>p.classList.remove('valid-target'));
    draftWire.hidden=true;
    draftWire.setAttribute('d','');
    linking=null;
    renderConnections();
    saveState();
  };

  function bindNode(node){
    const head=node.querySelector('.node-head');
    if(node.dataset.bound==='1') return;
    node.dataset.bound='1';

    node.addEventListener('pointerdown',(event)=>{
      if(event.target.closest('.port')) return;
      selectNode(node);
    });

    node.querySelectorAll('.port[data-dir="out"]').forEach(port=>{
      port.addEventListener('pointerdown',(event)=>startLink(port,event));
    });

    node.querySelectorAll('.port[data-dir="in"]').forEach(port=>{
      port.addEventListener('pointerdown',(event)=>{
        event.stopPropagation();
        const existing=connections.find(c=>c.to===port.dataset.port);
        if(existing){
          connections=connections.filter(c=>c.id!==existing.id);
          renderConnections();
          saveState();
          say('Input disconnected');
        }
      });
    });

    head.addEventListener('pointerdown',(event)=>{
      if(event.target.closest('button')) return;
      event.stopPropagation();
      selectNode(node);
      const start={
        x:event.clientX,
        y:event.clientY,
        left:parseFloat(node.style.left)||0,
        top:parseFloat(node.style.top)||0
      };
      head.setPointerCapture(event.pointerId);

      const move=(moveEvent)=>{
        node.style.left=start.left+(moveEvent.clientX-start.x)/zoom+'px';
        node.style.top=start.top+(moveEvent.clientY-start.y)/zoom+'px';
        renderConnections();
      };
      const end=()=>{
        head.removeEventListener('pointermove',move);
        head.removeEventListener('pointerup',end);
        head.removeEventListener('pointercancel',end);
        saveState();
      };

      head.addEventListener('pointermove',move);
      head.addEventListener('pointerup',end);
      head.addEventListener('pointercancel',end);
    });

    node.querySelector('.node-more')?.addEventListener('click',(event)=>{
      event.stopPropagation();
      selectNode(node);
      say('Node selected · Delete / Duplicate available below');
    });
  }

  const fitAll=()=>{
    const nodes=[...document.querySelectorAll('[data-node]')];
    if(!nodes.length) return;

    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const node of nodes){
      const x=parseFloat(node.style.left)||0;
      const y=parseFloat(node.style.top)||0;
      minX=Math.min(minX,x);
      minY=Math.min(minY,y);
      maxX=Math.max(maxX,x+node.offsetWidth);
      maxY=Math.max(maxY,y+node.offsetHeight);
    }

    const rect=canvas.getBoundingClientRect();
    const margin=120;
    const contentW=Math.max(1,maxX-minX);
    const contentH=Math.max(1,maxY-minY);
    zoom=clamp(Math.min((rect.width-margin*2)/contentW,(rect.height-margin*2)/contentH),.35,1.15);
    panX=rect.width/2-((minX+maxX)/2)*zoom;
    panY=rect.height/2-((minY+maxY)/2)*zoom;
    renderView();
    requestAnimationFrame(renderConnections);
    saveState();
    say('Fit to graph');
  };

  const restoreState=()=>{
    let state=null;
    try{state=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null')}catch(_){}
    if(!state) return false;

    zoom=clamp(Number(state.zoom)||.82,.25,2.2);
    panX=Number.isFinite(state.panX)?state.panX:28;
    panY=Number.isFinite(state.panY)?state.panY:22;

    const staticIds=new Set([...document.querySelectorAll('[data-node]')].map(n=>n.dataset.nodeId));
    for(const saved of state.nodes||[]){
      if(staticIds.has(saved.id)){
        const node=document.querySelector(`[data-node-id="${CSS.escape(saved.id)}"]`);
        if(node){
          node.style.left=saved.left+'px';
          node.style.top=saved.top+'px';
        }
      }else if(saved.type){
        createNode(saved.type,{x:saved.left,y:saved.top},true,saved);
      }
    }

    connections=Array.isArray(state.connections)?state.connections:[...initialConnections];
    return true;
  };

  document.querySelectorAll('[data-node]').forEach(bindNode);
  restoreState();
  renderView();
  requestAnimationFrame(renderConnections);

  document.getElementById('addNodeBtn').addEventListener('click',(event)=>{
    event.stopPropagation();
    const menu=document.getElementById('nodeMenu');
    menu.hidden=!menu.hidden;
  });
  document.getElementById('nodeMenu').addEventListener('click',(event)=>{
    const button=event.target.closest('[data-add-type]');
    if(!button) return;
    addNodeAtViewportCenter(button.dataset.addType);
    document.getElementById('nodeMenu').hidden=true;
  });
  document.addEventListener('pointerdown',(event)=>{
    if(!event.target.closest('.node-add-wrap')) document.getElementById('nodeMenu').hidden=true;
  });

  canvas.addEventListener('pointerdown',(event)=>{
    if(event.button!==0&&event.button!==1) return;
    if(event.target.closest('.node,.float-panel,.connection-hit,button,input,textarea,[contenteditable]')) return;

    clearNodeSelection();
    clearConnectionSelection();
    selectionToolbar.hidden=true;

    panState={x:event.clientX,y:event.clientY,panX,panY};
    canvas.classList.add('panning');
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener('pointermove',(event)=>{
    if(!panState) return;
    panX=panState.panX+(event.clientX-panState.x);
    panY=panState.panY+(event.clientY-panState.y);
    renderView();
  });

  const endPan=()=>{
    if(!panState) return;
    panState=null;
    canvas.classList.remove('panning');
    saveState();
  };
  canvas.addEventListener('pointerup',endPan);
  canvas.addEventListener('pointercancel',endPan);

  canvas.addEventListener('wheel',(event)=>{
    event.preventDefault();
    const rect=canvas.getBoundingClientRect();
    const mouseX=event.clientX-rect.left;
    const mouseY=event.clientY-rect.top;
    const worldX=(mouseX-panX)/zoom;
    const worldY=(mouseY-panY)/zoom;
    const factor=Math.exp(-event.deltaY*.00125);
    const next=clamp(zoom*factor,.25,2.2);

    panX=mouseX-worldX*next;
    panY=mouseY-worldY*next;
    zoom=next;
    renderView();
    requestAnimationFrame(renderConnections);
    clearTimeout(canvas._wheelSave);
    canvas._wheelSave=setTimeout(saveState,180);
  },{passive:false});

  window.addEventListener('pointermove',(event)=>{
    if(!linking) return;
    linking.point=clientToWorld(event.clientX,event.clientY);
    draftWire.setAttribute('d',curvePath(linking.start,linking.point));
  });
  window.addEventListener('pointerup',(event)=>{
    if(linking) finishLink(document.elementFromPoint(event.clientX,event.clientY));
  });

  document.addEventListener('keydown',(event)=>{
    if(isEditing()) return;
    if((event.key==='Delete'||event.key==='Backspace')){
      event.preventDefault();
      if(selectedNode) deleteNode(selectedNode);
      else if(selectedConnection) deleteConnection(selectedConnection);
    }
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='d'&&selectedNode){
      event.preventDefault();
      duplicateNode(selectedNode);
    }
    if(event.key==='Escape'){
      if(linking) finishLink(null);
      clearNodeSelection();
      clearConnectionSelection();
      selectionToolbar.hidden=true;
    }
  });

  document.getElementById('duplicateNodeBtn').addEventListener('click',()=>duplicateNode(selectedNode));
  document.getElementById('deleteNodeBtn').addEventListener('click',()=>{
    if(selectedNode) deleteNode(selectedNode);
    else if(selectedConnection) deleteConnection(selectedConnection);
  });

  document.getElementById('zoomIn').addEventListener('click',()=>{
    zoom=clamp(zoom+.1,.25,2.2);
    renderView();
    requestAnimationFrame(renderConnections);
    saveState();
  });
  document.getElementById('zoomOut').addEventListener('click',()=>{
    zoom=clamp(zoom-.1,.25,2.2);
    renderView();
    requestAnimationFrame(renderConnections);
    saveState();
  });
  document.getElementById('fitBtn').addEventListener('click',fitAll);
  document.getElementById('resetViewBtn').addEventListener('click',()=>{
    zoom=.82;panX=28;panY=22;renderView();requestAnimationFrame(renderConnections);saveState();say('View reset');
  });

  document.getElementById('clearConnectionsBtn').addEventListener('click',()=>{
    connections=[];
    selectedConnection=null;
    selectionToolbar.hidden=true;
    renderConnections();
    saveState();
    say('Links cleared');
  });

  document.getElementById('resetGraphBtn').addEventListener('click',()=>{
    try{localStorage.removeItem(STORAGE_KEY)}catch(_){}
    location.reload();
  });

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

  document.querySelectorAll('[data-msg]').forEach(button=>button.addEventListener('click',()=>say(button.dataset.msg)));

  document.querySelectorAll('.tabs button').forEach(button=>{
    button.addEventListener('click',()=>{
      document.querySelectorAll('.tabs button').forEach(item=>item.classList.remove('active'));
      button.classList.add('active');
    });
  });

  document.getElementById('modelBtn').addEventListener('click',(event)=>{
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
    connectionsGroup.style.opacity=(.3+Number(path.value)/100*.7).toFixed(2);
  });

  const rim=document.getElementById('rimRange');
  const rimValue=document.getElementById('rimVal');
  rim.addEventListener('input',()=>{
    rimValue.textContent=rim.value+'%';
    root.style.setProperty('--rim-strength',Math.max(.05,Number(rim.value)/100).toFixed(2));
  });

  document.getElementById('glowQuick').addEventListener('click',()=>{
    const value=Number(glow.value)>20?12:72;
    glow.value=value;
    glow.dispatchEvent(new Event('input'));
    say(value<20?'Glow reduced':'Glow restored');
  });

  document.getElementById('nodeGlowSwitch').addEventListener('click',(event)=>{
    event.currentTarget.classList.toggle('on');
    const on=event.currentTarget.classList.contains('on');
    document.querySelectorAll('[data-node]').forEach(node=>node.classList.toggle('no-glow',!on));
  });

  document.getElementById('pulseSwitch').addEventListener('click',(event)=>{
    event.currentTarget.classList.toggle('on');
    pulseOn=event.currentTarget.classList.contains('on');
  });

  document.getElementById('ambientSwitch').addEventListener('click',(event)=>{
    event.currentTarget.classList.toggle('on');
    document.getElementById('ambient').style.display=event.currentTarget.classList.contains('on')?'':'none';
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
    clearInterval(videoTimer);
    if(playing){
      videoTimer=setInterval(()=>{
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
    liveMode=!liveMode;
    liveButton.classList.toggle('active',liveMode);
    renderConnections();
    say(liveMode?'Live glow on':'Live glow off');
  });

  const flowButton=document.getElementById('flowBtn');
  flowButton.addEventListener('click',()=>{
    flowButton.classList.add('active');
    flowButton.textContent='Running…';
    const nodes=[...document.querySelectorAll('[data-node]')];
    nodes.forEach((node,index)=>{
      setTimeout(()=>node.classList.add('selected'),index*90);
      setTimeout(()=>node.classList.remove('selected'),420+index*90);
    });
    setTimeout(()=>{
      flowButton.textContent='Completed';
      say('Flow completed');
      setTimeout(()=>{
        flowButton.classList.remove('active');
        flowButton.textContent='Run flow';
        if(selectedNode) selectedNode.classList.add('selected');
      },800);
    },Math.max(900,nodes.length*100));
  });

  const pulse=document.createElementNS('http://www.w3.org/2000/svg','circle');
  pulse.setAttribute('r','3.2');
  pulse.setAttribute('fill','#ff8b58');
  pulse.style.filter='drop-shadow(0 0 6px rgba(255,118,64,.9))';
  pulse.style.pointerEvents='none';
  document.getElementById('wireLayer').append(pulse);

  let pulseProgress=0;
  const animatePulse=()=>{
    const pathEl=connectionsGroup.querySelector('.wire.live');
    if(pulseOn&&liveMode&&pathEl){
      const length=pathEl.getTotalLength();
      pulseProgress=(pulseProgress+.0045)%1;
      const point=pathEl.getPointAtLength(length*pulseProgress);
      pulse.setAttribute('cx',point.x);
      pulse.setAttribute('cy',point.y);
      pulse.style.opacity='1';
    }else{
      pulse.style.opacity='0';
    }
    requestAnimationFrame(animatePulse);
  };
  if(!matchMedia('(prefers-reduced-motion: reduce)').matches) animatePulse();
  else pulse.style.opacity='0';

  document.getElementById('search').addEventListener('input',(event)=>{
    const query=event.target.value.trim().toLowerCase();
    document.querySelectorAll('.asset,.person,.service').forEach(element=>{
      element.style.display=!query||element.textContent.toLowerCase().includes(query)?'':'none';
    });
  });

  document.getElementById('backBtn').addEventListener('click',()=>say('Workspace root'));

  window.addEventListener('resize',()=>{
    renderView();
    requestAnimationFrame(renderConnections);
  });
})();
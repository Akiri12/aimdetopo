(() => {
  const KEY_LABELS = ["W","A","S","D","SPACE","SHIFT","CTRL","Q","E","Z","X","C"]; // teclas reducidas
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const lerp=(a,b,t)=>a+(b-a)*t;
  const fmtTime = s => { const m = Math.floor(s/60).toString().padStart(2,'0'); const r = Math.floor(s%60).toString().padStart(2,'0'); return `${m}:${r}`; };
  const AC = new (window.AudioContext||window.webkitAudioContext)();
  const beep = (freq=600, dur=0.06, type='sine', vol=0.12) => {
    const o = AC.createOscillator(); const g = AC.createGain();
    o.type=type; o.frequency.value=freq; o.connect(g); g.connect(AC.destination);
    const now = AC.currentTime; g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(vol, now+0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, now+dur);
    o.start(now); o.stop(now+dur+0.02);
  }

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('overlay');
  const DPR = Math.min(2, window.devicePixelRatio || 1);

  const state = {
    running:false, paused:false, startTime:0, time:0, roundSec:120,
    mode:'alt', diff:'normal',
    score:0, combo:0, shots:0, hits:0,
    bubble:null, nextIsCenter:true, trail:[], freeNextCenter:true,
    gridPositions:[], coinMax:44, freeRadiusMax:96 // 1 pulgada aprox
  };

  function recalcGrid(){
    const w = canvas.width, h = canvas.height;
    const maxSide = Math.min(w, h, 480); // 5 pulgadas aprox 480px
    const startX = (w - maxSide)/2, startY=(h-maxSide)/2;
    const step = maxSide/2;
    const gp=[];
    for(let yy=0; yy<=2; yy++){
      for(let xx=0; xx<=2; xx++){
        gp.push({x:startX+xx*step, y:startY+yy*step});
      }
    }
    state.gridPositions = gp;
  }

  function resize(){
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.floor(rect.width * DPR);
    canvas.height = Math.floor((window.innerHeight-28) * DPR);
    recalcGrid();
  }
  window.addEventListener('resize', resize);
  resize();

  const HS_KEY = 'vk_osu_records_v1';
  const hs = JSON.parse(localStorage.getItem(HS_KEY)||'{}');
  state.bestAlt = hs.bestAlt||0; state.bestGrid = hs.bestGrid||0;

  const scoreEl = document.getElementById('score');
  const comboEl = document.getElementById('combo');
  const accEl = document.getElementById('acc');
  const timeEl = document.getElementById('time');
  const startBtn = document.getElementById('startBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const resetBtn = document.getElementById('resetBtn');
  const modeSel = document.getElementById('modeSel');
  const diffSel = document.getElementById('diffSel');
  const durInput = document.getElementById('roundSec');

  const DIFF = {
    easy:   { ttl:1.6, scoreBase:120 },
    normal: { ttl:1.2, scoreBase:140 },
    hard:   { ttl:0.95, scoreBase:165 },
  };

  const TRAIL_MAX_POINTS = 80;
  const TRAIL_LIFE_MS = 550;
  let mouse = {x:canvas.width/2, y:canvas.height/2};
  canvas.addEventListener('mousemove', e=>{
    const rect = canvas.getBoundingClientRect();
    mouse.x = (e.clientX - rect.left) * DPR;
    mouse.y = (e.clientY - rect.top) * DPR;
    state.trail.push({x:mouse.x,y:mouse.y,t:performance.now()});
    if(state.trail.length>TRAIL_MAX_POINTS) state.trail.shift();
  });

  function drawTrail(now){
    const fresh=[]; for(const p of state.trail){ if(now-p.t <= TRAIL_LIFE_MS) fresh.push(p); }
    state.trail = fresh; if(fresh.length<2) return;
    ctx.lineWidth = 3*DPR; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(fresh[0].x, fresh[0].y);
    for(let i=1;i<fresh.length;i++){
      const a = 1 - (now - fresh[i].t)/TRAIL_LIFE_MS;
      ctx.strokeStyle = `rgba(167,139,250,${0.25*a})`;
      ctx.lineTo(fresh[i].x, fresh[i].y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(fresh[i].x, fresh[i].y);
    }
  }

  function makeBubble(x,y,label=null, free=false){
    const r = free ? 3 + Math.random()*5 : (Math.random()*0.5 +0.5)*(state.coinMax/2)*DPR;
    const ttl = free ? 1.0 : DIFF[state.diff].ttl;
    return {x,y,r,label, born:performance.now(), ttl, dead:false, armed:false, free};
  }

  function spawnCenter(){ state.bubble = makeBubble(canvas.width/2, canvas.height/2, state.mode!=='free'? KEY_LABELS[Math.floor(Math.random()*KEY_LABELS.length)]:null, state.mode==='free'); }
function spawnRandom(){
  if(state.mode==='free'){
    if(state.freeNextCenter){
      // Punto en el centro
      state.bubble = makeBubble(canvas.width/2, canvas.height/2, null, true);
    } else {
      // Punto aleatorio alrededor del centro
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * state.freeRadiusMax;
      const x = canvas.width/2 + Math.cos(angle) * dist;
      const y = canvas.height/2 + Math.sin(angle) * dist;
      state.bubble = makeBubble(x, y, null, true);
    }
    state.freeNextCenter = !state.freeNextCenter; // alterna centro/azar
  } else {
    const m = 60*DPR;
    const x = m + Math.random()*(canvas.width-2*m);
    const y = m + Math.random()*(canvas.height-2*m);
    state.bubble = makeBubble(x,y, KEY_LABELS[Math.floor(Math.random()*KEY_LABELS.length)]);
  }
}

  function spawnGrid(){
    const label = KEY_LABELS[Math.floor(Math.random()*KEY_LABELS.length)];
    const pos = state.gridPositions[Math.floor(Math.random()*state.gridPositions.length)] || {x:canvas.width/2,y:canvas.height/2};
    state.bubble = makeBubble(pos.x, pos.y, label);
  }

  canvas.addEventListener('click', startOrHit);
  window.addEventListener('keydown', e=>{
    if(e.key===' ' && !state.running){ startGame(); return; }
    if(!state.running || state.paused || !state.bubble || state.bubble.dead) return;
    if(state.bubble.free) return;
    const pred = labelToPredicate(state.bubble.label);
    if(pred(e)){ e.preventDefault(); state.bubble.armed=true; beep(660,0.05,'triangle',0.12); }
    if(e.key.toLowerCase()==='p') pause();
  });

  function startOrHit(e){
    if(!state.running){ startGame(); return; }
    if(state.paused) return;
    if(!state.bubble || state.bubble.dead) return;
    const mx = (e.clientX-canvas.getBoundingClientRect().left)*DPR;
    const my = (e.clientY-canvas.getBoundingClientRect().top)*DPR;
    const d = Math.hypot(mx-state.bubble.x, my-state.bubble.y);
    if(d<=state.bubble.r){
      state.shots++;
      if(state.bubble.armed || state.bubble.free){
        applyHit(); state.bubble.dead=true; state.bubble=null; nextBubble();
      } else applyMiss();
    }
  }

  function labelToPredicate(label){
    switch(label){
      case 'SPACE': return e=> e.code==='Space' || e.key===' ';
      case 'SHIFT': return e=> e.key==='Shift' || e.code==='ShiftLeft' || e.code==='ShiftRight';
      case 'CTRL': return e=> e.key==='Control' || e.code==='ControlLeft' || e.code==='ControlRight';
      default: return e=> e.key.toUpperCase()===label;
    }
  }

function nextBubble(){
  if(state.mode==='alt'){ 
    state.nextIsCenter ? spawnCenter() : spawnRandom(); 
    state.nextIsCenter = !state.nextIsCenter; 
  } else if(state.mode==='grid') {
    spawnGrid();
  } else if(state.mode==='free') {
    spawnRandom(); // ya maneja alternado centro/azar
  }
}

  function applyHit(){ state.score += Math.floor(DIFF[state.diff].scoreBase*(1+state.combo*0.03)); state.combo++; state.hits++; flash(+1); beep(820,0.05,'triangle',0.12); }
  function applyMiss(){ state.combo=0; flash(-1); beep(180,0.07,'sawtooth',0.08); }

  let flashT=0, flashSign=1;
  function flash(sign){ flashT = performance.now(); flashSign = sign; }

  let raf=0;
  function loop(){
    if(!state.running){ cancelAnimationFrame(raf); return; }
    raf=requestAnimationFrame(loop);
    if(state.paused){ drawPaused(); return; }

    const now=performance.now();
    state.time=(now-state.startTime)/1000;
    draw(now);

    if(state.bubble && !state.bubble.dead && !state.bubble.free){
      const age = (now-state.bubble.born)/1000;
      if(age>state.bubble.ttl){ state.bubble.dead=true; applyMiss(); nextBubble(); }
    }

    if(state.time>=state.roundSec){ endRound(); return; }
    updateHUD();
  }

  function updateHUD(){
    scoreEl.textContent = state.score;
    comboEl.textContent = state.combo;
    const acc = state.shots>0? Math.max(0,Math.min(100,Math.round((state.hits/state.shots)*100))):100;
    accEl.textContent = acc+"%";
    timeEl.textContent = fmtTime(Math.max(0,state.roundSec - state.time));
  }

  function draw(now){
    ctx.clearRect(0,0,canvas.width,canvas.height);

    const df=now-flashT;
    if(df<220){ const a=1-df/220; ctx.fillStyle=flashSign>0? `rgba(120,255,214,${0.15*a})`:`rgba(255,100,100,${0.18*a})`; ctx.fillRect(0,0,canvas.width,canvas.height); }

    drawTrail(now);
    if(state.bubble && !state.bubble.dead) drawBubble(state.bubble, now);

    ctx.strokeStyle='rgba(230,236,255,.35)';
    ctx.lineWidth=1.25*DPR;
    ctx.beginPath();
    ctx.moveTo(mouse.x-10*DPR, mouse.y); ctx.lineTo(mouse.x+10*DPR, mouse.y);
    ctx.moveTo(mouse.x, mouse.y-10*DPR); ctx.lineTo(mouse.x, mouse.y+10*DPR);
    ctx.stroke();
  }

  function drawPaused(){ ctx.save(); ctx.globalAlpha=0.25; ctx.fillStyle='#000'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.restore(); }

  function drawBubble(b, now){
    const age = (now-b.born)/1000; const t=clamp(age/b.ttl,0,1);
    const r = lerp(b.r*1.15,b.r*0.9,t);

    ctx.beginPath(); ctx.arc(b.x,b.y,r+10*DPR,0,Math.PI*2);
    ctx.strokeStyle = `rgba(167,139,250,${0.25*(1-t)})`; ctx.lineWidth=10*DPR*(1-t); ctx.stroke();

    ctx.beginPath(); ctx.arc(b.x,b.y,r,0,Math.PI*2);
    ctx.fillStyle = b.free ? 'rgba(255,80,80,1)' : 'rgba(120,255,214,'+(b.armed?1:0.75)+')';
    ctx.fill();

    ctx.beginPath(); ctx.lineWidth=3*DPR; ctx.strokeStyle='rgba(255,255,255,.7)';
    ctx.arc(b.x,b.y,r+6*DPR,-Math.PI/2,-Math.PI/2+Math.PI*2*(1-t)); ctx.stroke();

    if(b.label){
      ctx.fillStyle='#0b1022';
      ctx.font=`${Math.max(12*DPR,r*0.8)}px system-ui,Segoe UI,Roboto`;
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(b.label,b.x,b.y);

      if(!b.armed){
        ctx.fillStyle='rgba(11,16,34,.8)';
        ctx.font=`${12*DPR}px system-ui,Segoe UI`;
        ctx.textBaseline='alphabetic'; ctx.fillText('Tecla → Clic',b.x,b.y+r+16*DPR);
      }
    }
  }

  function startGame(){
    if(AC.state==='suspended') AC.resume();
    state.running=true; state.paused=false;
    state.mode=modeSel.value; state.diff=diffSel.value;
    state.roundSec=clamp(parseInt(durInput.value||120,10),10,200);
    state.score=0; state.combo=0; state.hits=0; state.shots=0; state.bubble=null;
    state.nextIsCenter=true; state.trail=[]; state.freeNextCenter=true;
    state.startTime=performance.now(); overlay.style.display='none';
    cancelAnimationFrame(raf); raf=requestAnimationFrame(loop);
    spawnCenter();
  }

  function startBtnClick(){
    overlay.querySelector('.center').innerHTML='<h2>¡Listo! Comienza en 3 segundos...</h2>';
    overlay.style.display='flex';
    setTimeout(()=>{startGame(); overlay.style.display='none';},3000);
  }

  function pause(){ state.paused=!state.paused; }

  function endRound(){
    state.running=false; cancelAnimationFrame(raf);
    if(state.mode==='alt'){ if(state.score>state.bestAlt) state.bestAlt=state.score; }
    else { if(state.score>state.bestGrid) state.bestGrid=state.score; }
    localStorage.setItem(HS_KEY, JSON.stringify({bestAlt:state.bestAlt,bestGrid:state.bestGrid}));
    overlay.style.display='flex';
    overlay.querySelector('.center').innerHTML=`
      <h2>Fin de la ronda</h2>
      <p><strong>Puntaje:</strong> ${state.score} · <strong>Combo máx:</strong> ${state.combo}
      · <strong>Precisión:</strong> ${state.shots?Math.round((state.hits/state.shots)*100):100}%</p>
      <div class="row" style="justify-content:center;margin-top:8px">
        <button onclick="location.reload()" class="secondary">Nueva partida</button>
      </div>`;
  }

  startBtn.textContent='▶️ Play';
  startBtn.addEventListener('click', startBtnClick);
  pauseBtn.addEventListener('click', ()=>{ if(state.running) pause(); });
  resetBtn.addEventListener('click', ()=>{ location.reload(); });
  modeSel.addEventListener('change', ()=>{ state.mode=modeSel.value; });
  diffSel.addEventListener('change', ()=>{ state.diff=diffSel.value; });
})();

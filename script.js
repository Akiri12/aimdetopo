(() => {
  const KEY_LABELS = ["W","A","S","D","SPACE","SHIFT","CTRL","Q","E","Z","X","C"];
  const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
  const lerp = (a,b,t)=>a+(b-a)*t;
  const fmtTime = s => { const m = Math.floor(s/60).toString().padStart(2,'0'); const r = Math.floor(s%60).toString().padStart(2,'0'); return `${m}:${r}`; };
  const AC = new (window.AudioContext||window.webkitAudioContext)();
  const beep = (freq=600, dur=0.06, type='sine', vol=0.12) => {
    const o = AC.createOscillator(); const g = AC.createGain();
    o.type = type; o.frequency.value = freq; o.connect(g); g.connect(AC.destination);
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
  gridPositions:[], coinMax:44, freeRadiusMax:96,
  pipe:null,
  normalErrors: 0    // <-- añade esta línea
};


  function recalcGrid(){
    const w = canvas.width, h = canvas.height;
    const maxSide = Math.min(w, h, 480);
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

  // DIFF: para "easy" aumentamos TTL y pipeDur; además en makeBubble multiplicamos radio
const DIFF = {
  easy:   { ttl: 4.4, scoreBase: 80,  pipeDur: 5.6 },   // tu "easy" más fácil
  normal: { ttl: 4.4, scoreBase: 140, pipeDur: 5.6 },  // comienza igual que easy
  hard:   { ttl: 0.95, scoreBase: 165, pipeDur: 1.35 }
};

// parámetros para ajuste dinámico del modo "normal"
const NORMAL_ADJUST = {
  minTTL: 0.9,
  maxTTL: 6.0,
  stepTTL: 0.25,
  minPipe: 1.2,
  maxPipe: 6.0,
  stepPipe: 0.35
};

function adjustNormalSpeed(result){
  // solo aplica si la dificultad actual es "normal"
  if(state.diff !== 'normal') return;

  if(result === 'hit'){
    // acierto: reset de errores y aumento de velocidad (ttl/pipedur bajan)
    state.normalErrors = 0;
    DIFF.normal.ttl = Math.max(NORMAL_ADJUST.minTTL, DIFF.normal.ttl - NORMAL_ADJUST.stepTTL);
    DIFF.normal.pipeDur = Math.max(NORMAL_ADJUST.minPipe, DIFF.normal.pipeDur - NORMAL_ADJUST.stepPipe);
  } else if(result === 'miss'){
    // fallo: cuenta errores. 1 fallo -> sin cambio; 2 fallos -> baja la velocidad
    state.normalErrors = (state.normalErrors || 0) + 1;
    if(state.normalErrors >= 2){
      DIFF.normal.ttl = Math.min(NORMAL_ADJUST.maxTTL, DIFF.normal.ttl + NORMAL_ADJUST.stepTTL);
      DIFF.normal.pipeDur = Math.min(NORMAL_ADJUST.maxPipe, DIFF.normal.pipeDur + NORMAL_ADJUST.stepPipe);
      state.normalErrors = 0;
    }
  }
}

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
    // base radius
    const base = free ? 5 + Math.random()*5 : (Math.random()*0.5 +0.5)*(state.coinMax/2)*DPR;
    // en fácil hacemos la burbuja más grande para facilitar el click
    const r = (!free && state.diff==='easy') ? base * 1.45 : base;
    const ttl = free ? 0 : DIFF[state.diff].ttl;
    return {x,y,r,label, born:performance.now(), ttl, dead:false, armed:false, free};
  }

  function spawnCenter(){ 
    state.bubble = makeBubble(
      canvas.width/2, 
      canvas.height/2, 
      state.mode!=='free'? KEY_LABELS[Math.floor(Math.random()*KEY_LABELS.length)]:null, 
      state.mode==='free'
    ); 
  }

  function spawnRandom(){
    if(state.mode==='free'){
      if(state.freeNextCenter){
        state.bubble = makeBubble(canvas.width/2, canvas.height/2, null, true);
      } else {
        let x, y, attempts = 0;
        const minDist = 19;
        do {
          const angle = Math.random() * Math.PI * 2;
          const dist = Math.random() * state.freeRadiusMax;
          x = canvas.width/2 + Math.cos(angle) * dist;
          y = canvas.height/2 + Math.sin(angle) * dist;
          attempts++;
        } while(state.bubble && Math.hypot(x - state.bubble.x, y - state.bubble.y) < minDist && attempts < 20);
        state.bubble = makeBubble(x, y, null, true);
      }
      state.freeNextCenter = !state.freeNextCenter;
      return;
    }

    // NO-FREE modes:
    // En "easy" hacemos las posiciones más predecibles / centradas.
    if(state.diff === 'easy'){
      const cx = canvas.width/2, cy = canvas.height/2;
      const maxR = Math.min(canvas.width, canvas.height) / 6; // radio pequeño cerca del centro
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * maxR * (0.4 + 0.6*Math.random()); // ligermente bias hacia centro
      const x = cx + Math.cos(angle) * dist;
      const y = cy + Math.sin(angle) * dist;
      state.bubble = makeBubble(x, y, KEY_LABELS[Math.floor(Math.random()*KEY_LABELS.length)]);
    } else {
      const m = 60*DPR;
      const x = m + Math.random()*(canvas.width-2*m);
      const y = m + Math.random()*(canvas.height-2*m);
      state.bubble = makeBubble(x,y, KEY_LABELS[Math.floor(Math.random()*KEY_LABELS.length)]);
    }
  }

  function spawnGrid(){
    const label = KEY_LABELS[Math.floor(Math.random()*KEY_LABELS.length)];
    // En fácil seleccionamos más el centro o celdas adyacentes
    if(state.diff === 'easy'){
      const favored = [4,1,3,5,7]; // centro y 4 lados
      const idx = favored[Math.floor(Math.random()*favored.length)];
      const pos = state.gridPositions[idx] || {x:canvas.width/2,y:canvas.height/2};
      state.bubble = makeBubble(pos.x, pos.y, label);
    } else {
      const pos = state.gridPositions[Math.floor(Math.random()*state.gridPositions.length)] || {x:canvas.width/2,y:canvas.height/2};
      state.bubble = makeBubble(pos.x, pos.y, label);
    }
  }

  canvas.addEventListener('click', startOrHit);
  window.addEventListener('keydown', e=>{
    if(e.key===' ' && !state.running){ startGame(); return; }
    if(e.key.toLowerCase()==='p'){ if(state.running) pause(); return; }
    if(!state.running || state.paused) return;
    if(state.mode==='pipe') return; // en "Tubo" no hay armado por teclas
    if(!state.bubble || state.bubble.dead) return;
    if(state.bubble.free) return;
    const pred = labelToPredicate(state.bubble.label);
    if(pred(e)){ e.preventDefault(); state.bubble.armed=true; beep(660,0.05,'triangle',0.12); }
  });

  function startOrHit(e){
    if(!state.running){ startGame(); return; }
    if(state.paused) return;

    if(state.mode==='pipe'){
      handlePipeClick(e);
      return;
    }

    if(!state.bubble || state.bubble.dead) return;

    const mx = (e.clientX-canvas.getBoundingClientRect().left)*DPR;
    const my = (e.clientY-canvas.getBoundingClientRect().top)*DPR;
    const d = Math.hypot(mx-state.bubble.x, my-state.bubble.y);

    state.shots++; // cada clic cuenta como un intento

    if(d <= state.bubble.r){
      if(state.bubble.armed || state.bubble.free){
        applyHit();
        state.bubble.dead = true;
        state.bubble = null;
        nextBubble();
      } else {
        applyMiss(); // clic sobre burbuja pero sin tecla
      }
    } else {
      applyMiss(); // clic fuera de burbuja también cuenta
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
      spawnRandom();
    }
  }

function applyHit(){ 
  state.score += Math.floor(DIFF[state.diff].scoreBase*(1+state.combo*0.03)); 
  state.combo++; 
  state.hits++; 
  beep(820,0.05,'triangle',0.12); 
  // efecto visual
  window.flashT = performance.now();

  // ajuste dinámico solo para dificultad "normal"
  if(state.diff === 'normal') adjustNormalSpeed('hit');
}


function applyMiss(){ 
  state.combo = 0; 
  // ajuste dinámico solo para dificultad "normal"
  if(state.diff === 'normal') adjustNormalSpeed('miss');
  beep(180,0.07,'sawtooth',0.08); // sonido de error
}

  let raf=0;
  function loop(){
    if(!state.running){ cancelAnimationFrame(raf); return; }
    raf=requestAnimationFrame(loop);
    if(state.paused){ drawPaused(); return; }

    const now=performance.now();
    state.time=(now-state.startTime)/1000;

    // Dibujos
    ctx.clearRect(0,0,canvas.width,canvas.height);

    const df=now-(window.flashT||0);
    if(df<220){ const a=1-df/220; ctx.fillStyle='rgba(255,100,100,0)'; ctx.fillRect(0,0,canvas.width,canvas.height); }

    drawTrail(now);

    if(state.mode==='pipe'){
      updatePipe(now);
      drawPipe(now);
    } else {
      if(state.bubble && !state.bubble.dead) drawBubble(state.bubble, now);

      if(state.bubble && !state.bubble.dead && !state.bubble.free){
        const age = (now-state.bubble.born)/1000;
        if(age>state.bubble.ttl){
          state.bubble.dead=true;
          applyMiss();
          nextBubble();
        }
      }
    }

    // mira del cursor
    ctx.strokeStyle='rgba(230,236,255,.35)';
    ctx.lineWidth=1.25*DPR;
    ctx.beginPath();
    ctx.moveTo(mouse.x-10*DPR, mouse.y); ctx.lineTo(mouse.x+10*DPR, mouse.y);
    ctx.moveTo(mouse.x, mouse.y-10*DPR); ctx.lineTo(mouse.x, mouse.y+10*DPR);
    ctx.stroke();

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

  function drawPaused(){ ctx.save(); ctx.globalAlpha=0.25; ctx.fillStyle='#000'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.restore(); }

  function drawBubble(b, now){
    const age = (now-b.born)/1000; 
    const t = state.mode==='free'?0:clamp(age/b.ttl,0,1);
    const r = lerp(b.r*1.15,b.r*0.9,t);

    if(state.mode!=='free'){
      ctx.beginPath(); ctx.arc(b.x,b.y,r+10*DPR,0,Math.PI*2);
      ctx.strokeStyle = `rgba(167,139,250,${0.25*(1-t)})`; ctx.lineWidth=10*DPR*(1-t); ctx.stroke();
    }

    ctx.beginPath(); ctx.arc(b.x,b.y,r,0,Math.PI*2);
    ctx.fillStyle = b.free ? 'rgba(255,80,80,1)' : 'rgba(120,255,214,'+(b.armed?1:0.75)+')';
    ctx.fill();

    if(state.mode!=='free'){
      ctx.beginPath(); ctx.lineWidth=3*DPR; ctx.strokeStyle='rgba(255,255,255,.7)';
      ctx.arc(b.x,b.y,r+6*DPR,-Math.PI/2,-Math.PI/2+Math.PI*2*(1-t)); ctx.stroke();
    }

    if(b.label){
      ctx.fillStyle='#0b1022';
      ctx.font=`${Math.max(12*DPR,r*0.8)}px system-ui,Segoe UI,Roboto`;
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(b.label,b.x,b.y);
    }
  }

  function startGame(){
    if(AC.state==='suspended') AC.resume();
    state.running=true; state.paused=false;
    state.mode=modeSel.value; state.diff=diffSel.value;

    // si la dificultad seleccionada es "normal", inicializar sus valores igual que easy
    if(state.diff === 'normal'){
      DIFF.normal.ttl = DIFF.easy.ttl;
      DIFF.normal.pipeDur = DIFF.easy.pipeDur;
      state.normalErrors = 0;
    }

    state.roundSec=clamp(parseInt(durInput.value||120,10),10,200);
    state.score=0; state.combo=0; state.hits=0; state.shots=0;
    state.trail=[];
    state.startTime=performance.now(); overlay.style.display='none'; overlay.style.pointerEvents='none';
    cancelAnimationFrame(raf); raf=requestAnimationFrame(loop);

    // limpiar entidades anteriores
    state.bubble=null; state.nextIsCenter=true; state.freeNextCenter=true; state.pipe=null;

    if(state.mode==='pipe'){ spawnPipe(); }
    else { spawnCenter(); }
  }

  function startBtnClick(){
    overlay.querySelector('.center').innerHTML='<h2>¡Listo! Comienza en 3 segundos...</h2>';
    overlay.style.display='flex';
    overlay.style.pointerEvents='auto';
    setTimeout(()=>{startGame(); overlay.style.display='none'; overlay.style.pointerEvents='none';},3000);
  }

  function pause(){ state.paused=!state.paused; }

  function endRound(){
    state.running=false; cancelAnimationFrame(raf);
    if(state.mode==='alt'){ if(state.score>state.bestAlt) state.bestAlt=state.score; }
    else if(state.mode==='grid'){ if(state.score>state.bestGrid) state.bestGrid=state.score; }
    localStorage.setItem(HS_KEY, JSON.stringify({bestAlt:state.bestAlt,bestGrid:state.bestGrid}));

    overlay.style.display='flex';
    overlay.style.pointerEvents='auto';
    overlay.querySelector('.center').innerHTML=`
      <h2>Fin de la ronda</h2>
      <p><strong>Puntaje:</strong> ${state.score} · <strong>Combo máx:</strong> ${state.combo}
      · <strong>Precisión:</strong> ${state.shots?Math.round((state.hits/state.shots)*100):100}%</p>
      <div class="row" style="justify-content:center;margin-top:8px">
        <button id="newGameBtn" class="secondary" disabled>Nueva partida</button>
      </div>`;

    const btn = document.getElementById('newGameBtn');
    setTimeout(() => {
      btn.disabled = false;
      btn.onclick = () => location.reload();
    }, 2000);
  }

  startBtn.textContent='▶️ Play';
  startBtn.addEventListener('click', startBtnClick);
  pauseBtn.addEventListener('click', ()=>{ if(state.running) pause(); });

  // Reinicio: preserva la modalidad actual si estás en "Tubo", en otros modos recarga (como antes)
  resetBtn.addEventListener('click', ()=>{
    if(modeSel.value==='pipe'){
      // reiniciar sin cambiar la selección
      startGame();
    } else {
      location.reload();
    }
  });

  modeSel.addEventListener('change', ()=>{
    state.mode=modeSel.value;
    if(!state.running && state.mode==='pipe'){ state.pipe=null; }
  });
  diffSel.addEventListener('change', ()=>{ state.diff=diffSel.value; });

  // =========================
  //     MODO "TUBO" (nuevo)
  // =========================

  const INCH = 96;
  function spawnPipe(){
    const len = 5 * INCH * DPR;
    const width = 26 * DPR;
    const holeR = Math.max(16*DPR, width*0.7);
    const ballR = Math.max(7*DPR, width*0.35);

    const angle = Math.random() * Math.PI;
    const ca = Math.cos(angle), sa = Math.sin(angle);

    const marginX = (len/2)*Math.abs(ca) + (width/2)*Math.abs(sa) + 12*DPR;
    const marginY = (len/2)*Math.abs(sa) + (width/2)*Math.abs(ca) + 12*DPR;

    // centro aleatorio dentro de márgenes
    const cx = clamp(Math.random()*canvas.width, marginX, canvas.width - marginX);
    const cy = clamp(Math.random()*canvas.height, marginY, canvas.height - marginY);

    const half = len/2;
    const p0 = { x: cx - ca*half, y: cy - sa*half };
    const p1 = { x: cx + ca*half, y: cy + sa*half };
    const dir = Math.random()<0.5 ? 1 : -1;

    const dur = DIFF[state.diff].pipeDur;
    const speed = 1/dur;
    const t = dir===1 ? 0 : 1;

    state.pipe = { p0, p1, mid:{x:cx,y:cy}, angle, width, len, holeR, ballR, t, dir, speed, clicked:false, born:performance.now() };
  }

  function updatePipe(now){
    if(!state.pipe) return;
    const dt = Math.min(0.03, (now - (state.pipe._prev||now))/1000);
    state.pipe._prev = now;
    const sign = state.pipe.dir;
    state.pipe.t = clamp(state.pipe.t + sign*state.pipe.speed*dt, 0, 1);

    if((sign===1 && state.pipe.t>=1) || (sign===-1 && state.pipe.t<=0)){
      state.pipe = null;
      spawnPipe();
    }
  }

  function drawPipe(now){
    const P = state.pipe; if(!P) return;

    const ca = Math.cos(P.angle), sa = Math.sin(P.angle);
    const vx = ca, vy = sa;
    const hw = P.width/2;
    const px = -vy, py = vx;
    const A = {x: P.p0.x + px*hw, y: P.p0.y + py*hw};
    const B = {x: P.p1.x + px*hw, y: P.p1.y + py*hw};
    const C = {x: P.p1.x - px*hw, y: P.p1.y - py*hw};
    const D = {x: P.p0.x - px*hw, y: P.p0.y - py*hw};

    const grad = ctx.createLinearGradient(A.x, A.y, B.x, B.y);
    grad.addColorStop(0, 'rgba(167,139,250,0.22)');
    grad.addColorStop(0.5, 'rgba(120,255,214,0.28)');
    grad.addColorStop(1, 'rgba(167,139,250,0.22)');

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(A.x, A.y);
    ctx.lineTo(B.x, B.y);
    ctx.lineTo(C.x, C.y);
    ctx.lineTo(D.x, D.y);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 2*DPR;
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(P.mid.x, P.mid.y, P.holeR, 0, Math.PI*2);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 3*DPR;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(P.mid.x, P.mid.y, P.holeR+6*DPR, 0, Math.PI*2);
    ctx.strokeStyle = 'rgba(167,139,250,0.4)';
    ctx.lineWidth = 6*DPR;
    ctx.stroke();

    const bx = lerp(P.p0.x, P.p1.x, P.t);
    const by = lerp(P.p0.y, P.p1.y, P.t);

    const tailT = 0.06;
    const tBack = clamp(P.t - P.dir*P.speed*tailT, 0, 1);
    const tx = lerp(P.p0.x, P.p1.x, tBack);
    const ty = lerp(P.p0.y, P.p1.y, tBack);
    ctx.beginPath();
    ctx.moveTo(tx, ty); ctx.lineTo(bx, by);
    ctx.strokeStyle = 'rgba(255,80,80,0.35)';
    ctx.lineWidth = Math.max(2*DPR, P.ballR*0.35);
    ctx.stroke();

    ctx.shadowColor = 'rgba(255,80,80,0.7)';
    ctx.shadowBlur = 18*DPR;
    ctx.beginPath();
    ctx.arc(bx, by, P.ballR, 0, Math.PI*2);
    ctx.fillStyle = 'rgba(255,80,80,1)';
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.restore();
  }

  function handlePipeClick(e){
    const P = state.pipe; if(!P) return;
    if(P.clicked) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * DPR;
    const my = (e.clientY - rect.top) * DPR;

    state.shots++;

    if(!pointInRotatedRect(mx, my, P)) {
      applyMiss();
      P.clicked = true;
      return;
    }

    const distToCenter = Math.hypot(mx - P.mid.x, my - P.mid.y);
    if(distToCenter > P.holeR){
      applyMiss();
      P.clicked = true;
      return;
    }

    const bx = lerp(P.p0.x, P.p1.x, P.t);
    const by = lerp(P.p0.y, P.p1.y, P.t);
    const tol = Math.max(P.ballR*0.9, 10*DPR);
    if(Math.hypot(bx - P.mid.x, by - P.mid.y) <= tol){
      applyHit();
      flashCircle(P.mid.x, P.mid.y, P.holeR + 10*DPR);
      state.pipe = null;
      spawnPipe();
    } else {
      applyMiss();
      P.clicked = true;
      return;
    }
  }

  function pointInRotatedRect(x, y, P){
    const dx = x - P.mid.x, dy = y - P.mid.y;
    const ca = Math.cos(-P.angle), sa = Math.sin(-P.angle);
    const rx = dx*ca - dy*sa;
    const ry = dx*sa + dy*ca;
    const hx = P.len/2, hy = P.width/2;
    return Math.abs(rx) <= hx && Math.abs(ry) <= hy;
  }

  function flashCircle(x,y,r){
    const start = performance.now();
    function f(){
      const t = (performance.now()-start)/220;
      if(t>=1) return;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.beginPath();
      ctx.arc(x,y, r + 40*DPR*t, 0, Math.PI*2);
      ctx.strokeStyle = `rgba(255,255,255,${1-t})`;
      ctx.lineWidth = 6*DPR*(1-t);
      ctx.stroke();
      ctx.restore();
      requestAnimationFrame(f);
    }
    f();
  }

})();

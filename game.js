// game.js — Arena Clash prototype (original code)
// Place index.html, game.css, game.js in a repo and open index.html or publish with GitHub Pages.

(() => {
  // Canvas
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');

  // Layout
  const W = canvas.width;
  const H = canvas.height;
  const LANES = 3;
  const LANE_X = [W*0.22, W*0.5, W*0.78];
  const PLAYER_Y = H - 90;
  const ENEMY_Y = 90;
  const TICKRATE = 1/60;

  // Game state
  const STATE = {
    time: 0,
    player: {
      elixir: 4,
      maxElixir: 10,
      towers: [1000, 1000, 1000]
    },
    enemy: {
      elixir: 4,
      maxElixir: 10,
      towers: [1000, 1000, 1000]
    },
    units: [], // active units
    projectiles: [],
    running: true,
    winner: null
  };

  // Unit types (spawn buttons). These are generic troops (no trademark names).
  // We make variety: light melee, heavy melee (tank), ranged, splash caster.
  const UNIT_TYPES = [
    { id:'skirm', name:'Skirm', cost:2, hp:100, dmg:18, spd:120, size:8, range:12, color:'#64b678', cooldown:1.8 },
    { id:'knight', name:'Knight', cost:3, hp:320, dmg:48, spd:55, size:14, range:16, color:'#cfa57a', cooldown:2.8 },
    { id:'archer', name:'Archer', cost:3, hp:120, dmg:30, spd:110, size:8, range:120, color:'#ffd86b', cooldown:2.6 },
    { id:'giant', name:'Giant', cost:5, hp:900, dmg:90, spd:35, size:18, range:18, color:'#e66b5a', cooldown:5.0 },
    { id:'mage', name:'Mage', cost:4, hp:200, dmg:60, spd:75, size:12, range:140, color:'#9a6be5', cooldown:3.8 }
  ];

  // Spawn button cooldowns per side
  const cooldowns = {
    player: {}, enemy: {}
  };
  UNIT_TYPES.forEach(u => { cooldowns.player[u.id] = 0; cooldowns.enemy[u.id] = 0; });

  // Helpers
  const now = () => performance.now()/1000;
  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

  // UI references
  const spawnsDiv = document.getElementById('spawns');
  const elixirValue = document.getElementById('elixir-value');
  const enemyElixirDom = document.getElementById('enemy-elixir');
  const overlay = document.getElementById('overlay');

  // Build spawn buttons (player side)
  UNIT_TYPES.forEach((type, idx) => {
    const btn = document.createElement('div');
    btn.className = 'spawn-btn';
    btn.innerHTML = `<div style="font-size:14px">${type.name}</div><div class="spawn-cost">${type.cost} ⚡</div>`;
    btn.addEventListener('click', () => {
      attemptSpawn('player', type);
    });
    spawnsDiv.appendChild(btn);
    type._btn = btn;
  });

  // Spawn logic — unit object structure:
  // { id, side:'player'|'enemy', typeId, x,y, vx, vy, hp, maxHp, dmg, range, size, color, lane, lastAttack, attackCooldown, isRanged }
  let unitId = 1;
  function spawnUnit(side, type, lane) {
    const baseX = LANE_X[lane];
    const x = baseX + (side==='player' ? -30 : 30);
    const y = side==='player' ? PLAYER_Y : ENEMY_Y;
    const dir = side === 'player' ? -1 : 1; // player moves up (y decreasing), enemy moves down (y increasing)
    const u = {
      id: unitId++,
      side,
      typeId: type.id,
      name: type.name,
      x, y,
      vx: 0, vy: dir * type.spd / 60,
      hp: type.hp,
      maxHp: type.hp,
      dmg: type.dmg,
      range: type.range,
      size: type.size,
      color: type.color,
      lane,
      lastAttack: 0,
      attackCooldown: 0.9,
      isRanged: type.range > 40
    };
    STATE.units.push(u);
    cooldowns[side][type.id] = type.cooldown; // start cooldown for that type
    return u;
  }

  // Player spawn attempt chooses lane via last click position on canvas or center if none
  let lastClickX = null;
  canvas.addEventListener('click', (ev) => {
    const r = canvas.getBoundingClientRect();
    lastClickX = ev.clientX - r.left;
  });

  function pickLaneFromLastClick(){
    if (lastClickX == null) return 1; // center by default
    const distances = LANE_X.map(x => Math.abs(x - lastClickX));
    const bestIdx = distances.indexOf(Math.min(...distances));
    lastClickX = null;
    return bestIdx;
  }

  function attemptSpawn(side, type) {
    const actor = STATE[side];
    if (!actor) return;
    if (actor.elixir < type.cost) {
      // flash button quickly
      const b = type._btn;
      if (b) { b.style.transform = 'translateY(-6px)'; setTimeout(()=>b.style.transform='',140); }
      return;
    }
    if (cooldowns[side][type.id] > 0) {
      // cannot due to cooldown
      return;
    }
    const lane = side === 'player' ? pickLaneFromLastClick() : (Math.random()<0.6?1:(Math.random()<0.5?0:2));
    actor.elixir -= type.cost;
    // spawn
    spawnUnit(side, type, lane);
    updateUI();
  }

  // AI chooses spawns when having elixir and cooldown free
  let nextAiPlay = now() + 0.7;
  function aiThink(dt){
    if (now() < nextAiPlay) return;
    nextAiPlay = now() + (0.6 + Math.random()*1.2);
    const enemy = STATE.enemy;
    // pick a random type that is affordable and off cooldown
    const affordable = UNIT_TYPES.filter(t => enemy.elixir >= t.cost && cooldowns.enemy[t.id] <= 0);
    if (affordable.length === 0) return;
    // weight toward cheaper choices sometimes
    const pick = affordable[Math.floor(Math.random() * affordable.length)];
    attemptSpawn('enemy', pick);
  }

  // Combat and movement step
  function step(dt) {
    if (!STATE.running) return;

    STATE.time += dt;

    // Elixir regen (per second)
    const regenRate = 1.0;
    STATE.player.elixir = clamp(STATE.player.elixir + regenRate * dt, 0, STATE.player.maxElixir);
    STATE.enemy.elixir = clamp(STATE.enemy.elixir + regenRate * dt, 0, STATE.enemy.maxElixir);

    // cooldowns tick
    for (const s of ['player','enemy']){
      for (const k in cooldowns[s]){
        if (cooldowns[s][k] > 0) cooldowns[s][k] = Math.max(0, cooldowns[s][k] - dt);
      }
    }

    // AI
    aiThink(dt);

    // units: move toward enemy units in same lane; otherwise aim for lane tower
    for (const u of STATE.units){
      if (u.hp <= 0) continue;
      // find closest enemy unit in same lane
      let target = null;
      let bestDist = 1e9;
      for (const v of STATE.units){
        if (v.side === u.side) continue;
        if (v.lane !== u.lane) continue;
        const d = Math.hypot(v.x - u.x, v.y - u.y);
        if (d < bestDist){ bestDist = d; target = v; }
      }

      // compute desired target position
      let tx = LANE_X[u.lane];
      let ty = (u.side === 'player') ? ENEMY_Y : PLAYER_Y;
      if (target){
        tx = target.x; ty = target.y;
      }

      const dx = tx - u.x;
      const dy = ty - u.y;
      const dist = Math.hypot(dx,dy);

      if (dist <= u.range + (target ? 0 : 12)) {
        // attack
        if (now() - u.lastAttack >= u.attackCooldown){
          u.lastAttack = now();
          if (target){
            target.hp -= u.dmg;
          } else {
            // hit tower
            const opponent = (u.side === 'player') ? STATE.enemy : STATE.player;
            opponent.towers[u.lane] -= u.dmg;
            // small pushback animation
            u.x -= (dx/dist) * 6;
          }
        }
      } else {
        // move toward
        const vx = (dx/dist || 0) * u.vy * 60 * dt;
        const vy = (dy/dist || 0) * u.vy * 60 * dt;
        u.x += vx;
        u.y += vy;
      }
    }

    // remove dead units
    for (let i = STATE.units.length-1; i >= 0; i--){
      const u = STATE.units[i];
      if (u.hp <= 0) {
        STATE.units.splice(i,1);
      }
    }

    // check towers for end match
    for (let s of ['player','enemy']){
      const sideState = STATE[s];
      for (let t=0;t<3;t++){
        if (sideState.towers[t] <= 0){
          STATE.running = false;
          STATE.winner = s === 'player' ? 'enemy' : 'player';
          showEnd(STATE.winner);
          return;
        }
      }
    }

    updateUI();
  }

  function showEnd(winner){
    overlay.classList.remove('hidden');
    overlay.style.pointerEvents = 'auto';
    overlay.style.background = 'rgba(0,0,0,0.5)';
    overlay.innerHTML = `<div style="text-align:center">
      <div style="font-size:42px; margin-bottom:14px">${winner === 'player' ? 'You Lost' : 'Enemy Lost'}</div>
      <button id="btn-restart" style="padding:10px 16px;border-radius:8px;border:none;cursor:pointer">Restart</button>
    </div>`;
    document.getElementById('btn-restart').addEventListener('click', resetGame);
  }

  function resetGame(){
    STATE.player = { elixir:4, maxElixir:10, towers: [1000,1000,1000] };
    STATE.enemy = { elixir:4, maxElixir:10, towers: [1000,1000,1000] };
    STATE.units = [];
    STATE.running = true;
    STATE.winner = null;
    overlay.classList.add('hidden');
    overlay.innerHTML = '';
    unitId = 1;
  }

  // Draw
  function render(){
    // background
    ctx.clearRect(0,0,W,H);

    // lanes (three colored vertical strips)
    for (let i=0;i<LANES;i++){
      const lx = LANE_X[i];
      ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)';
      ctx.fillRect(lx - (W*0.18), 0, W*0.36, H);
    }

    // draw river center line
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, H*0.5);
    ctx.lineTo(W, H*0.5);
    ctx.stroke();

    // draw towers (visual)
    function drawTower(side, lane, hp){
      const x = LANE_X[lane];
      const y = side === 'player' ? PLAYER_Y + 36 : ENEMY_Y - 36;
      ctx.fillStyle = side === 'player' ? '#2f80ed' : '#ff6b6b';
      ctx.beginPath();
      ctx.roundRect(x-28,y-28,56,56,8);
      ctx.fill();
      // hp bar
      ctx.fillStyle = '#000';
      ctx.fillRect(x-32, y-42, 64, 6);
      ctx.fillStyle = '#7fff7f';
      ctx.fillRect(x-32, y-42, 64 * clamp(hp/1000, 0, 1), 6);
    }

    drawTower('player',0,STATE.player.towers[0]);
    drawTower('player',1,STATE.player.towers[1]);
    drawTower('player',2,STATE.player.towers[2]);
    drawTower('enemy',0,STATE.enemy.towers[0]);
    drawTower('enemy',1,STATE.enemy.towers[1]);
    drawTower('enemy',2,STATE.enemy.towers[2]);

    // units
    for (const u of STATE.units){
      // shadow
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.beginPath();
      ctx.ellipse(u.x, u.y + u.size*0.8, u.size*1.1, u.size*0.6, 0, 0, Math.PI*2);
      ctx.fill();

      // body
      ctx.fillStyle = u.color;
      ctx.beginPath();
      ctx.arc(u.x, u.y, u.size, 0, Math.PI*2);
      ctx.fill();

      // hp bar
      ctx.fillStyle = '#000';
      ctx.fillRect(u.x - u.size, u.y - u.size - 8, u.size*2, 4);
      ctx.fillStyle = '#ff6b6b';
      ctx.fillRect(u.x - u.size, u.y - u.size - 8, u.size*2 * clamp(u.hp / u.maxHp,0,1), 4);

      // name
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.font = '10px sans-serif';
      ctx.fillText(u.name, u.x - u.size, u.y + u.size + 12);
    }

    // HUD text: elixir
    elixirValue.textContent = Math.floor(STATE.player.elixir);
    enemyElixirDom.textContent = Math.floor(STATE.enemy.elixir);

    // spawn button states
    UNIT_TYPES.forEach(t => {
      const btn = t._btn;
      if (!btn) return;
      const affordable = STATE.player.elixir >= t.cost;
      const cd = cooldowns.player[t.id];
      if (!affordable || cd > 0) btn.classList.add('disabled'); else btn.classList.remove('disabled');
      // show cooldown overlay number
      if (cd > 0) {
        btn.querySelector('.spawn-cost').textContent = `${t.cost} • ${cd.toFixed(1)}s`;
      } else {
        btn.querySelector('.spawn-cost').textContent = `${t.cost} ⚡`;
      }
    });
  }

  // polyfill: roundRect for some browsers
  if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
      if (w < 2 * r) r = w / 2;
      if (h < 2 * r) r = h / 2;
      this.beginPath();
      this.moveTo(x + r, y);
      this.arcTo(x + w, y, x + w, y + h, r);
      this.arcTo(x + w, y + h, x, y + h, r);
      this.arcTo(x, y + h, x, y, r);
      this.arcTo(x, y, x + w, y, r);
      this.closePath();
      return this;
    };
  }

  // Game loop
  let last = now();
  function loop(){
    const cur = now();
    const dt = Math.min(0.033, cur - last);
    last = cur;
    step(dt);
    render();
    requestAnimationFrame(loop);
  }

  // init
  function init(){
    // initial UI hooks
    // attach buttons reference done earlier
    UNIT_TYPES.forEach(t => {
      // ensure each type has its button reference
      if (!t._btn) {
        // fallback: link by name search
        const btn = Array.from(document.getElementsByClassName('spawn-btn')).find(b => b.textContent.includes(t.name));
        t._btn = btn || null;
      }
    });

    // Placeholders for enemy AI cooldowns seeded small random
    UNIT_TYPES.forEach(t => { cooldowns.enemy[t.id] = Math.random()*1.2; });

    last = now();
    loop();
  }

  init();

})();

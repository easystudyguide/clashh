(() => {
  // ===== Canvas & layout =====
  const canvas = document.getElementById('gameCanvas');
  if (!canvas) {
    console.error('game.js: missing canvas with id "gameCanvas"');
    return;
  }
  const ctx = canvas.getContext('2d');

  const W = canvas.width;
  const H = canvas.height;

  const LANES = 3;
  const LANE_X = [W * 0.22, W * 0.5, W * 0.78];
  const PLAYER_Y = H - 90;
  const ENEMY_Y = 90;

  // ===== State =====
  const STATE = {
    time: 0,
    player: { elixir: 4, maxElixir: 10, towers: [1000, 1000, 1000] },
    enemy:  { elixir: 4, maxElixir: 10, towers: [1000, 1000, 1000] },
    units: [],
    running: true,
    winner: null
  };

  // ===== Unit definitions =====
  const UNIT_TYPES = [
    { id:'skirm', name:'Skirm', cost:2, hp:100, dmg:18, spd:120, size:8, range:12, color:'#64b678', cooldown:1.8 },
    { id:'knight', name:'Knight', cost:3, hp:320, dmg:48, spd:55, size:14, range:16, color:'#cfa57a', cooldown:2.8 },
    { id:'archer', name:'Archer', cost:3, hp:120, dmg:30, spd:110, size:8, range:120, color:'#ffd86b', cooldown:2.6 },
    { id:'giant', name:'Giant', cost:5, hp:900, dmg:90, spd:35, size:18, range:18, color:'#e66b5a', cooldown:5.0 },
    { id:'mage', name:'Mage', cost:4, hp:200, dmg:60, spd:75, size:12, range:140, color:'#9a6be5', cooldown:3.8 }
  ];

  // ===== Cooldowns (per side + set by id) =====
  const cooldowns = { player: {}, enemy: {} };
  UNIT_TYPES.forEach(t => { cooldowns.player[t.id] = 0; cooldowns.enemy[t.id] = 0; });

  // ===== UI refs =====
  const spawnsDiv = document.getElementById('spawns');
  const elixirValue = document.getElementById('elixir-value');
  const enemyElixirDom = document.getElementById('enemy-elixir');
  const overlay = document.getElementById('overlay');

  // Safety checks
  if (!spawnsDiv || !elixirValue || !enemyElixirDom || !overlay) {
    console.warn('game.js: one or more UI elements missing (#spawns, #elixir-value, #enemy-elixir, #overlay). Make sure index.html has them.');
  }

  // ===== Utility =====
  const now = () => performance.now() / 1000;
  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

  // ===== Spawn buttons creation (guaranteed) =====
  // We'll create a spawn button element for each UNIT_TYPE and keep reference on the type object
  function createSpawnButtons() {
    spawnsDiv.innerHTML = ''; // clear any existing content
    UNIT_TYPES.forEach(type => {
      const btn = document.createElement('div');
      btn.className = 'spawn-btn';
      btn.style.position = 'relative';
      btn.innerHTML = `
        <div style="font-size:14px">${type.name}</div>
        <div class="spawn-cost" style="margin-top:6px">${type.cost} ⚡</div>
        <div class="cooldown-overlay" style="position:absolute;inset:0;border-radius:10px;display:none;align-items:center;justify-content:center;font-weight:700;background:rgba(0,0,0,0.35);color:white;"></div>
      `;
      btn.addEventListener('click', () => {
        attemptSpawn('player', type);
      });
      spawnsDiv.appendChild(btn);
      type._btn = btn;
    });
  }

  createSpawnButtons(); // ensure they exist immediately

  // ===== Last click for lane selection =====
  let lastClickX = null;
  canvas.addEventListener('click', (ev) => {
    const r = canvas.getBoundingClientRect();
    lastClickX = ev.clientX - r.left;
  });

  function pickLaneFromLastClick(){
    if (lastClickX == null) return 1;
    const distances = LANE_X.map(x => Math.abs(x - lastClickX));
    const bestIdx = distances.indexOf(Math.min(...distances));
    lastClickX = null;
    return bestIdx;
  }

  // ===== Unit spawn & storage =====
  let unitId = 1;
  function spawnUnit(side, type, lane) {
    const baseX = LANE_X[lane];
    const spawnX = baseX + (side === 'player' ? -30 : 30);
    const spawnY = side === 'player' ? PLAYER_Y : ENEMY_Y;
    const dir = side === 'player' ? -1 : 1;
    const unit = {
      id: unitId++,
      side,
      typeId: type.id,
      name: type.name,
      x: spawnX,
      y: spawnY,
      vy: dir * type.spd / 60,
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
    STATE.units.push(unit);
    cooldowns[side][type.id] = type.cooldown; // apply spawn cooldown
    return unit;
  }

  // ===== Spawn attempt API (player & AI call this) =====
  function attemptSpawn(side, type) {
    const actor = STATE[side];
    if (!actor) return false;
    if (actor.elixir < type.cost) {
      // feedback: flash button
      if (type._btn) {
        type._btn.style.transform = 'translateY(-6px)';
        setTimeout(()=> type._btn.style.transform = '', 140);
      }
      return false;
    }
    if (cooldowns[side][type.id] > 0) {
      // cannot spawn yet
      return false;
    }
    const lane = (side === 'player') ? pickLaneFromLastClick() : (Math.random() < 0.6 ? 1 : (Math.random() < 0.5 ? 0 : 2));
    actor.elixir -= type.cost;
    spawnUnit(side, type, lane);
    return true;
  }

  // ===== AI =====
  let nextAiPlay = now() + 0.7;
  function aiThink(dt) {
    if (now() < nextAiPlay) return;
    nextAiPlay = now() + (0.6 + Math.random() * 1.2);

    const enemy = STATE.enemy;
    // choose affordable and off-cooldown types
    const candidates = UNIT_TYPES.filter(t => enemy.elixir >= t.cost && cooldowns.enemy[t.id] <= 0);
    if (candidates.length === 0) return;

    // weighting: sometimes prefer cheaper, sometimes stronger
    let chosen;
    if (Math.random() < 0.4) {
      // pick cheapest available
      chosen = candidates.reduce((a,b)=> a.cost <= b.cost ? a : b);
    } else {
      chosen = candidates[Math.floor(Math.random() * candidates.length)];
    }
    attemptSpawn('enemy', chosen);
  }

  // ===== Simulation step =====
  function step(dt) {
    if (!STATE.running) return;

    STATE.time += dt;
    // elixir regen
    const regenRate = 1.0;
    STATE.player.elixir = clamp(STATE.player.elixir + regenRate * dt, 0, STATE.player.maxElixir);
    STATE.enemy.elixir = clamp(STATE.enemy.elixir + regenRate * dt, 0, STATE.enemy.maxElixir);

    // cooldown tick for both sides
    ['player','enemy'].forEach(side => {
      Object.keys(cooldowns[side]).forEach(k => {
        if (cooldowns[side][k] > 0) cooldowns[side][k] = Math.max(0, cooldowns[side][k] - dt);
      });
    });

    // AI decision
    aiThink(dt);

    // unit movement & combat
    for (const u of STATE.units) {
      if (u.hp <= 0) continue;
      // find nearest enemy unit in same lane
      let target = null;
      let bestDist = 1e9;
      for (const v of STATE.units) {
        if (v.side === u.side) continue;
        if (v.lane !== u.lane) continue;
        const d = Math.hypot(v.x - u.x, v.y - u.y);
        if (d < bestDist) { bestDist = d; target = v; }
      }
      
      // set goal as target unit or enemy tower
      let tx = LANE_X[u.lane];
      let ty = (u.side === 'player') ? ENEMY_Y : PLAYER_Y;
      if (target) { tx = target.x; ty = target.y; }

      const dx = tx - u.x;
      const dy = ty - u.y;
      const dist = Math.hypot(dx, dy);

      if (dist <= u.range + (target ? 0 : 12)) {
        // attack (unit or tower)
        if (now() - u.lastAttack >= u.attackCooldown) {
          u.lastAttack = now();
          if (target) {
            target.hp -= u.dmg;
          } else {
            const opp = (u.side === 'player') ? STATE.enemy : STATE.player;
            opp.towers[u.lane] -= u.dmg;
            // small recoil for visual separation
            u.x -= (dx / (dist || 1)) * 6;
          }
        }
      } else {
        // move toward goal
        const vx = (dx / (dist || 1)) * (Math.abs(u.vy) || 1) * dt * 60;
        const vy = (dy / (dist || 1)) * (Math.abs(u.vy) || 1) * dt * 60;
        u.x += vx;
        u.y += vy;
      }
    }

    // cleanup dead units
    for (let i = STATE.units.length - 1; i >= 0; i--) {
      if (STATE.units[i].hp <= 0) STATE.units.splice(i,1);
    }

    // check tower destruction -> end match
    for (const side of ['player','enemy']) {
      const s = STATE[side];
      for (let t = 0; t < 3; t++) {
        if (s.towers[t] <= 0) {
          STATE.running = false;
          STATE.winner = (side === 'player') ? 'enemy' : 'player';
          showEnd(STATE.winner);
          return;
        }
      }
    }

    // update UI periodically (each step is fine)
    updateUI();
  }

  // ===== UI update =====
  function updateUI() {
    if (elixirValue) elixirValue.textContent = Math.floor(STATE.player.elixir);
    if (enemyElixirDom) enemyElixirDom.textContent = Math.floor(STATE.enemy.elixir);

    // update each spawn button state text & overlay (cooldown)
    UNIT_TYPES.forEach(type => {
      const btn = type._btn;
      if (!btn) return;
      const affordable = STATE.player.elixir >= type.cost;
      const cd = cooldowns.player[type.id];
      const overlay = btn.querySelector('.cooldown-overlay');
      const costDom = btn.querySelector('.spawn-cost');

      if (!affordable || cd > 0) btn.classList.add('disabled'); else btn.classList.remove('disabled');

      if (cd > 0) {
        if (overlay) { overlay.style.display = 'flex'; overlay.textContent = cd.toFixed(1) + 's'; }
        if (costDom) costDom.textContent = `${type.cost} • ${cd.toFixed(1)}s`;
      } else {
        if (overlay) { overlay.style.display = 'none'; overlay.textContent = ''; }
        if (costDom) costDom.textContent = `${type.cost} ⚡`;
      }
    });
  }

  // ===== Render =====
  function render() {
    ctx.clearRect(0,0,W,H);

    // lanes background
    for (let i=0; i<LANES; i++) {
      const lx = LANE_X[i];
      ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)';
      ctx.fillRect(lx - (W*0.18), 0, W*0.36, H);
    }

    // middle river/line
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, H*0.5);
    ctx.lineTo(W, H*0.5);
    ctx.stroke();

    // draw towers
    function drawTower(side, lane, hp) {
      const x = LANE_X[lane];
      const y = side === 'player' ? PLAYER_Y + 36 : ENEMY_Y - 36;
      ctx.fillStyle = side === 'player' ? '#2f80ed' : '#ff6b6b';
      ctx.beginPath();
      ctx.roundRect(x-28, y-28, 56, 56, 8);
      ctx.fill();

      ctx.fillStyle = '#000';
      ctx.fillRect(x-32, y-42, 64, 6);
      ctx.fillStyle = '#7fff7f';
      ctx.fillRect(x-32, y-42, 64 * clamp(hp / 1000, 0, 1), 6);
    }

    drawTower('player',0,STATE.player.towers[0]);
    drawTower('player',1,STATE.player.towers[1]);
    drawTower('player',2,STATE.player.towers[2]);
    drawTower('enemy',0,STATE.enemy.towers[0]);
    drawTower('enemy',1,STATE.enemy.towers[1]);
    drawTower('enemy',2,STATE.enemy.towers[2]);

    // draw units
    for (const u of STATE.units) {
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
      ctx.fillRect(u.x - u.size, u.y - u.size - 8, u.size*2 * clamp(u.hp / u.maxHp, 0, 1), 4);

      // name
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.font = '10px sans-serif';
      ctx.fillText(u.name, u.x - u.size, u.y + u.size + 12);
    }
  }

  // ===== Match end UI =====
  function showEnd(winner) {
    overlay.classList.remove('hidden');
    overlay.style.pointerEvents = 'auto';
    overlay.style.background = 'rgba(0,0,0,0.5)';
    // clear spawn button pointer events while overlay up
    overlay.innerHTML = `
      <div style="text-align:center">
        <div style="font-size:36px;margin-bottom:12px">
          ${winner === 'player' ? 'You Win!' : 'You Lose'}
        </div>
        <button id="btn-restart" style="padding:10px 16px;border-radius:8px;border:none;cursor:pointer">Restart</button>
      </div>
    `;
    const btn = document.getElementById('btn-restart');
    if (btn) btn.addEventListener('click', resetGame);
  }

  function resetGame() {
    STATE.player = { elixir:4, maxElixir:10, towers: [1000,1000,1000] };
    STATE.enemy  = { elixir:4, maxElixir:10, towers: [1000,1000,1000] };
    STATE.units.length = 0;
    STATE.running = true;
    STATE.winner = null;
    overlay.classList.add('hidden');
    overlay.innerHTML = '';
    unitId = 1;
    // reset cooldowns to zero
    UNIT_TYPES.forEach(t => { cooldowns.player[t.id]=0; cooldowns.enemy[t.id]=0; });
  }

  // ===== Game loop =====
  let last = now();
  function loop() {
    const cur = now();
    const dt = Math.min(0.033, cur - last);
    last = cur;
    step(dt);
    render();
    requestAnimationFrame(loop);
  }

  // ===== Initialization =====
  function init() {
    // Ensure buttons are created (in case index.html changed)
    if (!spawnsDiv.querySelectorAll('.spawn-btn').length) createSpawnButtons();

    // wire any missing t._btn (defensive)
    UNIT_TYPES.forEach(t => {
      if (!t._btn) {
        const btn = Array.from(document.querySelectorAll('.spawn-btn')).find(b => b.textContent.includes(t.name));
        t._btn = btn || null;
      }
    });

    // seed enemy cooldowns slightly so they don't all drop at once
    UNIT_TYPES.forEach(t => { cooldowns.enemy[t.id] = Math.random() * 1.2; });

    last = now();
    requestAnimationFrame(loop);
  }

  // ===== Debug helpers (console) =====
  window.__game_state = STATE;
  window.__spawn = (side, typeId, lane = 1) => {
    const type = UNIT_TYPES.find(t => t.id === typeId);
    if (!type) { console.warn('unknown type', typeId); return false; }
    return attemptSpawn(side, type);
  };
  window.__forceSpawn = (side, typeId, lane = 1) => {
    const type = UNIT_TYPES.find(t => t.id === typeId);
    if (!type) return false;
    // directly spawn bypassing elixir/cooldown (debug)
    spawnUnit(side, type, lane);
    return true;
  };
  window.__reset = resetGame;

  init();

})();

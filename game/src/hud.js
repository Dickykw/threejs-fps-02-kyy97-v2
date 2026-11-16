// The DOM HUD: crosshair, hit marker, health, ammo, round timer, round score,
// money, bomb status, kill feed, buy menu, overlay panels and the tactical
// minimap (top-left, drawn on a 2D canvas). It never touches the simulation;
// main.js pushes numbers in and reads callbacks out.
const COPY = {
  start: {
    title: 'DUSTY YARD',
    copy: 'Five Vipers hold the yard. Plant the charge at A or B, or drop them all. Click to play.',
    action: 'Click to play',
  },
  paused: {
    title: 'DUSTY YARD',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  end: {
    title: 'Round over',
    copy: '',
    action: 'Next round',
  },
  match: {
    title: 'Match over',
    copy: '',
    action: 'Play again',
  },
  victory: {
    title: 'VICTORY',
    copy: '',
    action: 'Play again',
  },
  defeat: {
    title: 'DEFEAT',
    copy: '',
    action: 'Play again',
  },
  draw: {
    title: 'DRAW',
    copy: '',
    action: 'Play again',
  },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const ammo = $('ammo');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const scoreValue = $('score-value');
  const hitmarker = $('hitmarker');
  const healthFill = $('health-fill');
  const healthNum = $('health-num');
  const timerEl = $('timer');
  const roundScore = $('round-score');
  const moneyEl = $('money');
  const bombEl = $('bomb-status');
  const bombBar = $('bomb-bar');
  const bombFill = $('bomb-fill');
  const feedEl = $('feed');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const buyMenu = $('buy-menu');
  const buyMoney = $('buy-money');
  const crosshair = $('crosshair');
  const plantEl = $('plant');
  const plantFill = $('plant-fill');
  const phaseEl = $('phase');
  const buyRingFg = $('buy-ring-fg');
  const buySecs = $('buy-secs');
  const scoreboard = $('scoreboard');
  const sbKills = $('sb-kills');
  const sbAssists = $('sb-assists');
  const sbDeaths = $('sb-deaths');
  const sbMoney = $('sb-money');
  const sbWeapon = $('sb-weapon');
  const sbRound = $('sb-round');
  const sbScore = $('sb-score');
  const sbAlive = $('sb-alive');
  const controlsCard = $('controls-card');
  const controlsBody = $('controls-card-body');
  const minimap = $('minimap');
  const minimapCtx = minimap ? minimap.getContext('2d') : null;
  const mapLabel = $('map-label');
  const roundLabel = $('round-label');
  const armourNum = $('armour-num');
  const armourFill = $('armour-fill');
  const armourRow = $('armour-row');
  const slotsEl = $('slots');
  const radioEl = $('radio');
  const notifyEl = $('notify');
  const dmgArcEl = $('dmg-arc');
  const aliveEl = $('alive');
  const plantLabel = $('plant-label');
  let dmgArcTimer = 0;
  let hitTimer = 0;
  let bannerTimer = 0;
  let controlsTimer = 0;
  let lastMag = -1;
  let lastReserve = -1;
  let lastScore = -1;
  let lastHealth = -1;
  let lastArmour = -1;
  let lastTimer = -1;
  let lastMoney = -1;
  let lastWeapon = '';
  let lastBomb = '';
  let lastRound = '';
  let lastPhase = '';
  let lastSb = '';
  let lastSlots = '';
  let lastZone = '';
  let lastRoundLabel = '';

  function setText(el, value, last) {
    if (value === last) return last;
    el.textContent = value;
    return value;
  }

  return {
    setAmmo(mag, reserve, name) {
      if (mag === lastMag && reserve === lastReserve && name === lastWeapon) return;
      lastMag = mag;
      lastReserve = reserve;
      lastWeapon = name || lastWeapon;
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = reserve === '' ? '' : `/ ${reserve}`;
      if (name) weaponName.textContent = name;
      ammo.classList.toggle('empty', mag === 0);
    },
    setScore(value) {
      if (value === lastScore) return;
      lastScore = value;
      scoreValue.textContent = String(value);
    },
    setHealth(hp) {
      const v = Math.max(0, Math.round(hp));
      if (v === lastHealth) return;
      lastHealth = v;
      healthNum.textContent = String(v);
      healthFill.style.width = `${v}%`;
      healthFill.classList.toggle('low', v <= 30);
    },
    // Armour: absorbs half of incoming damage until gone. Shown beside health
    // with its own bar; "+CAP" lights up while the vest is full.
    setArmour(value, max = 100) {
      if (!armourNum) return;
      const v = Math.max(0, Math.round(value));
      if (v === lastArmour) return;
      lastArmour = v;
      armourNum.textContent = String(v);
      if (armourFill) armourFill.style.width = `${Math.round((v / Math.max(1, max)) * 100)}%`;
      if (armourRow) {
        armourRow.hidden = v <= 0;
        armourRow.classList.toggle('full', v >= max);
      }
    },
    // Round label: "ROUND 3 / 12" — first to 7, max 12 rounds.
    setRoundLabel(round, maxRounds) {
      const v = `ROUND ${round} / ${maxRounds}`;
      if (v === lastRoundLabel) return;
      lastRoundLabel = v;
      if (roundLabel) roundLabel.textContent = v;
    },
    // Zone label under the minimap: the yard zone the player stands in.
    setZone(name) {
      if (!name || name === lastZone) return;
      lastZone = name;
      if (mapLabel) mapLabel.textContent = name;
    },
    // Equipment slots (bottom-right, under the ammo): weapon slots 1/2/3
    // with the active one highlighted, then the utility pouch counts.
    // weapons: [{ key, name, owned }], current: active weapon key,
    // utility: { frag, smoke, flare, kit }.
    setSlots(slots) {
      // Spec slot bar (bottom-right): 1 Primary · 2 Secondary · 3 Knife ·
      // 4 Tactical · 5 C4. `slots` is [{ n, label, state }] with state
      // 'active' (equipped), 'locked' (not owned / empty) or ''.
      if (!slotsEl) return;
      const key = slots.map((s) => `${s.n}:${s.label}:${s.state}`).join('|');
      if (key === lastSlots) return;
      lastSlots = key;
      slotsEl.innerHTML = slots.map((s) => `<span class="slot${s.state === 'locked' ? ' locked' : ''}${s.state === 'active' ? ' active' : ''}">${s.n} ${s.label}</span>`).join('');
    },
    // Radio log (bottom-left): Viper callouts from bot events. Newest on
    // top, max 3 lines, each gone after ~4.5 s (holdMs overrides the lifetime
    // — the screenshot staging holds one line longer so it survives capture).
    radio(text, holdMs = 4500) {
      if (!radioEl) return;
      const line = document.createElement('div');
      line.className = 'radio-line';
      line.textContent = text;
      radioEl.prepend(line);
      while (radioEl.children.length > 3) radioEl.removeChild(radioEl.lastChild);
      setTimeout(() => {
        if (line.parentNode) line.parentNode.removeChild(line);
      }, holdMs);
    },
    // Notification feed (directly under the minimap, top-left): match events.
    // type: kill (white) | head (yellow) | bomb (red/orange) | round (cyan) |
    // assist (teal). Max 4 lines, each gone after ~4 s (holdMs overrides —
    // the screenshot staging holds its lines longer so they survive capture).
    // This is separate from the top-right kill feed and the bottom-left radio log.
    notify(text, type = 'kill', holdMs = 4000) {
      if (!notifyEl) return;
      const line = document.createElement('div');
      line.className = `n-line n-${type}`;
      line.textContent = text;
      notifyEl.prepend(line);
      while (notifyEl.children.length > 4) notifyEl.removeChild(notifyEl.lastChild);
      setTimeout(() => {
        if (line.parentNode) line.parentNode.removeChild(line);
      }, holdMs);
    },
    setTimer(seconds) {
      const s = Math.max(0, Math.ceil(seconds));
      if (s === lastTimer) return;
      lastTimer = s;
      const m = Math.floor(s / 60);
      const r = s % 60;
      timerEl.textContent = `${m}:${String(r).padStart(2, '0')}`;
      timerEl.classList.toggle('low', s <= 15);
    },
    setRoundScore(mine, theirs) {
      const v = `${mine} — ${theirs}`;
      if (v === lastRound) return;
      lastRound = v;
      roundScore.textContent = v;
    },
    setMoney(value) {
      if (value === lastMoney) return;
      lastMoney = value;
      moneyEl.textContent = `$${value}`;
      if (buyMoney) buyMoney.textContent = `$${value}`;
    },
    setBomb(text, frac) {
      if (text === lastBomb) {
        if (frac !== undefined && bombFill) bombFill.style.width = `${Math.round(frac * 100)}%`;
        return;
      }
      lastBomb = text;
      bombEl.textContent = text;
      bombEl.hidden = !text;
      if (bombBar) bombBar.hidden = !(text && frac !== undefined);
      if (frac !== undefined && bombFill) bombFill.style.width = `${Math.round(frac * 100)}%`;
    },
    setPlant(frac, label) {
      if (frac === null) {
        plantEl.hidden = true;
        return;
      }
      plantEl.hidden = false;
      if (label && plantLabel) plantLabel.textContent = label;
      plantFill.style.width = `${Math.round(frac * 100)}%`;
    },
    // Damage direction arc: a red arc around the crosshair pointing toward
    // the attacker (angle in degrees, 0 = ahead, clockwise). Fades after ~1 s.
    damageArc(angleDeg) {
      if (!dmgArcEl) return;
      dmgArcEl.style.setProperty('--rot', `${Math.round(angleDeg)}deg`);
      dmgArcEl.classList.add('on');
      clearTimeout(dmgArcTimer);
      dmgArcTimer = setTimeout(() => dmgArcEl.classList.remove('on'), 1000);
    },
    // Match-header alive pips: one dot per living Viper + one for the player.
    setAlive(vipers, playerAlive) {
      if (!aliveEl) return;
      const v = '●'.repeat(Math.max(0, vipers)) + '○'.repeat(Math.max(0, 5 - vipers));
      aliveEl.textContent = `${v} · ${playerAlive ? '●' : '○'} YOU`;
    },
    setSpread(spreadPx) {
      // Crosshair gap grows with spread so stopping to aim reads on screen.
      crosshair.style.setProperty('--gap', `${Math.round(spreadPx)}px`);
    },
    hitMarker(killed, holdMs = 120, head = false) {
      // One fixed div: pops to 1.3x and fades over ~120 ms. White on a body
      // hit, amber on a 4x headshot, red on a kill.
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', !!killed);
      hitmarker.classList.toggle('head', !!head && !killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill', 'head'), holdMs);
    },
    setPhase(label) {
      if (label === lastPhase) return;
      lastPhase = label;
      if (phaseEl) phaseEl.textContent = label;
    },
    // Buy-phase countdown ring: frac 1..0 drains the ring, secs is the
    // number shown in its middle.
    setBuyCountdown(frac, secs) {
      if (buyRingFg) buyRingFg.style.strokeDashoffset = String(119.4 * (1 - Math.max(0, Math.min(1, frac))));
      if (buySecs) buySecs.textContent = String(Math.max(0, Math.ceil(secs)));
    },
    setScoreboard(data) {
      // data: { kills, assists, deaths, money, weapon, round, mine, theirs, alive }
      const key = `${data.kills}|${data.assists}|${data.deaths}|${data.money}|${data.weapon}|${data.round}|${data.mine}|${data.theirs}|${data.alive}`;
      if (key === lastSb) return;
      lastSb = key;
      if (sbKills) sbKills.textContent = String(data.kills);
      if (sbAssists) sbAssists.textContent = String(data.assists || 0);
      if (sbDeaths) sbDeaths.textContent = String(data.deaths);
      if (sbMoney) sbMoney.textContent = `$${data.money}`;
      if (sbWeapon) sbWeapon.textContent = data.weapon;
      if (sbRound) sbRound.textContent = String(data.round);
      if (sbScore) sbScore.textContent = `${data.mine} — ${data.theirs}`;
      if (sbAlive) sbAlive.textContent = String(data.alive);
    },
    showScoreboard() {
      if (scoreboard) scoreboard.hidden = false;
    },
    hideScoreboard() {
      if (scoreboard) scoreboard.hidden = true;
    },
    scoreboardVisible() {
      return !!scoreboard && !scoreboard.hidden;
    },
    // Control card: one card matched to the input device, shown at match
    // start. Auto-dismisses after 12 s; the integrator also hides it on the
    // first shot.
    showControlsCard(touch) {
      if (!controlsCard) return;
      if (controlsBody) {
        controlsBody.textContent = touch
          ? 'FIRE (bottom-right, big red) shoots · Plant (right side) — hold near a site · Nade (right side) throws · Left stick moves · Drag the right side to look'
          : 'WASD move · Mouse look · Click fire · R reload · 1 / 2 / 3 weapons · G grenade · E plant · B buy menu · Ctrl crouch · Space jump';
      }
      controlsCard.hidden = false;
      clearTimeout(controlsTimer);
      controlsTimer = setTimeout(() => { controlsCard.hidden = true; }, 12000);
    },
    hideControlsCard() {
      if (!controlsCard) return;
      controlsCard.hidden = true;
      clearTimeout(controlsTimer);
    },
    feed(text, holdMs = 5000) {
      const line = document.createElement('div');
      line.textContent = text;
      feedEl.prepend(line);
      while (feedEl.children.length > 5) feedEl.removeChild(feedEl.lastChild);
      setTimeout(() => {
        if (line.parentNode) line.parentNode.removeChild(line);
      }, holdMs);
    },
    banner(titleText, subText, good, holdMs = 2600) {
      bannerTitle.textContent = titleText;
      bannerSub.textContent = subText || '';
      banner.classList.toggle('good', !!good);
      banner.classList.toggle('bad', !good);
      banner.hidden = false;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => {
        banner.hidden = true;
      }, holdMs);
    },
    showOverlay(mode, score) {
      const text = COPY[mode] || COPY.start;
      title.textContent = text.title;
      if (mode === 'end') copy.textContent = text.copy || `Round over. Score ${score}.`;
      else if (mode === 'match' || mode === 'victory' || mode === 'defeat' || mode === 'draw') {
        copy.textContent = text.copy || `Final score ${score}.`;
      } else copy.textContent = text.copy;
      play.textContent = text.action;
      // Match-end screens read as VICTORY / DEFEAT / DRAW, not a round panel.
      overlay.classList.toggle('match-end', mode === 'victory' || mode === 'defeat' || mode === 'draw');
      overlay.classList.toggle('win', mode === 'victory');
      overlay.classList.toggle('lose', mode === 'defeat');
      overlay.classList.toggle('tied', mode === 'draw');
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
    showBuy() {
      buyMenu.hidden = false;
    },
    hideBuy() {
      buyMenu.hidden = true;
    },
    buyVisible() {
      return !buyMenu.hidden;
    },
    // Minimap: top-down yard (56 x 40 m) on the small canvas. Sites as
    // amber/blue rings, the player as a teal arrow, living Vipers as red
    // dots, a planted charge as a pulsing amber dot.
    drawMinimap(playerPos, yaw, bots, bombState, bombPos, bounds) {
      if (!minimapCtx || !minimap) return;
      const ctx = minimapCtx;
      const W = minimap.width;
      const H = minimap.height;
      const sx = (W - 16) / (bounds.maxX - bounds.minX);
      const sz = (H - 16) / (bounds.maxZ - bounds.minZ);
      const px = (x) => 8 + (x - bounds.minX) * sx;
      const pz = (z) => 8 + (z - bounds.minZ) * sz;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(16, 20, 24, 0.72)';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(240, 168, 48, 0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(px(bounds.minX), pz(bounds.minZ), (bounds.maxX - bounds.minX) * sx, (bounds.maxZ - bounds.minZ) * sz);
      // Lane dividers (same x as the world walls).
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
      ctx.beginPath();
      ctx.moveTo(px(-8), pz(-14)); ctx.lineTo(px(-8), pz(14));
      ctx.moveTo(px(8), pz(-14)); ctx.lineTo(px(8), pz(14));
      ctx.stroke();
      // Sites.
      for (const [site, color, x, z] of [['A', '#f5a623', -19, -13.5], ['B', '#4aa8ff', 19, -13.5]]) {
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.arc(px(x), pz(z), 9, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.font = 'bold 9px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(site, px(x), pz(z));
      }
      // Planted charge.
      if (bombState === 'planted' && bombPos) {
        ctx.fillStyle = '#ffb020';
        ctx.beginPath();
        ctx.arc(px(bombPos.x), pz(bombPos.z), 4, 0, Math.PI * 2);
        ctx.fill();
      }
      // Vipers (living only).
      ctx.fillStyle = '#ff5a2a';
      for (const bot of bots || []) {
        if (!bot.alive) continue;
        ctx.beginPath();
        ctx.arc(px(bot.pos.x), pz(bot.pos.z), 3, 0, Math.PI * 2);
        ctx.fill();
      }
      // Player arrow.
      ctx.save();
      ctx.translate(px(playerPos.x), pz(playerPos.z));
      ctx.rotate(Math.atan2(-Math.sin(yaw), -Math.cos(yaw)));
      ctx.fillStyle = '#19b5a6';
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(4.5, 5);
      ctx.lineTo(-4.5, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    },
  };
}

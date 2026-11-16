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
  let hitTimer = 0;
  let bannerTimer = 0;
  let controlsTimer = 0;
  let lastMag = -1;
  let lastReserve = -1;
  let lastScore = -1;
  let lastHealth = -1;
  let lastTimer = -1;
  let lastMoney = -1;
  let lastWeapon = '';
  let lastBomb = '';
  let lastRound = '';
  let lastPhase = '';
  let lastSb = '';

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
      ammoReserve.textContent = `/ ${reserve}`;
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
    setPlant(frac) {
      if (frac === null) {
        plantEl.hidden = true;
        return;
      }
      plantEl.hidden = false;
      plantFill.style.width = `${Math.round(frac * 100)}%`;
    },
    setSpread(spreadPx) {
      // Crosshair gap grows with spread so stopping to aim reads on screen.
      crosshair.style.setProperty('--gap', `${Math.round(spreadPx)}px`);
    },
    hitMarker(killed, holdMs = 120, head = false) {
      // One fixed div: pops to 1.3x and fades over ~120 ms. White on a body
      // hit, amber on a 3x headshot, red on a kill.
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
      // data: { kills, deaths, money, weapon, round, mine, theirs, alive }
      const key = `${data.kills}|${data.deaths}|${data.money}|${data.weapon}|${data.round}|${data.mine}|${data.theirs}|${data.alive}`;
      if (key === lastSb) return;
      lastSb = key;
      if (sbKills) sbKills.textContent = String(data.kills);
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
    feed(text) {
      const line = document.createElement('div');
      line.textContent = text;
      feedEl.prepend(line);
      while (feedEl.children.length > 4) feedEl.removeChild(feedEl.lastChild);
      setTimeout(() => {
        if (line.parentNode) line.parentNode.removeChild(line);
      }, 5000);
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
      else if (mode === 'match') copy.textContent = text.copy || `Final score ${score}.`;
      else copy.textContent = text.copy;
      play.textContent = text.action;
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

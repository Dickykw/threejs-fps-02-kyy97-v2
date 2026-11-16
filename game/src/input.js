// Keyboard + mouse (pointer lock) and full touch controls for phones.
// Desktop: pointer-lock mouse look, WASD, click fire, R reload, Space jump,
// Ctrl/C crouch, 1/2/3 weapons, G grenade, E plant, B buy menu.
// Touch: virtual joystick (bottom left) for movement, drag on the right half
// to look, on-screen buttons: FIRE, RELOAD, JUMP, CROUCH, weapon switch,
// GRENADE, PLANT. The touch UI is built here and shown on touch devices;
// the desktop experience (pointer lock) is untouched.
export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const state = {
    keys,
    locked: false,
    firing: false,
    lookX: 0,
    lookY: 0,
    move: { x: 0, y: 0 },
    isTouch: false,
  };
  const actions = []; // one-shot actions for main.js to drain: reload, grenade, w1, w2, w3, buy

  function setKey(event, down) {
    if (down) keys.add(event.code);
    else keys.delete(event.code);
    if (event.code === 'Space') event.preventDefault();
  }

  window.addEventListener('keydown', (event) => {
    setKey(event, true);
    if (event.repeat) return;
    if (event.code === 'Tab') event.preventDefault(); // TAB holds the scoreboard; never move focus
    if (event.code === 'KeyR') actions.push('reload');
    if (event.code === 'KeyG') actions.push('grenade');
    if (event.code === 'Digit1') actions.push('w1');
    if (event.code === 'Digit2') actions.push('w2');
    if (event.code === 'Digit3') actions.push('w3');
    if (event.code === 'KeyB') actions.push('buy');
    if (event.code === 'KeyQ') actions.push('wnext');
  });
  window.addEventListener('keyup', (event) => setKey(event, false));
  window.addEventListener('blur', () => {
    keys.clear();
    state.firing = false;
    state.move.x = 0;
    state.move.y = 0;
  });
  window.addEventListener('mousemove', (event) => {
    if (!state.locked) return;
    state.lookX += event.movementX;
    state.lookY += event.movementY;
  });
  window.addEventListener('mousedown', (event) => {
    if (state.locked && event.button === 0) state.firing = true;
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) state.firing = false;
  });
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) {
      keys.clear();
      state.firing = false;
    }
    onLockChange(state.locked);
  });

  // ---- touch controls ----
  const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  let joyId = null;
  let joyCenter = { x: 0, y: 0 };
  let lookId = null;
  let lookLast = { x: 0, y: 0 };
  let joyEl = null;
  let knobEl = null;
  let lookEl = null;

  const JOY_RADIUS = 52;

  function showTouchUI(force) {
    if ((!hasTouch && !force) || state.isTouch) return;
    state.isTouch = true;
    document.body.classList.add('touch');
    buildTouchUI();
  }

  function buildTouchUI() {
    const root = document.getElementById('touch');
    if (!root) return;
    root.hidden = false;

    joyEl = document.getElementById('joy');
    knobEl = document.getElementById('joy-knob');
    lookEl = document.getElementById('look');

    function joyStart(event) {
      const t = event.changedTouches[0];
      joyId = t.identifier;
      const rect = joyEl.getBoundingClientRect();
      joyCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      joyMove(event);
      event.preventDefault();
    }
    function joyMove(event) {
      if (joyId === null) return;
      for (const t of event.changedTouches) {
        if (t.identifier !== joyId) continue;
        let dx = (t.clientX - joyCenter.x) / JOY_RADIUS;
        let dy = (t.clientY - joyCenter.y) / JOY_RADIUS;
        const len = Math.hypot(dx, dy);
        if (len > 1) {
          dx /= len;
          dy /= len;
        }
        state.move.x = dx;
        state.move.y = -dy; // pushing up = forward
        knobEl.style.transform = `translate(calc(-50% + ${dx * 34}px), calc(-50% + ${dy * 34}px))`;
      }
      event.preventDefault();
    }
    function joyEnd(event) {
      for (const t of event.changedTouches) {
        if (t.identifier !== joyId) continue;
        joyId = null;
        state.move.x = 0;
        state.move.y = 0;
        knobEl.style.transform = 'translate(-50%, -50%)';
      }
    }

    joyEl.addEventListener('touchstart', joyStart, { passive: false });
    joyEl.addEventListener('touchmove', joyMove, { passive: false });
    joyEl.addEventListener('touchend', joyEnd);
    joyEl.addEventListener('touchcancel', joyEnd);

    function lookStart(event) {
      const t = event.changedTouches[0];
      lookId = t.identifier;
      lookLast = { x: t.clientX, y: t.clientY };
      event.preventDefault();
    }
    function lookMove(event) {
      if (lookId === null) return;
      for (const t of event.changedTouches) {
        if (t.identifier !== lookId) continue;
        state.lookX += (t.clientX - lookLast.x) * 2.4;
        state.lookY += (t.clientY - lookLast.y) * 2.4;
        lookLast = { x: t.clientX, y: t.clientY };
      }
      event.preventDefault();
    }
    function lookEnd(event) {
      for (const t of event.changedTouches) {
        if (t.identifier === lookId) lookId = null;
      }
    }

    lookEl.addEventListener('touchstart', lookStart, { passive: false });
    lookEl.addEventListener('touchmove', lookMove, { passive: false });
    lookEl.addEventListener('touchend', lookEnd);
    lookEl.addEventListener('touchcancel', lookEnd);

    // Buttons: hold-to-fire / hold-to-crouch, tap for the rest.
    function bindButton(id, down, up) {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('touchstart', (event) => {
        event.preventDefault();
        event.stopPropagation();
        el.classList.add('down');
        down();
      }, { passive: false });
      const release = (event) => {
        event.preventDefault();
        el.classList.remove('down');
        if (up) up();
      };
      el.addEventListener('touchend', release);
      el.addEventListener('touchcancel', release);
    }

    bindButton('btn-fire', () => { state.firing = true; }, () => { state.firing = false; });
    bindButton('btn-reload', () => actions.push('reload'));
    bindButton('btn-jump', () => keys.add('Space'), () => keys.delete('Space'));
    bindButton('btn-crouch', () => keys.add('KeyC'), () => keys.delete('KeyC'));
    bindButton('btn-grenade', () => actions.push('grenade'));
    bindButton('btn-plant', () => keys.add('KeyE'), () => keys.delete('KeyE'));
    bindButton('btn-w1', () => actions.push('w1'));
    bindButton('btn-w2', () => actions.push('w2'));
    bindButton('btn-w3', () => actions.push('w3'));
    bindButton('btn-buy', () => actions.push('buy'));
  }

  // Touch controls appear on the FIRST actual touch, not on capability alone:
  // headless browsers and touchscreen laptops report touch support, and showing
  // the joystick on a desktop would be wrong. A tap on "Click to play" is a
  // touchstart, so phones get the controls before the first round.
  window.addEventListener('touchstart', showTouchUI, { passive: true, once: true });
  // ?touch=1 forces the touch UI (mobile-layout testing / screenshots).
  if (new URLSearchParams(location.search).has('touch')) showTouchUI(true);

  return {
    state,
    isTouchDevice() {
      return hasTouch;
    },
    requestLock() {
      if (state.isTouch) return; // phones never use pointer lock
      canvas.requestPointerLock();
    },
    takeLook() {
      const x = state.lookX;
      const y = state.lookY;
      state.lookX = 0;
      state.lookY = 0;
      return { x, y };
    },
    takeActions() {
      if (!actions.length) return actions;
      const out = actions.splice(0, actions.length);
      return out;
    },
  };
}

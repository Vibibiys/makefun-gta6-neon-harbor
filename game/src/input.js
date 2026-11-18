// Neon Harbor: Vice Run — keyboard and mouse input.
//
// createInput(canvas) returns a live input object in the shared state
// shape:
//
//   input.keys    Set of KeyboardEvent.code strings currently held down.
//   input.pressed Set of codes pressed since they were last consumed —
//                 the edge trigger. A code lands here once per physical
//                 press (key repeat is ignored) and stays until consume()
//                 or clearPressed() removes it, so a press between frames
//                 is never lost and never double-counted.
//   input.mouse   { x, y, down, clicked } in canvas coordinates (CSS
//                 pixels relative to the canvas's top-left corner).
//                 `clicked` is the mouse equivalent of `pressed`: set on
//                 mousedown, cleared by consumeClick().
//   input.consume(code) -> boolean: true (once) if code was pressed.
//
// Game keys (space and the arrows, which would otherwise scroll the page)
// are preventDefaulted. Everything else is left alone so browser shortcuts
// and devtools keep working.

const GAME_KEYS = new Set([
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

export function createInput(canvas) {
  const keys = new Set();
  const pressed = new Set();
  const mouse = { x: 0, y: 0, down: false, clicked: false };

  const target = canvas || null;

  function toCanvasCoords(event) {
    if (target && typeof target.getBoundingClientRect === 'function') {
      const rect = target.getBoundingClientRect();
      // Scale from CSS pixels into the canvas's own pixel space when the
      // backing store differs (e.g. a fixed-resolution canvas stretched
      // to the window), so aim points land where the player clicked.
      const scaleX = rect.width > 0 && target.width ? target.width / rect.width : 1;
      const scaleY = rect.height > 0 && target.height ? target.height / rect.height : 1;
      mouse.x = (event.clientX - rect.left) * scaleX;
      mouse.y = (event.clientY - rect.top) * scaleY;
    } else {
      mouse.x = event.clientX || 0;
      mouse.y = event.clientY || 0;
    }
  }

  function onKeyDown(event) {
    if (GAME_KEYS.has(event.code)) event.preventDefault();
    if (!event.repeat && !keys.has(event.code)) pressed.add(event.code);
    keys.add(event.code);
  }

  function onKeyUp(event) {
    if (GAME_KEYS.has(event.code)) event.preventDefault();
    keys.delete(event.code);
  }

  function onBlur() {
    // A key released while the window is unfocused never sends keyup;
    // without this, Mara would keep driving into a wall after alt-tab.
    keys.clear();
    mouse.down = false;
  }

  function onMouseMove(event) {
    toCanvasCoords(event);
  }

  function onMouseDown(event) {
    toCanvasCoords(event);
    mouse.down = true;
    mouse.clicked = true;
    // Record the button as a pseudo-key so polling code can treat a held
    // mouse button like any other held control.
    if (!keys.has('MouseLeft')) pressed.add('MouseLeft');
    keys.add('MouseLeft');
  }

  function onMouseUp(event) {
    toCanvasCoords(event);
    mouse.down = false;
    keys.delete('MouseLeft');
  }

  function onTouchStart(event) {
    const touch = event.touches && event.touches[0];
    if (touch) {
      toCanvasCoords(touch);
      mouse.down = true;
      mouse.clicked = true;
    }
  }

  function onTouchMove(event) {
    const touch = event.touches && event.touches[0];
    if (touch) toCanvasCoords(touch);
  }

  function onTouchEnd() {
    mouse.down = false;
  }

  function onContextMenu(event) {
    // Right-click in the game area is aim / secondary fire, not a menu.
    if (target) event.preventDefault();
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }
  if (target && typeof target.addEventListener === 'function') {
    target.addEventListener('mousedown', onMouseDown);
    target.addEventListener('touchstart', onTouchStart, { passive: true });
    target.addEventListener('touchmove', onTouchMove, { passive: true });
    target.addEventListener('touchend', onTouchEnd);
    target.addEventListener('touchcancel', onTouchEnd);
    target.addEventListener('contextmenu', onContextMenu);
  }

  const input = {
    keys,
    pressed,
    mouse,

    /** True once per physical press of `code`; consuming clears the edge. */
    consume(code) {
      if (!pressed.has(code)) return false;
      pressed.delete(code);
      return true;
    },

    /** True while `code` is held down. */
    isDown(code) {
      return keys.has(code);
    },

    /** True once per mouse click; consuming clears the click edge. */
    consumeClick() {
      if (!mouse.clicked) return false;
      mouse.clicked = false;
      return true;
    },

    /** Drop all pending edge presses (used on screen changes). */
    clearPressed() {
      pressed.clear();
      mouse.clicked = false;
    },

    /**
     * Movement axes from the held keys: x is -1 (west) .. 1 (east) from
     * A/D or the arrows, y is -1 (north) .. 1 (south) from W/S or arrows.
     */
    axisX() {
      return (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0)
        - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    },
    axisY() {
      return (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0)
        - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0);
    },

    /** Remove every listener this input registered. */
    detach() {
      if (typeof window !== 'undefined') {
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onBlur);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      }
      if (target && typeof target.removeEventListener === 'function') {
        target.removeEventListener('mousedown', onMouseDown);
        target.removeEventListener('touchstart', onTouchStart);
        target.removeEventListener('touchmove', onTouchMove);
        target.removeEventListener('touchend', onTouchEnd);
        target.removeEventListener('touchcancel', onTouchEnd);
        target.removeEventListener('contextmenu', onContextMenu);
      }
    },
  };

  return input;
}

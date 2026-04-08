/**
 * anime-utils.ts — Shared anime.js animation helpers
 *
 * Used by GameScene (Phaser object animations) and main.ts (DOM animations).
 * Anime.js v4 can animate any JS object with numeric properties — including
 * Phaser GameObjects which expose x, y, alpha, scaleX, scaleY directly.
 */

import { animate, createTimeline, stagger, spring } from "animejs";

// ── Re-export core for convenience ──────────────────────────────────────────
export { animate, createTimeline, stagger, spring };

// ── DOM Overlay: floating damage numbers and effect banners ─────────────────

let overlay: HTMLElement | null = null;

export function getOverlay(): HTMLElement {
  if (!overlay) {
    overlay = document.getElementById("game-overlay") as HTMLElement;
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "game-overlay";
      document.body.appendChild(overlay);
    }
  }
  return overlay;
}

/**
 * Spawn a damage number at canvas-space coordinates (screen px).
 * Call with screen coords, not Phaser world coords.
 */
export function spawnDmgNumber(
  screenX: number,
  screenY: number,
  damage: number,
  isCrit: boolean,
) {
  const ol = getOverlay();
  const el = document.createElement("div");
  el.className = "dmg-popup" + (isCrit ? " crit" : "");
  el.textContent = isCrit ? `${damage}!!` : String(damage);
  el.style.left = `${screenX}px`;
  el.style.top  = `${screenY}px`;
  ol.appendChild(el);

  animate(el, {
    translateY: [0, -(isCrit ? 80 : 50)],
    translateX: [0, (Math.random() - 0.5) * (isCrit ? 30 : 16)],
    scale: isCrit ? [0.4, 1.6, 1.2] : [0.6, 1.1, 0.9],
    opacity: [1, 1, 0],
    duration: isCrit ? 1200 : 900,
    easing: "easeOutCubic",
    onComplete: () => el.remove(),
  });
}

/**
 * Spawn a floating text label (XP, gold, quest reward, etc.)
 */
export function spawnFloatLabel(
  screenX: number,
  screenY: number,
  text: string,
  color = "#88dd44",
) {
  const ol = getOverlay();
  const el = document.createElement("div");
  el.className = "float-label";
  el.textContent = text;
  el.style.left = `${screenX}px`;
  el.style.top  = `${screenY}px`;
  el.style.color = color;
  ol.appendChild(el);

  animate(el, {
    translateY: [0, -60],
    opacity: [1, 1, 0],
    duration: 1400,
    easing: "easeOutQuart",
    onComplete: () => el.remove(),
  });
}

/**
 * Full-width banner — level up, kill streak, quest complete
 */
export function spawnBanner(text: string, sub: string, type: "levelup" | "streak" | "quest") {
  const ol = getOverlay();
  const el = document.createElement("div");
  el.className = `event-banner banner-${type}`;
  el.innerHTML = `<span class="banner-main">${text}</span><span class="banner-sub">${sub}</span>`;
  ol.appendChild(el);

  const tl = createTimeline({ onComplete: () => el.remove() });
  tl.add(el, {
    translateY: ["-100%", "0%"],
    opacity: [0, 1],
    duration: 380,
    easing: "easeOutBack",
  });
  tl.add(el, {
    opacity: [1, 0],
    translateY: ["0%", "-40%"],
    duration: 400,
    easing: "easeInQuart",
    delay: 1600,
  });
}

// ── Phaser object animations (animate Phaser prop objects directly) ──────────

/**
 * Animate a Phaser container to new world coords — spring physics feel.
 */
export function moveContainer(
  target: { x: number; y: number },
  toX: number,
  toY: number,
  onComplete?: () => void,
) {
  animate(target, {
    x: toX,
    y: toY,
    duration: 420,
    easing: "easeOutCubic",
    onComplete,
  });
}

/**
 * Lunge-and-return combat animation for an agent container.
 */
export function combatLunge(
  target: { x: number; y: number },
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  onPeak: () => void,
) {
  const tl = createTimeline();
  tl.add(target, {
    x: toX, y: toY,
    duration: 120,
    easing: "easeInQuad",
    onComplete: onPeak,
  });
  tl.add(target, {
    x: fromX, y: fromY,
    duration: 260,
    easing: "easeOutBack",
  });
}

/**
 * Recoil + red-flash on a mob.
 * target must have x, y (Phaser container) and alpha (Phaser object).
 */
export function mobRecoil(
  container: { x: number; y: number },
  bodyAlpha: { alpha: number },
  recoilX: number,
  recoilY: number,
  origX: number,
  origY: number,
) {
  animate(container, { x: recoilX, y: recoilY, duration: 60, easing: "easeOutQuad" });
  animate(container, { x: origX, y: origY, duration: 140, easing: "easeOutBack", delay: 60 });
  animate(bodyAlpha, { alpha: 0.3, duration: 60, easing: "linear" });
  animate(bodyAlpha, { alpha: 1, duration: 120, easing: "linear", delay: 60 });
}

/**
 * Death shrink + fade for a Phaser container.
 */
export function deathFade(
  target: { alpha: number; scaleX: number; scaleY: number },
  onComplete: () => void,
) {
  animate(target, {
    alpha: 0,
    scaleX: 0.15,
    scaleY: 0.15,
    duration: 500,
    easing: "easeInBack",
    onComplete,
  });
}

/**
 * Idle breathing animation — loops by re-scheduling itself.
 */
export function idleBreathe(
  target: { scaleX: number; scaleY: number },
  baseScaleX: number,
  baseScaleY: number,
) {
  const breathe = () => {
    animate(target, {
      scaleX: baseScaleX * 0.97,
      scaleY: baseScaleY * 1.04,
      duration: 1200,
      easing: "easeInOutSine",
      onComplete: () => {
        animate(target, {
          scaleX: baseScaleX,
          scaleY: baseScaleY,
          duration: 1200,
          easing: "easeInOutSine",
          onComplete: breathe,
        });
      },
    });
  };
  breathe();
}

// ── UI DOM animations ────────────────────────────────────────────────────────

/**
 * Animate an agent card entering the DOM.
 */
export function animateCardEnter(el: HTMLElement, index: number) {
  el.style.opacity = "0";
  el.style.transform = "translateY(12px)";
  animate(el, {
    opacity: [0, 1],
    translateY: [12, 0],
    duration: 320,
    delay: index * 60,
    easing: "easeOutCubic",
  });
}

/**
 * Flash an agent card on damage — brief red border pulse.
 */
export function flashCardDamage(el: HTMLElement) {
  animate(el, {
    borderColor: ["rgba(255,60,60,0.7)", "rgba(255,255,255,0.04)"],
    duration: 600,
    easing: "easeOutQuart",
  });
}

/**
 * Flash an agent card on level up — golden shimmer.
 */
export function flashCardLevelUp(el: HTMLElement) {
  animate(el, {
    borderColor: ["rgba(200,168,75,0.9)", "rgba(255,255,255,0.04)"],
    boxShadow: [
      "0 0 16px rgba(200,168,75,0.4)",
      "0 0 0px rgba(200,168,75,0)",
    ],
    duration: 900,
    easing: "easeOutQuart",
  });
}

/**
 * Slide-in a new event log entry from the right.
 */
export function animateLogEntry(el: HTMLElement) {
  animate(el, {
    translateX: [24, 0],
    opacity: [0, 1],
    duration: 220,
    easing: "easeOutCubic",
  });
}

/**
 * Stagger-animate all children of a container (e.g. leaderboard rows).
 */
export function staggerRows(parent: HTMLElement) {
  const rows = Array.from(parent.children) as HTMLElement[];
  animate(rows, {
    translateX: [16, 0],
    opacity: [0, 1],
    duration: 250,
    delay: stagger(40),
    easing: "easeOutCubic",
  });
}

/**
 * Animate a numeric value change in an element (count-up / count-down).
 */
export function animateNumber(el: HTMLElement, from: number, to: number, duration = 600) {
  const obj = { val: from };
  animate(obj, {
    val: to,
    duration,
    easing: "easeOutCubic",
    onUpdate: () => { el.textContent = Math.round(obj.val).toLocaleString(); },
  });
}

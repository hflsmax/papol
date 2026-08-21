// How a cow behaves and how it looks while it does it.
//
// Out here rather than in PdfPage because none of it is about a page: it is
// arithmetic on a record and a handful of attribute writes, and having it
// on its own means it can be driven by something other than a document
// while it is being got right.

import {
  COW_BOX, COW_GROUND, COW_LEGS, COW_TAIL_PIVOT, COW_EAR_PIVOT, COW_HEAD_PIVOT,
} from './glyphs';

// How fast it walks across the page. Slow: a cow crossing a page in half a
// minute is a cow.
export const COW_SPEED = 0.00003;
// A cow is either walking somewhere or has stopped to graze, and does each
// for a while before thinking better of it.
const COW_WALK = [1400, 3600];
const COW_GRAZE = [2200, 6000];
const spell = ([a, b]) => a + Math.random() * (b - a);
// How long it takes to get under way, and to come to a stop. An animal
// that reaches its walking speed in one frame is a vehicle — and the legs
// take their beat from the speed, so easing it here is also what makes the
// walk wind up and wind down instead of switching on.
const COW_EASE = 350;
// How long a whole turn takes. Not a mirroring: see the through-zero
// scaleX in poseCow.
const COW_TURN = 260;
// Full strides a second at walking pace, how far a leg swings either side
// of standing, and how much of a stride a foot spends on the ground.
//
// A stride's length here is the arc a leg tip covers, and on this drawing
// that is about a fifth of the ground the animal covers in the same time:
// the legs are far too short for their body, which is what makes it a cow
// and not a horse. So the beat is set by eye to read as a plod. What it is
// tied to is the speed, which is the part that matters — feet that keep
// walking after the animal has stopped are what the eye actually catches.
const COW_BEAT = 2;
const COW_SWING = 15;
const COW_DUTY = 0.65;
// How far the body rises in the middle of a stride, and how far the head
// goes down to the page to graze — far enough to put the muzzle just off
// the paper, which about thirty degrees on this drawing does.
const COW_BOB = 0.9;
const COW_STOOP = 29;
// How long the head takes to get down there and back up.
const COW_NOD = 320;
// An ear goes back about this often, and stays back about this long. It
// means nothing and nothing depends on it, which is the point: an animal
// standing completely still is a picture of an animal.
const COW_EAR_EVERY = [3800, 9000];
const COW_EAR_HELD = 130;
const COW_EAR_BACK = 30;
// The feet are not centred in the box — the head takes up the front of it
// — so neither is what they stand on.
const SHADOW_AT = 10;
// And the tail flicks properly, now and then, on top of its slow swing.
const COW_FLICK_EVERY = [5000, 14000];
const COW_FLICK_HELD = 420;

// Where the animal has got to. Mutates the record in place; see App's
// dropCow for why there is no state here.
export function stepCow(c, dt, now) {
  // What it is doing. This changes every few seconds, so it is two
  // comparisons a frame and not worth keeping anywhere else.
  if (!c.held && now >= c.until) {
    if (!c.grazing) {
      c.grazing = true;
      c.until = now + spell(COW_GRAZE);
    } else {
      const dir = Math.random() < 0.5 ? -1 : 1;
      c.grazing = false;
      c.facing = dir;
      c.tvx = dir * COW_SPEED * c.pace;
      // Barely any drift up or down: a page is not a field.
      c.tvy = (Math.random() - 0.5) * COW_SPEED * 0.3;
      c.until = now + spell(COW_WALK);
    }
  }

  const grip = 1 - Math.exp(-dt / COW_EASE);
  const still = c.grazing || c.held;
  c.vx += ((still ? 0 : c.tvx) - c.vx) * grip;
  c.vy += ((still ? 0 : c.tvy) - c.vy) * grip;

  if (!c.held) {
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    // The edges of the page are the edges of the field.
    if (c.x < 0.05) { c.x = 0.05; c.tvx = -c.tvx; c.vx = -c.vx; c.facing = -c.facing; }
    if (c.x > 0.95) { c.x = 0.95; c.tvx = -c.tvx; c.vx = -c.vx; c.facing = -c.facing; }
    if (c.y < 0.05) { c.y = 0.05; c.tvy = -c.tvy; c.vy = -c.vy; }
    if (c.y > 0.95) { c.y = 0.95; c.tvy = -c.tvy; c.vy = -c.vy; }
  }

  // Which way round it is. The drawing faces left, so a cow walking right
  // is the same drawing seen from its other side — and it used to get
  // there by having its scaleX negated, which turned the animal inside out
  // between one frame and the next. It travels now, at a steady rate,
  // through zero: the cow narrows to a line and opens out the other way,
  // which is a cow swinging round to face where it is going.
  const look = c.facing === 1 ? -1 : 1;
  const swingBy = (2 * dt) / COW_TURN;
  c.turn += Math.max(-swingBy, Math.min(swingBy, look - c.turn));

  // Where in a stride it is, and how much of a stride to show. Both come
  // off the speed, so a cow slowing to a stop puts its feet down slower
  // and then stops putting them down.
  const rate = Math.abs(c.vx) / (COW_SPEED * c.pace);
  c.stride = (c.stride + (rate * COW_BEAT * dt) / 1000) % 1;
  c.gait += (Math.min(1, rate) - c.gait) * grip;

  c.head += ((c.grazing && !c.held ? 1 : 0) - c.head) * (1 - Math.exp(-dt / COW_NOD));

  if (now >= c.earAt) {
    c.earAt = now + spell(COW_EAR_EVERY);
    c.earTill = now + COW_EAR_HELD;
  }
  c.ear += ((now < c.earTill ? 1 : 0) - c.ear) * (1 - Math.exp(-dt / 45));

  if (now >= c.tailAt) {
    c.tailAt = now + spell(COW_FLICK_EVERY);
    c.tailTill = now + COW_FLICK_HELD;
  }
}

// How the animal looks, right now, written straight onto the groups. No
// state, no React: this runs every frame and reconciling it would cost
// more than the arithmetic above and below put together.
export function poseCow(c, parts, now, k, cx, cy) {
  // It arrives with a little weight in it and settles. Damped hard enough
  // that it is over before it can turn into a bounce.
  const age = now - c.born;
  const settle = age >= 0 && age < 700
    ? 1 - 0.09 * Math.exp(-age / 130) * Math.cos(age / 55)
    : 1;
  parts.root.setAttribute(
    'transform',
    `translate(${cx.toFixed(2)} ${cy.toFixed(2)}) scale(${(k * settle).toFixed(4)})`
  );

  // Never quite zero: a matrix with no width in it is a matrix a browser
  // is entitled to have opinions about.
  const sx = Math.abs(c.turn) < 0.02 ? (c.turn < 0 ? -0.02 : 0.02) : c.turn;
  parts.frame.setAttribute(
    'transform',
    `scale(${sx.toFixed(3)} 1) translate(${-COW_BOX.w / 2} ${-COW_BOX.h / 2})`
  );

  // The legs. Stance is the long slow half — the foot is down and the body
  // travels over it — and swing is the short quick one that brings it
  // forward again for the next step. A plain sine gives the two halves the
  // same speed, and that is the thing that makes a walk look like a
  // pendulum rather than like walking.
  for (let i = 0; i < parts.legs.length; i += 1) {
    const leg = COW_LEGS[i];
    const p = (c.stride + leg.phase) % 1;
    const swing = p < COW_DUTY
      ? 1 - (2 * p) / COW_DUTY
      : -Math.cos((Math.PI * (p - COW_DUTY)) / (1 - COW_DUTY));
    parts.legs[i].setAttribute(
      'transform',
      `rotate(${(COW_SWING * c.gait * swing).toFixed(2)} ${leg.pivot[0]} ${leg.pivot[1]})`
    );
  }

  // The body rises twice a stride, where the legs are under it. Standing,
  // it breathes instead — a hundredth of itself, at a quarter of a hertz,
  // which nobody sees and everybody notices the absence of.
  const bob = -COW_BOB * c.gait * (0.5 - 0.5 * Math.cos(4 * Math.PI * c.stride));
  const breath = 1 + 0.008 * (1 - c.gait) * Math.sin(now * 0.0016 + c.seed * 6.28);
  // Scaled about the ground, so it is the back that lifts and not the feet.
  const ride =
    `translate(0 ${bob.toFixed(2)}) translate(0 ${COW_GROUND}) ` +
    `scale(1 ${breath.toFixed(4)}) translate(0 ${-COW_GROUND})`;
  for (let i = 0; i < parts.bob.length; i += 1) parts.bob[i].setAttribute('transform', ride);

  // Down to the grass, with a slow nuzzle once it is there.
  const nuzzle = c.head > 0.85 ? Math.sin(now * 0.004 + c.seed * 6.28) * 1.4 : 0;
  parts.head.setAttribute(
    'transform',
    `rotate(${(c.head * (nuzzle - COW_STOOP)).toFixed(2)} ${COW_HEAD_PIVOT[0]} ${COW_HEAD_PIVOT[1]})`
  );
  parts.ear.setAttribute(
    'transform',
    `rotate(${(COW_EAR_BACK * c.ear).toFixed(2)} ${COW_EAR_PIVOT[0]} ${COW_EAR_PIVOT[1]})`
  );

  // The tail keeps its own time, deliberately: everything on the animal
  // moving to one beat is exactly what makes a drawn animal look drawn.
  const flick = now < c.tailTill ? Math.sin((c.tailTill - now) * 0.03) * 11 : 0;
  const tail = Math.sin(now * 0.0022 + c.seed * 6.28) * 7 + flick;
  parts.tail.setAttribute(
    'transform',
    `rotate(${tail.toFixed(2)} ${COW_TAIL_PIVOT[0]} ${COW_TAIL_PIVOT[1]})`
  );

  // And a little weight on the paper. Without it the animal is a sticker
  // laid on the page; with it, it is standing on something. It stays on
  // the ground while the body rises, and shortens as the cow turns away,
  // because the ground does not turn but the animal over it does.
  const near = 1 + bob * 0.6;
  parts.shadow.setAttribute(
    'transform',
    `translate(${c.turn < 0 ? -SHADOW_AT : SHADOW_AT} ${COW_GROUND - COW_BOX.h / 2}) ` +
    `scale(${Math.max(0.25, Math.abs(c.turn)).toFixed(3)} ${near.toFixed(3)})`
  );
  parts.shadow.setAttribute('opacity', (0.1 * near).toFixed(3));
}

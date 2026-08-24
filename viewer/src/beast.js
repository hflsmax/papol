// One rig, any animal.
//
// The first pass was a cow with the machinery threaded through it. This
// is the machinery with the cow taken out: a species hands over a skeleton, a
// line round itself, some legs and a few loose pieces, and gets back the
// four things anything drawing an animal needs — what it is made of, in
// what order, a frame of it, and a still of it.
//
// The rules a species is written under:
//
//  - The line round the animal is one closed outline, authored as points
//    with the one bone each plainly belongs to. Never two shapes where
//    one will do; the whole reason this rig exists is that the head and
//    the barrel are the same piece of skin.
//  - Four segments between croup and poll, because two cannot curve.
//  - Everything hangs off `share` below rather than off code: how much of
//    a stoop each joint takes, what drags on what, how loose each spring
//    is. A species that reads stiff is a species whose numbers are wrong,
//    not one that needs its own function.
//  - Nothing sets a stroke width. The parent decides — see `penFor` in
//    animals.js.

import {
  skeleton, pose, bind, rigid, spline, curve, limb, spring, settle,
} from './rig';

export const PALE = '#faf7ef';
export const DARK = '#33383f';

// The far side of the animal, in whatever colour that side happens to be.
//
// Which pair of legs is the near pair is the only thing in these drawings
// that says which side of an animal you are looking at, and it says it by
// the far one standing in a shade off the near one. That was a second
// constant written by hand beside the first, which is fine while there is
// one coat and a trap the moment there are three: a tan shoulder wants a
// far tan, a striped flank wants a far ground *and* a far stripe, and
// picking each of them by eye is how two of them end up not matching. It
// is the same warm shade laid over all of them at the same strength, so it
// is one rule and not a column of constants.
//
// A shade, and not a *mix*. The first way round of this blended every
// colour a fifth of the way towards one mid-warm brown, which lands on the
// right answer for a pale coat and does nothing whatever for a colour that
// already is that brown — which the seal points of a Birman are, near
// enough, so all four of its legs came out the same and it lost the one
// thing it had to say which side of it you were looking at. Taking a fixed
// proportion off each channel works wherever the colour starts. The three
// are not equal because the shade is warm: the blue goes first and the red
// goes least.
const SHADE = [0.920, 0.907, 0.879];
export const far = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((v, i) => Math.round(v * SHADE[i]));
  return `#${(((c[0] << 16) | (c[1] << 8)) | c[2]).toString(16).padStart(6, '0')}`;
};

// Which is exactly the pale the far pair already stood in, so nothing that
// was tuned against it has moved.
export const OFF = far(PALE);

// The coats that are not simply pale. A beagle is a tricolour and a Birman
// is a colourpoint, and neither of those is a thing that can be said in one
// colour and an outline: what makes either breed recognisable is almost
// entirely where the dark goes and what the ground under it is.
export const TAN = '#cd8b4a';
// A colourpoint is two tones and the gap between them: a warm eggshell
// body and the seal brown that gathers at the ends of the animal. CREAM is
// deliberately a shade off PALE rather than equal to it, because the whole
// point of a Birman is the four white gloves — and a white glove on a
// white foot is a glove nobody can see.
export const CREAM = '#ecdfc6';
export const POINT = '#7a6258';
// And the eyes, which are the other thing everyone knows about the breed.
// The one colour in this family that is not on the warm side of grey.
export const BLUE = '#4a7fb5';

// A ring of points, for the pieces that are round and ride one bone.
export function ring(cx, cy, rx, ry, rot = 0, n = 14) {
  const r = (rot * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.cos(a) * rx;
    const y = Math.sin(a) * ry;
    out.push([cx + x * c - y * s, cy + x * s + y * c]);
  }
  return out;
}

// What an animal stands on.
//
// Every one of these used to end in the same little dark block, which is
// the one place a walk gives you a free character note and was throwing
// it away: a cow comes down on two toes and a dog lands on a pad, and
// that is a free character note. The shapes are drawn in the lower leg's own
// frame — `a` along the bone towards the ground, `b` across it — so a
// foot stays on the end of its leg whatever the leg is doing.
// `roll` pitches the foot about its contact point: heel-first as it
// lands, toe-last as it leaves, flat in between. Without it every foot is
// stamped down flat, which is the one thing no animal does.
function footPath(kind, fx, fy, dir0, hw, roll) {
  const dir = dir0 + (roll || 0);
  const c = Math.cos(dir);
  const s = Math.sin(dir);
  const at = (a, b) => `${(fx + a * c - b * s).toFixed(1)} ${(fy + a * s + b * c).toFixed(1)}`;
  if (kind === 'paw') {
    // A pad, and it points where the animal is going. Drawn forward of
    // the cannon rather than under it, because a dog stands on its toes
    // and the leg meets the ground behind them.
    // Small. The first pass drew it at nearly twice the width of the
    // cannon above it, which is not a paw, it is a flipper — a foot reads
    // as a foot by being a little wider than the leg and no more.
    const pts = [];
    const n = 12;
    const rc = Math.cos(roll || 0);
    const rs = Math.sin(roll || 0);
    for (let i = 0; i < n; i += 1) {
      const t = (i / n) * Math.PI * 2;
      const px = -hw * 0.42 + Math.cos(t) * hw * 1.22;
      const py = -hw * 0.62 + Math.sin(t) * hw * 0.8;
      pts.push(fx + px * rc - py * rs, fy + px * rs + py * rc);
    }
    return spline(pts, n);
  }
  // Cloven, and split deep enough to see: the notch is the whole reason
  // this is not the block it used to be.
  return `M${at(-2.0, -hw * 0.85)}L${at(0.5, -hw * 1.15)}L${at(-0.7, 0)}`
    + `L${at(0.5, hw * 1.15)}L${at(-2.0, hw * 0.85)}Z`;
}

// How a foot travels while it is off the ground.
//
// Everything up to here differed between them by *numbers* — how long
// a foot stays down, how high it comes up, what order they land in. The
// path itself was one line of code for all of them: sweep back linearly,
// arc up on a symmetrical sine. That is why they all still moved alike.
// The shape of the swing is the gait; the numbers only trim it.
//
// Each returns how far through the forward sweep the foot is, and how
// much of its lift, for `u` from 0 at toe-off to 1 at contact.
const SWING = {
  // A plod. Even, low, and the foot rises late and lands flat — a cow
  // does not pick a foot up, it rolls it forward and puts it down.
  plod: (u) => [0.3 * u + 0.7 * (u * u * (3 - 2 * u)), Math.sin(Math.PI * u ** 1.15) ** 1.5],
  // A trot. The leg folds, snaps through the middle of the swing, and
  // reaches out to land: slow-fast-slow across, high and early up.
  trot: (u) => [u * u * u * (u * (6 * u - 15) + 10), Math.sin(Math.PI * u ** 0.78)],
  // A stalk. Most of the reach happens at once and then the foot is
  // *placed* — the last third of the swing is nearly still, which is what
  // makes a cat look deliberate and silent.
  stalk: (u) => [1 - (1 - u) ** 2.4, Math.sin(Math.PI * u) ** 0.55],
};

// An illustrative leg, rather than a drafting-compass leg.
//
// Exact two-circle IK preserves bone lengths but has an ugly visual
// singularity near full extension: the knee accelerates sideways, flips
// through a straight line and locks. That is physically tidy and looks
// robotic at this scale. These guides preserve the anatomical *gesture*
// instead—elbow back, stifle forward, hock returning under the body—while
// allowing the few percent of stretch a hand-drawn moving shape needs.
// The foot remains exact, so contact still has weight and never skates.
function articulate(leg, hx, hy, fx, fy, give, phase, duty, out) {
  const dx = fx - hx;
  const dy = fy - hy;
  const d = Math.hypot(dx, dy) || 1;
  const nx = -dy / d;
  const ny = dx / d;
  const total = leg.l1 + leg.l2 + (leg.l3 || 0);
  const fold = Math.min(5, Math.max(0, total - d));
  const bend = leg.bend || 1;
  const recovery = phase < duty
    ? 0
    : Math.sin((Math.PI * (phase - duty)) / (1 - duty));

  if (!leg.l3) {
    const at = leg.l1 / (leg.l1 + leg.l2);
    // A hoof under load makes a column. Most of the visible knee comes
    // only after toe-off, when the limb folds to clear the ground.
    const bow = bend * (0.22 + fold * 0.20 + recovery * 1.35 + give * 0.12);
    out[0] = hx; out[1] = hy;
    out[2] = hx + dx * at + nx * bow;
    out[3] = hy + dy * at + ny * bow + give * 0.28;
    out[4] = fx; out[5] = fy;
    return 3;
  }

  // Digitigrade legs are a shallow S. The middle two guides deliberately
  // oppose one another: that readable counter-curve is a dog's hock and a
  // cat's spring, and it survives much better than three exact rods.
  const upper = leg.l1 / total;
  const lower = (leg.l1 + leg.l2) / total;
  const kneeBow = bend * (0.38 + fold * 0.20 + recovery * 1.15 + give * 0.12);
  const hockBow = -bend * (0.20 + fold * 0.12 + recovery * 0.62) + give * 0.04;
  out[0] = hx; out[1] = hy;
  out[2] = hx + dx * upper + nx * kneeBow;
  out[3] = hy + dy * upper + ny * kneeBow + give * 0.24;
  out[4] = hx + dx * lower + nx * hockBow;
  out[5] = hy + dy * lower + ny * hockBow + give * 0.12;
  out[6] = fx; out[7] = fy;
  return 4;
}

// How loosely each bone is hung, going out from the shoulder. A hip is
// nearly rigid; a skull is on the end of a lot of muscle. See `spring`.
const LOOSE = {
  hip: [3.8, 0.95],
  loin: [3.4, 0.90],
  chest: [3.0, 0.80],
  neck1: [2.4, 0.60],
  neck2: [2.0, 0.50],
  skull: [1.7, 0.40],
  tail1: [2.4, 0.45],
  tail2: [1.9, 0.34],
  tail3: [1.5, 0.28],
};

// What each joint does with what the activity asked for. `head` is its
// share of a stoop, `wag` of the working, `beat` of the body's own weight
// twice a stride, `sway` of the walk's own long swing once a stride,
// `drag` is which bone it trails and by how much, and `idle` is the drift
// that keeps it from ever being perfectly still.
//
// `beat` and `sway` are the two halves of what a walk does to everything
// above the legs, and having only the first of them was why they all
// bobbed and none of them walked. Weight arrives twice a stride — that is
// `beat`, and it is symmetrical, because the left half of a stride is the
// same shape as the right. What is *not* symmetrical is the stride
// itself: an animal is a different shape at the top of it than at the
// bottom, and the long once-round swing that comes of that is what makes
// a cow nod its head as it walks and a tail keep time. Nothing symmetrical
// can produce it, which is why it has to be its own term.
const SHARE = {
  hip: { tilt: 0.15, idle: [0.35, 0.31, 0.19] },
  loin: { tilt: 0.30, beat: 0.25, idle: [0.40, 0.29, 0.23] },
  chest: { head: -0.10, tilt: 0.35, beat: 0.50, idle: [0.50, 0.27, 0.41] },
  neck1: { head: -0.32, wag: -0.20, beat: -0.60, sway: 0.55, drag: ['chest', 0.020], idle: [0.7, 0.23, 0.37] },
  neck2: { head: -0.34, wag: -0.25, beat: -0.50, sway: 0.70, drag: ['neck1', 0.035], idle: [0.9, 0.21, 0.33] },
  skull: { head: -0.66, wag: -1.00, beat: -0.80, sway: 1.00, drag: ['neck2', 0.045], idle: [1.2, 0.17, 0.29] },
  tail1: { swish: 0.45, sway: -0.40, drag: ['hip', 0.020] },
  tail2: { swish: 0.80, sway: -0.70, drag: ['tail1', 0.050] },
  tail3: { swish: 1.00, sway: -0.95, drag: ['tail2', 0.070] },
};

// How much of the breath each bone takes across itself, and how fast the
// breath goes. Both are the cow's; a species says only how it differs.
//
// These were fixed for all of them, which had a cow breathing at a cat's
// rate and to a cat's depth. Small animals breathe faster and shallower,
// and it is one of the few things an animal standing still does at all —
// so it is worth being the right one.
const AIR = { chest: 1, loin: 0.75, hip: 0.45, neck1: 0.35 };
const BREATH_RATE = 0.0016;

// Cute, as an arithmetic step rather than as a redraw.
//
// Each of these is authored at the proportions the animal actually has,
// and then the head is made bigger and the body shorter about the point
// where one becomes the other. That is the whole of the baby-schema —
// large head, small body, and the eye and muzzle that come with the head
// — and doing it here means it is one number a species rather than three
// dozen coordinates that have to be moved together and kept in step.
//
// The total width is put back afterwards, so an animal keeps the size it
// has on the page and changes only its proportions.
function stretch(spec) {
  const c = spec.cute;
  if (!c) return spec;
  const xs = spec.outline.map((p) => p[0]);
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const bend = (x) => (x < c.pivot
    ? c.pivot - (c.pivot - x) * c.head[0]
    : c.pivot + (x - c.pivot) * c.body);
  const k = (hi - lo) / (bend(hi) - bend(lo));
  const mid = (lo + hi) / 2;
  const fx = (x) => mid + (bend(x) - bend(mid)) * k;
  // And the half that matters more: the head gets *deeper*, not longer.
  //
  // The first pass grew it along the spine only, which made every one of
  // them snoutier — a longer head is a horse, and the thing being asked
  // for is a big one. So the swell is across the animal, about the line
  // the skull is carried on, and it fades out over the neck rather than
  // stopping dead at the shoulder, because a step in the middle of a neck
  // is a neck that has been sat on.
  const span = c.fade || 9;
  const fy = (x, y) => {
    const t = Math.max(0, Math.min(1, (c.pivot - x) / span));
    const g = 1 + (c.head[1] - 1) * t * t * (3 - 2 * t);
    return c.centre + (y - c.centre) * g;
  };
  // And one more: how far the whole animal sits down onto its own legs.
  // Feet are solved to the ground, so lowering the body is the only thing
  // that shortens a leg — and short legs are half of what makes any of
  // these read as young rather than as livestock.
  const drop = c.drop || 0;
  const at = (p) => [fx(p[0]), fy(p[0], p[1]) + drop, ...p.slice(2)];
  // A bone is remapped by both its ends, because a squeeze that is not
  // the same in both directions changes which way a bone points and how
  // long it is, and a skeleton that no longer matches the skin it carries
  // is worse than no exaggeration at all.
  const bones = spec.bones.map((b) => {
    const tx = b.head[0] + Math.cos((b.angle * Math.PI) / 180) * b.len;
    const ty = b.head[1] + Math.sin((b.angle * Math.PI) / 180) * b.len;
    const h = at(b.head);
    const t = at([tx, ty]);
    return {
      ...b,
      head: [h[0], h[1]],
      angle: (Math.atan2(t[1] - h[1], t[0] - h[0]) * 180) / Math.PI,
      len: Math.hypot(t[0] - h[0], t[1] - h[1]),
    };
  });
  return {
    ...spec,
    bones,
    outline: spec.outline.map(at),
    legs: spec.legs.map((l) => ({ ...l, hip: at(l.hip), foot: fx(l.foot) })),
    pieces: spec.pieces.map((p) => (p.points ? { ...p, points: p.points.map(at) } : p)),
  };
}

export function makeRig(raw) {
  const spec = stretch(raw);
  const BONES = skeleton(spec.bones);
  const SKIN = bind(spec.outline, BONES, spec.blend || 4.5);
  const legs = spec.legs.map((leg) => ({ ...leg, bone: BONES.of(leg.on) }));
  const loose = { ...LOOSE, ...(spec.loose || {}) };
  // Merged per bone rather than replaced, so a species can say "my skull
  // takes more of the stoop" without restating everything else about it.
  const share = {};
  for (const k of Object.keys(SHARE)) share[k] = { ...SHARE[k], ...((spec.share || {})[k] || {}) };
  const air = { ...AIR, ...(spec.air || {}) };
  const rate = spec.breathRate || BREATH_RATE;

  // The loose pieces, and the order everything is drawn in.
  const pieces = spec.pieces.map((p) => {
    if (p.kind === 'leg') return p;
    // A rope is a tail: a line down a chain of bones with a width at each
    // joint, so it tapers to its tip and bends where the bones bend.
    if (p.kind === 'rope') return { ...p, at: p.chain.map((n) => BONES.of(n)) };
    // A skin piece with no points of its own is the animal's own outline
    // — the one big one. Everything else that bends (a spot on the flank,
    // a patch of colour) brings its own.
    if (p.kind === 'skin') return { ...p, pts: p.points ? bind(p.points, BONES, p.blend || 4) : SKIN };
    return { ...p, pts: rigid(p.points, BONES, p.bone) };
  });

  const P = BONES.map(() => ({}));
  const DELTA = {};
  const ACROSS = {};
  const big = Math.max(SKIN.length, ...pieces.filter((p) => p.pts).map((p) => p.pts.length)) * 2 + 8;
  const buf = new Float64Array(big);
  const scratch = new Float64Array(big);

  const put = (pts, out) => {
    for (let i = 0; i < pts.length; i += 1) {
      const p = pts[i];
      const a = P[p.b0];
      let x = p.w0 * (a.a * p.x + a.b * p.y + a.tx);
      let y = p.w0 * (a.c * p.x + a.d * p.y + a.ty);
      if (p.w1) {
        const b = P[p.b1];
        x += p.w1 * (b.a * p.x + b.b * p.y + b.tx);
        y += p.w1 * (b.c * p.x + b.d * p.y + b.ty);
      }
      out[i * 2] = x;
      out[i * 2 + 1] = y;
    }
    return out;
  };
  const closed = (pts, out) => spline(put(pts, out), pts.length);
  const open = (pts) => curve(put(pts, scratch), pts.length);

  const memory = () => {
    const m = {};
    for (const k of Object.keys(loose)) m[k] = { x: 0, v: 0 };
    // Locomotion has memory of its own. A footfall is an event, not a
    // sample on a sine wave: it sends a small impulse through the limb and
    // trunk, then those masses recover on different springs.
    m.motion = {
      phases: null,
      bob: { x: 0, v: 0 },
      pitch: { x: 0, v: 0 },
      legs: legs.map(() => ({ x: 0, v: 0 })),
    };
    return m;
  };
  const HOUSE = memory();

  // Where a foot should be, given how far through the stride it is.
  // Stance is the long half and the foot does not move over the ground
  // while it lasts — the body travels over it, which is the whole reason
  // a walk stops looking like a shuffle.
  const phaseOf = (leg, travel, mode, index) => {
    // A chase is a bound, not the dog's diagonal trot played faster. The
    // two hind legs drive as a close pair, followed by the two forelegs
    // reaching as a second pair; tiny near/far offsets keep the silhouette
    // anatomical instead of making each pair one merged limb.
    const chasePhase = index % 2 === 1
      ? (index < 2 ? 0.02 : 0.08)
      : (index < 2 ? 0.52 : 0.58);
    const offset = mode === 'chase' ? chasePhase : leg.phase;
    const raw = ((travel + offset) % 1 + 1) % 1;
    // Real limbs do not pass through their cycle at clockwork speed. A
    // small monotonic warp lets each shoulder or hip linger and catch up
    // without changing where contact begins or allowing a planted foot to
    // slide. Species tune this per leg; zero retains the exact old gait.
    const duty = spec.duty || 0.65;
    // Contact is sacred: stance must advance linearly so its local motion
    // cancels the root's travel exactly. Character timing belongs only to
    // the foot while it is in the air, where lingering and catching up
    // cannot create skating. The sine is zero at toe-off and touchdown.
    if (raw < duty) return raw;
    const u = (raw - duty) / (1 - duty);
    const warped = u + (leg.timing || 0) * Math.sin(2 * Math.PI * u) / (2 * Math.PI);
    return duty + (1 - duty) * warped;
  };

  const step = (leg, i, travel, gait, seed, mode) => {
    if (mode === 'hunt') {
      // A four-point hunting crouch. Separate near from far as well as
      // fore from hind so the preparation does not collapse into two dark
      // posts under a low belly: forepaws reach, hind paws brace wide.
      const spread = [-2.2, 2.5, -3.8, 1.0][i] || 0;
      return [leg.foot + spread, leg.ground];
    }
    const p = phaseOf(leg, travel, mode, i);
    const duty = spec.duty || 0.65;
    // Every foot on the animal sweeps exactly the same distance, because
    // they are all attached to the same body and the body only goes one
    // speed. The fore used to reach a tenth further than the hind, which
    // is a thing a drawing may say and a walk may not: whichever of them
    // is wrong is a foot dragging along the floor, and both of them being
    // wrong in opposite directions is a cow tearing itself in half.
    // Stride length is geometry, not an animation strength. Scaling it up
    // with `gait` made the root start travelling before a stance foot had
    // enough counter-travel, which is exactly the startup skid. Once there
    // is locomotion, contact uses the full stride; gait may still fade lift,
    // impact and secondary body motion without weakening traction.
    const modeStride = mode === 'chase' ? 2.38 : 1;
    const s = (spec.stride || 9) * modeStride * (gait > 0.015 ? 1 : gait / 0.015);
    if (p < duty) return [leg.foot - s / 2 + (s * p) / duty, leg.ground];
    const u = (p - duty) / (1 - duty);
    // What the fore and the hind may still differ in is the *shape* of the
    // swing — how high the foot comes and by what path — which is `lift`
    // and `swing` below and costs nothing on the ground.
    const [ux, uy] = (SWING[leg.swing || spec.swing] || SWING.plod)(u);
    // No two recoveries are carbon copies. Variation is deterministic for
    // one leg-cycle (so animation remains reproducible), changes only at
    // contact where its contribution is zero, and never touches stance.
    const cycle = Math.floor(travel + leg.phase);
    const grain = Math.sin((cycle + 1) * (i + 2.37) * 12.9898 + seed * 4.17);
    const lift = 1 + grain * (spec.stepVariation || 0.07);
    const reach = (leg.lead || 0) + grain * (spec.reachVariation || 0.16);
    return [
      leg.foot + s / 2 - s * ux + reach * Math.sin(Math.PI * u) * gait,
      leg.ground - (spec.lift || 3.4) * (leg.lift || 1) * lift * gait * uy * (mode === 'chase' ? 1.62 : 1),
    ];
  };

  function frame(s) {
    const head = s.head || 0;
    const wag = s.wag || 0;
    const gait = s.gait || 0;
    const stride = s.stride || 0;
    const travel = (s.cycle || 0) + stride;
    const dt = Math.min(0.05, s.dt || 0);
    const mem = s.mem || HOUSE;
    const t = (s.now || 0) / 1000;
    const seed = (s.seed || 0) * 6.28;
    // The fallback also makes hot-reloaded animals born under the previous
    // rig version adopt the new locomotion state without disappearing.
    const motion = mem.motion || (mem.motion = {
      phases: null,
      bob: { x: 0, v: 0 },
      pitch: { x: 0, v: 0 },
      legs: legs.map(() => ({ x: 0, v: 0 })),
    });
    const phases = legs.map((leg, i) => phaseOf(leg, travel, s.mode, i));
    const duty = spec.duty || 0.65;
    if (dt > 0 && motion.phases) {
      for (let i = 0; i < phases.length; i += 1) {
        // Crossing from recovery into stance is impact. Near legs carry a
        // touch more visual weight; fore and hind tip the trunk in opposite
        // directions. Exact simultaneity is already broken by the gait.
        if (phases[i] < duty && motion.phases[i] >= duty && gait > 0.15) {
          const near = i > 1 ? 1 : 0.78;
          const impactScale = s.mode === 'chase' ? 0.38 : 1;
          motion.bob.v += (spec.impact || 1.5) * near * gait * impactScale;
          motion.pitch.v += (i % 2 === 0 ? 1 : -1) * (spec.impactPitch || 2.2) * near * gait * impactScale;
          motion.legs[i].v += (spec.legGive || 2.4) * gait * impactScale;
        }
      }
    }
    motion.phases = phases;
    const bob = dt > 0
      ? spring(motion.bob, 0, dt, spec.bodyHz || 2.7, spec.bodyDamping || 0.62)
      : settle(motion.bob, 0);
    const pitch = dt > 0
      ? spring(motion.pitch, 0, dt, spec.pitchHz || 2.2, spec.pitchDamping || 0.68)
      : settle(motion.pitch, 0);
    const beat = Math.max(-1, Math.min(1, -motion.bob.v * 0.12)) * gait;
    // The long one, once round the stride rather than twice. How much of
    // it each species takes is most of what tells their walks apart from
    // the neck up: a cow nods deeply enough to count the steps by, a
    // trotting dog hardly nods at all, and a cat holds its head so still
    // that the only thing moving is the tail behind it.
    const sway = Math.sin(2 * Math.PI * stride) * gait * (spec.nod == null ? 1 : spec.nod);
    // And the trunk rocks fore and aft as well as up and down, about the
    // croup, because the end with a foot under it is the end being held
    // up. A quarter of a cycle out of step with the bob — the withers are
    // lowest as the fore foot reaches and highest as it takes the weight
    // — which is what makes the two read as one movement instead of as a
    // body going up and down on a lift. A degree and a half is plenty:
    // this is the difference between a walk and a walk, not a see-saw.

    // Breathing, and it is the barrel getting wider rather than the whole
    // animal moving up and down. On top of it the barrel takes the weight
    // twice a stride: it squashes as a foot lands and lets go again.
    const swell = 1
      + (spec.breath || 0.022) * (1 - gait) * Math.sin((s.now || 0) * rate + seed)
      - 0.014 * gait * Math.max(0, Math.cos(4 * Math.PI * stride));
    for (const k of Object.keys(air)) if (mem[k]) ACROSS[k] = 1 + (swell - 1) * air[k];

    for (const name of Object.keys(loose)) {
      const q = share[name] || {};
      let to = 0;
      if (q.head) to += q.head * head;
      if (q.wag) to += q.wag * wag;
      if (q.tilt) to += q.tilt * (s.tilt || 0);
      if (q.beat) to += q.beat * beat;
      if (q.sway) to += q.sway * sway;
      if (q.swish) to += q.swish * (s.tail || 0);
      // Drag: pulled against what its parent is doing at this instant,
      // not against where the parent was told to be — so a fast stoop
      // whips the head and a slow one does not.
      if (q.drag && mem[q.drag[0]]) to -= mem[q.drag[0]].v * q.drag[1];
      if (q.idle) to += q.idle[0] * (Math.sin(t * q.idle[1] + seed) * 0.6
        + Math.sin(t * q.idle[2] + seed * 2) * 0.4);
      DELTA[name] = dt > 0
        ? spring(mem[name], to, dt, loose[name][0], loose[name][1])
        : settle(mem[name], to);
    }
    DELTA.ear = (s.ear || 0) * (spec.earBack || 34);

    pose(BONES, DELTA, { dx: 0, dy: bob + (s.sink || 0), rot: (s.tilt || 0) + pitch }, P, ACROSS);

    const out = {};
    const drawn = legs.map((leg, i) => {
      const b = P[leg.bone];
      const hx = b.a * leg.hip[0] + b.b * leg.hip[1] + b.tx;
      const hy = b.c * leg.hip[0] + b.d * leg.hip[1] + b.ty;
      const lift = s.paw && s.paw[0] === i ? s.paw : null;
      const [fx, fy] = lift
        ? [leg.foot + lift[1], leg.ground - lift[2]]
        : step(leg, i, travel, gait, seed, s.mode);
      // Heel down as it lands, toe down as it leaves, and hanging a
      // little while it swings.
      const ph = phases[i];
      const dutyOf = spec.duty || 0.65;
      const R = (((spec.roll || 12) * Math.PI) / 180) * gait;
      let roll;
      if (ph < dutyOf) {
        const u = ph / dutyOf;
        roll = u < 0.18 ? -R * (1 - u / 0.18)
          : u > 0.82 ? R * ((u - 0.82) / 0.18) : 0;
      } else {
        roll = R * 0.55;
      }
      // Authored paw work may rotate the pad independently of the leg.
      // Digging uses this to curl the toes back only after the scrape,
      // while ordinary walking continues to use the contact roll above.
      if (lift && lift[3]) roll += lift[3];
      // A digitigrade animal's ankle is well off the ground, so its leg
      // is three segments and not two: femur, tibia, and a metatarsus
      // standing on the toes. Solving all three to a foot is
      // under-determined, so the metatarsus is given a lean and the ankle
      // that implies becomes the target the other two solve to. That is
      // what makes the double fold a dog's hind leg has and an ungulate's
      // does not.
      //
      // The lean is measured up the leg — from the foot towards the hip —
      // and not from the vertical. Held vertical, which is what it was, the
      // pastern is a post: a foot reaching well forward of the shoulder
      // still has a plumb segment on the end of it, so every degree of that
      // reach has to be found in the knee above, and the leg comes out as a
      // hard Z with a right angle in the middle of it. A pastern leans with
      // the leg it is on. With the foot under the hip this is the same
      // arithmetic it always was; it only differs where it was wrong.
      const give = dt > 0
        ? spring(motion.legs[i], 0, dt, spec.legHz || 5.2, spec.legDamping || 0.48)
        : settle(motion.legs[i], 0);
      const n = articulate(leg, hx, hy, fx, fy, give, phases[i], duty, scratch);
      // The old exact solver inserted intermediate samples along every
      // bone, so widths were authored as five or seven values. The new
      // guides are the anatomical landmarks themselves; retain the hip,
      // joint and toe widths rather than accidentally giving a paw the
      // width of the hock above it.
      const widths = leg.l3
        ? [leg.w[0], leg.w[2], leg.w[4], leg.w[leg.w.length - 1]]
        : [leg.w[0], leg.w[2], leg.w[leg.w.length - 1]];
      const xy = limb(scratch.subarray(0, n * 2), widths);
      const lower = (n - 2) * 2;
      const footDir = Math.atan2(fy - scratch[lower + 1], fx - scratch[lower]);
      return {
        d: spline(xy, xy.length / 2, 0.6),
        hoof: footPath(spec.foot || 'cloven', fx, fy, footDir, widths[n - 1] * 0.85, roll),
      };
    });

    for (const p of pieces) {
      if (p.kind === 'leg') {
        out[p.key] = drawn[p.leg].d;
        if (p.hoof !== false) out[`${p.key}hoof`] = drawn[p.leg].hoof;
      } else if (p.kind === 'rope') {
        const n = p.at.length;
        for (let j = 0; j < n; j += 1) {
          scratch[j * 2] = P[p.at[j]].hx;
          scratch[j * 2 + 1] = P[p.at[j]].hy;
        }
        scratch[n * 2] = P[p.at[n - 1]].ex;
        scratch[n * 2 + 1] = P[p.at[n - 1]].ey;
        const xy = limb(scratch.subarray(0, (n + 1) * 2), p.w);
        out[p.key] = spline(xy, xy.length / 2, 0.6);
      } else if (p.kind === 'line') {
        out[p.key] = open(p.pts);
      } else {
        out[p.key] = closed(p.pts, p.pts === SKIN ? buf : scratch);
      }
    }
    return out;
  }

  // What the animal is made of, back to front, and in what colours.
  // Everything that draws one walks this list — the frame loop, the
  // cursor, the sheet in the menu — so there is one answer to "what order
  // does this animal go in" rather than three kept in step by hand.
  const layers = [];
  for (const p of pieces) {
    layers.push([p.key, p.fill, p.stroke || 'none']);
    if (p.kind === 'leg' && p.hoof !== false) {
      layers.push([`${p.key}hoof`, p.hoofFill || DARK, p.hoofStroke || 'none']);
    }
  }

  const rest = () => {
    const m = memory();
    const f = frame({ head: 0, gait: 0, stride: 0, dt: 0, now: 0, seed: 0, mem: m });
    return layers
      .filter(([key]) => f[key])
      .map(([key, fill, stroke]) => `<path d="${f[key]}" fill="${fill}" stroke="${stroke}"${
        stroke === 'none' ? '' : ' stroke-linejoin="round"'}/>`)
      .join('');
  };

  // How far one whole stride carries the animal, in its own box units.
  //
  // A planted foot travels `stride` backwards under the body, and it takes
  // `duty` of a cycle to do it — so the ground goes by at `stride / duty`
  // a cycle, and that is how fast the animal is walking whether or not
  // anything else agrees. Nothing did: each was moved across the
  // page at a speed and stepped at a rate, both written down by hand, and
  // between the two of them a cat covered four times as much ground as its
  // feet did. Feet that do not keep up with the floor are the single most
  // legible thing wrong with an animation, and no amount of drawing rescues
  // it. See `assemble` in animals.js, which now works the rate out of this
  // rather than being told it.
  const carry = (spec.stride || 9) / (spec.duty || 0.65);

  return {
    layers, memory, frame, rest, bones: BONES, posed: P, carry,
  };
}

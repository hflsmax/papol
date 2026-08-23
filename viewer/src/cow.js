// How a cow behaves and how it looks while it does it.
//
// Out here rather than in PdfPage because none of it is about a page: it is
// arithmetic on a record and a handful of attribute writes, and having it
// on its own means it can be driven by something other than a document
// while it is being got right.

import { animalFor } from './animals';

const spell = ([a, b]) => a + Math.random() * (b - a);

// The three parts of a swat, as fractions of the whole: whipping over,
// shivering at the top of the arc, unwinding. Fast out and slower back,
// because the going is the work and the coming back is the tail falling.
const SWAT_OVER = 0.26;
const SWAT_TOP = 0.5;

// How far through its arc the tail is, from 0 to 1.
function swat(p) {
  if (p < SWAT_OVER) {
    const t = p / SWAT_OVER;
    return 1 - (1 - t) ** 3;
  }
  // Held over the flank, shivering — a cow does not swat once and stop,
  // it worries at the spot.
  if (p < SWAT_TOP) return 1 + Math.sin((p - SWAT_OVER) * 150) * 0.035;
  const t = (p - SWAT_TOP) / (1 - SWAT_TOP);
  return 1 - t * t * (3 - 2 * t);
}

// One of the things this animal does, chosen by weight from the half of
// its list that is asked for — the walks or the rest — and preferably not
// the one it did last time it was asked: an animal that grazes, then
// grazes, then grazes is not choosing, it is stuck.
function pick(acts, walking, last) {
  const half = acts.filter((a) => !!a.walks === walking);
  const group = half.length ? half : acts;
  const open = group.length > 1 ? group.filter((a) => a !== last) : group;
  let total = 0;
  for (const a of open) total += a.weight;
  let n = Math.random() * total;
  for (const a of open) {
    n -= a.weight;
    if (n <= 0) return a;
  }
  return open[open.length - 1];
}

// Where the animal has got to, and what it is up to. Mutates the record in
// place; see App's dropCow for why there is no state here.
export function stepCow(c, dt, now) {
  const w = animalFor(c.kind).ways;
  // What it is doing. There used to be two answers to that — walking, or
  // stopped — and stopped always meant the head went down, which made
  // every animal on the page a cow with a different outline. A cat does
  // not graze. A dog does not graze. So each species carries its own list
  // of things it does, and this picks between them.
  //
  // Strictly turn and turn about: it goes somewhere, it does something
  // where it has got to, it goes somewhere else. Picking freely from the
  // whole list let an animal stand in one spot doing three things in a
  // row, which reads as a loop being played rather than as an animal
  // getting on with its day — and let it walk twice running, which is one
  // walk with a stumble in the middle of it. All the randomness that was
  // lost goes back in through the spells, which are drawn fresh every
  // time and are wide: a dog scratches for one second or for three.
  if (!c.held && now >= c.until) {
    const walking = c.act ? !c.act.walks : false;
    c.act = pick(w.acts, walking, walking ? c.wasWalk : c.wasStill);
    if (walking) c.wasWalk = c.act;
    else c.wasStill = c.act;
    c.until = now + spell(c.act.span);
    if (c.act.walks) {
      const dir = Math.random() < 0.5 ? -1 : 1;
      c.facing = dir;
      c.tvx = dir * w.speed * c.pace;
      // Barely any drift up or down: a page is not a field.
      c.tvy = (Math.random() - 0.5) * w.speed * w.drift;
    }
  }
  const act = c.act || w.acts[0];

  const grip = 1 - Math.exp(-dt / w.ease);
  const still = !act.walks || c.held;
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
  const swingBy = (2 * dt) / w.turn;
  c.turn += Math.max(-swingBy, Math.min(swingBy, look - c.turn));

  // Where in a stride it is, and how much of a stride to show. Both come
  // off the speed, so a cow slowing to a stop puts its feet down slower
  // and then stops putting them down.
  //
  // Against the species' own speed and not against this animal's — the
  // `pace` it was born with is part of how fast it is actually going, and
  // dividing it back out again meant the quick ones in a herd took the
  // same number of steps as the slow ones to cover more ground. Which is
  // a sixth of a stride of skid on every foot, on a seventh of the herd.
  const rate = Math.abs(c.vx) / w.speed;
  c.stride = (c.stride + (rate * w.beat * dt) / 1000) % 1;
  c.gait += (Math.min(1, rate) - c.gait) * grip;

  // Everything the activity asks the body to do, eased into rather than
  // switched to. `head` is degrees now rather than a fraction of one fixed
  // stoop, so an animal can raise its head as easily as lower it — and an
  // activity that is not settling into anything, a dog shaking itself or
  // hearing a noise, may say how long it gets to arrive in.
  const soft = 1 - Math.exp(-dt / (act.nod || w.nod));
  const to = c.held ? 0 : 1;
  c.head += ((to ? act.head : 0) - c.head) * soft;
  c.tilt += ((to ? act.tilt : 0) - c.tilt) * soft;
  c.sink += ((to ? act.sink : 0) - c.sink) * soft;
  c.earTo += ((to ? act.ear : 0) - c.earTo) * soft;
  c.swish += ((act.tail[0] - c.swish)) * soft;

  // The one foot an activity may pick up. Which leg it is only changes
  // once the last one is back down — a dog that stops scratching halfway
  // through and starts washing a different leg would swap one raised foot
  // for another between frames, and put neither of them down.
  if (act.paw && (c.pawLeg == null || Math.abs(c.paw) < 0.5)) c.pawLeg = act.paw[0];
  c.paw += ((to && act.paw ? act.paw[1] : 0) - c.paw) * soft;
  c.pawWag += ((to && act.paw ? act.paw[2] : 0) - c.pawWag) * soft;
  c.pawPhase += (act.paw ? act.paw[3] : 0) * dt;

  // Phases are accumulated rather than read off the clock, so an activity
  // may change how fast the tail swings or the head works without the
  // shape jumping to a different part of its own sine.
  c.tailPhase += act.tail[1] * dt;
  c.wagPhase += act.wag[1] * dt;

  if (!c.earAt) c.earAt = now + spell(w.earEvery);
  else if (now >= c.earAt) {
    c.earAt = now + spell(w.earEvery);
    c.earTill = now + w.earHeld;
  }
  // The flick, over whatever the activity is already holding the ear at.
  c.ear += ((now < c.earTill ? 1 : c.earTo) - c.ear) * (1 - Math.exp(-dt / 45));

  // A cow that has only just been put down should not be bothered by a fly
  // in its first frame, nor have its ear go back in it. Both spells are
  // started here rather than counted from a zero it was born with.
  if (!c.tailAt) c.tailAt = now + spell(w.swatEvery);
  else if (now >= c.tailAt) {
    c.tailAt = now + spell(w.swatEvery);
    c.tailTill = now + w.swatHeld;
  }
}

// How the animal looks, right now, written straight onto the groups. No
// state, no React: this runs every frame and reconciling it would cost
// more than the arithmetic above and below put together.
// Where the animal is standing and how big it is — the two things every
// species needs written on it whatever it is made of.
function place(c, spec, parts, now, k, cx, cy) {
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
    `scale(${sx.toFixed(3)} 1) translate(${-spec.box.w / 2} ${-spec.box.h / 2})`
  );
}

// The tail's own arc, which both rigs want and neither owns.
function tailAngle(c, w, now) {
  const over = now < c.tailTill
    ? w.swatArc * swat(1 - (c.tailTill - now) / w.swatHeld)
    : 0;
  return Math.sin(c.tailPhase + c.seed * 6.28) * c.swish + over;
}

// A rigged animal: no transforms to write beyond the two above, because
// every joint in it has already been resolved into one outline. What goes
// onto the page is a handful of `d` strings.
//
// The behaviour engine above is untouched by this. `stepCow` still speaks
// in degrees of head, a place in the stride and a tail angle, and the rig
// takes exactly those — which is the whole reason a species can be moved
// onto it one at a time.
function poseRigged(c, parts, now, k, cx, cy) {
  const spec = animalFor(c.kind);
  const w = spec.ways;
  const act = c.act || w.acts[0];
  place(c, spec, parts, now, k, cx, cy);
  // Springs need to know how long it has been, and an animal that has
  // just been put down has been nowhere. A first frame of zero settles
  // the chain instead of launching it.
  const dt = c.posedAt ? Math.min(0.05, (now - c.posedAt) / 1000) : 0;
  c.posedAt = now;
  if (!c.mem) c.mem = spec.rig.memory();
  const f = spec.rig.frame({
    mem: c.mem,
    dt,
    now,
    seed: c.seed,
    head: c.head,
    wag: Math.sin(c.wagPhase + c.seed * 6.28) * act.wag[0],
    tail: tailAngle(c, w, now),
    ear: c.ear,
    tilt: c.tilt,
    sink: c.sink,
    gait: c.gait,
    stride: c.stride,
  });
  for (let i = 0; i < parts.rig.length; i += 1) {
    const node = parts.rig[i];
    const d = f[node.dataset.rig];
    if (d) node.setAttribute('d', d);
  }
  const near = 1 + (-w.bob * c.gait * (0.5 - 0.5 * Math.cos(4 * Math.PI * c.stride))) * 0.6;
  parts.shadow.setAttribute(
    'transform',
    `translate(${c.turn < 0 ? -spec.shadow.at : spec.shadow.at} ${spec.ground - spec.box.h / 2}) ` +
    `scale(${Math.max(0.25, Math.abs(c.turn)).toFixed(3)} ${near.toFixed(3)})`
  );
  parts.shadow.setAttribute('opacity', (0.1 * near).toFixed(3));
}

export function poseCow(c, parts, now, k, cx, cy) {
  const spec = animalFor(c.kind);
  if (spec.rig) { poseRigged(c, parts, now, k, cx, cy); return; }
  const w = spec.ways;
  place(c, spec, parts, now, k, cx, cy);

  // The legs. Stance is the long slow half — the foot is down and the body
  // travels over it — and swing is the short quick one that brings it
  // forward again for the next step. A plain sine gives the two halves the
  // same speed, and that is the thing that makes a walk look like a
  // pendulum rather than like walking.
  const turned = [];
  for (let i = 0; i < parts.legs.length; i += 1) {
    const leg = spec.legs[i];
    const p = (c.stride + leg.phase) % 1;
    const swing = p < w.duty
      ? 1 - (2 * p) / w.duty
      : -Math.cos((Math.PI * (p - w.duty)) / (1 - w.duty));
    // And on top of the walk, the one leg the activity has taken off the
    // ground: a cat's front paw up to be washed, a dog's hind foot up at
    // its own ear. Added to the gait rather than replacing it, so an
    // animal that starts walking with a foot up puts it down into the
    // stride rather than snapping it there.
    const up = c.pawLeg === i
      ? c.paw + Math.sin(c.pawPhase + c.seed * 6.28) * c.pawWag
      : 0;
    turned[i] = `rotate(${(w.swing * c.gait * swing + up).toFixed(2)} ${leg.pivot[0]} ${leg.pivot[1]})`;
    parts.legs[i].setAttribute('transform', turned[i]);
  }

  // A leg that has come up far enough to be under the barrel is drawn in
  // front of it instead, from the second copy of itself that the skeleton
  // keeps for exactly this. One of the two is always hidden, so what
  // happens at `pawOver` is that a leg changes which side of the body it
  // is on, halfway up, at the fastest part of its swing. The thump itself
  // is not in `c.paw` — only the height the activity is holding the foot
  // at is — so a leg cannot flicker back and forth across the line twice
  // a beat.
  for (let j = 0; j < spec.overLegs.length; j += 1) {
    const i = spec.overLegs[j];
    const front = c.pawLeg === i && c.paw > w.pawOver;
    parts.over[j].setAttribute('display', front ? 'inline' : 'none');
    parts.legs[i].setAttribute('display', front ? 'none' : 'inline');
    if (front) parts.over[j].setAttribute('transform', turned[i]);
  }

  // The body rises twice a stride, where the legs are under it. Standing,
  // it breathes instead — a hundredth of itself, at a quarter of a hertz,
  // which nobody sees and everybody notices the absence of.
  const bob = -w.bob * c.gait * (0.5 - 0.5 * Math.cos(4 * Math.PI * c.stride));
  const breath = 1 + 0.008 * (1 - c.gait) * Math.sin(now * 0.0016 + c.seed * 6.28);
  // Scaled about the ground, so it is the back that lifts and not the feet.
  // Sitting and crouching, on top of that. Both only ever bring the body
  // nearer its own feet — the legs are outside this group and stay planted
  // — and since the body is drawn over the tops of the legs, a body that
  // comes down covers more of them and never less. That is the whole
  // reason the rear may drop and may not rise.
  const sit = c.tilt
    ? `rotate(${c.tilt.toFixed(2)} ${spec.legs[0].pivot[0]} ${spec.ground}) `
    : '';
  const ride =
    `translate(0 ${(bob + c.sink).toFixed(2)}) ${sit}translate(0 ${spec.ground}) ` +
    `scale(1 ${breath.toFixed(4)}) translate(0 ${-spec.ground})`;
  for (let i = 0; i < parts.bob.length; i += 1) parts.bob[i].setAttribute('transform', ride);

  // Where the head is held, and what it is doing there. The working — a
  // cow nuzzling, a dog snuffling, a cat washing — is the
  // same oscillation at four very different sizes and speeds, which is
  // most of what tells the four activities apart.
  const act = c.act || w.acts[0];
  const work = Math.sin(c.wagPhase + c.seed * 6.28) * act.wag[0];
  parts.head.setAttribute(
    'transform',
    `rotate(${(-(c.head + work)).toFixed(2)} ${spec.headPivot[0]} ${spec.headPivot[1]})`
  );
  parts.ear.setAttribute(
    'transform',
    `rotate(${(w.earBack * c.ear).toFixed(2)} ${spec.ear.pivot[0]} ${spec.ear.pivot[1]})`
  );

  // The tail keeps its own time, deliberately: everything on the animal
  // moving to one beat is exactly what makes a drawn animal look drawn.
  const tail = tailAngle(c, w, now);
  parts.tail.setAttribute(
    'transform',
    `rotate(${tail.toFixed(2)} ${spec.tail.pivot[0]} ${spec.tail.pivot[1]})`
  );

  // And a little weight on the paper. Without it the animal is a sticker
  // laid on the page; with it, it is standing on something. It stays on
  // the ground while the body rises, and shortens as the cow turns away,
  // because the ground does not turn but the animal over it does.
  const near = 1 + bob * 0.6;
  parts.shadow.setAttribute(
    'transform',
    `translate(${c.turn < 0 ? -spec.shadow.at : spec.shadow.at} ${spec.ground - spec.box.h / 2}) ` +
    `scale(${Math.max(0.25, Math.abs(c.turn)).toFixed(3)} ${near.toFixed(3)})`
  );
  parts.shadow.setAttribute('opacity', (0.1 * near).toFixed(3));
}

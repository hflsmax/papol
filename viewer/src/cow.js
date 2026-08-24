// How a cow behaves and how it looks while it does it.
//
// Out here rather than in PdfPage because none of it is about a page: it is
// arithmetic on a record and a handful of attribute writes, and having it
// on its own means it can be driven by something other than a document
// while it is being got right.

import { animalFor } from './animals';

const spell = ([a, b]) => a + Math.random() * (b - a);
const clamp01 = (n) => Math.max(0, Math.min(1, n));
const smooth = (n) => {
  const t = clamp01(n);
  return t * t * (3 - 2 * t);
};
const nextSpecial = (scale, now) => {
  const strength = Math.max(0.2, scale ** 1.5);
  return now + spell([
    Math.max(3200, 18000 / strength),
    Math.max(5200, 36000 / strength),
  ]);
};

// One authored exchange between paw and ball. Both renderers read this
// same record, so contact cannot drift: reach peaks at the two instants the
// ball begins to travel. It rolls away after the first bat, returns, takes
// a gentler second tap, and loses the last of its momentum on the way back.
function ballPlay(p) {
  const hit = (at, width) => smooth(1 - Math.abs(p - at) / width);
  const first = hit(0.28, 0.13);
  const second = hit(0.72, 0.12) * 0.78;
  let dx;
  let bounce = 0;
  if (p < 0.28) {
    dx = 0.35;
  } else if (p < 0.48) {
    const u = smooth((p - 0.28) / 0.20);
    dx = 0.35 - 5.25 * u;
    bounce = Math.sin(Math.PI * u) * 1.7;
  } else if (p < 0.66) {
    const u = smooth((p - 0.48) / 0.18);
    dx = -4.9 + 5.1 * u;
    bounce = Math.sin(Math.PI * u) * 0.75;
  } else if (p < 0.72) {
    dx = 0.2;
  } else if (p < 0.88) {
    const u = smooth((p - 0.72) / 0.16);
    dx = 0.2 - 3.45 * u;
    bounce = Math.sin(Math.PI * u) * 1.05;
  } else {
    const u = smooth((p - 0.88) / 0.12);
    dx = -3.25 + 2.75 * u;
    bounce = Math.sin(Math.PI * u) * 0.35;
  }
  return { dx, bounce, reach: Math.max(first, second) };
}

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
function pick(acts, walking, last, activityScale, forceSpecial = false) {
  const half = acts.filter((a) => !!a.walks === walking);
  const group = half.length ? half : acts;
  const alternatives = group.length > 1 ? group.filter((a) => a !== last) : group;
  const specials = alternatives.filter((a) => a.special);
  const open = forceSpecial && specials.length ? specials : alternatives;
  let total = 0;
  // The control is perceptual rather than a raw multiplier. Rare remains
  // rare around the default, while the top end is deliberately strong
  // enough for someone tuning animation to see several examples promptly.
  const specialFrequency = activityScale <= 0 ? 0 : activityScale * activityScale;
  const weighted = (a) => a.weight * (a.special ? specialFrequency : 1);
  for (const a of open) total += weighted(a);
  // At zero the special entries have no mass. There is always an ordinary
  // activity in each half, but keep the fallback defensive for custom sets.
  if (total <= 0) return open.find((a) => !a.special) || open[0];
  let n = Math.random() * total;
  for (const a of open) {
    n -= weighted(a);
    if (n <= 0) return a;
  }
  return open[open.length - 1];
}

// Where the animal has got to, and what it is up to. Mutates the record in
// place; see App's dropAnimal for why there is no React state here.
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
    const wasWalking = !!c.act?.walks;
    const activityScale = c.activityScale ?? 1;
    // Specials have a real schedule as well as a weight. Random weighting
    // alone made it possible to move the control to maximum and see none.
    // Default spacing is tens of seconds; the top end guarantees one after
    // only a few, while zero disables the schedule completely.
    const specialDue = activityScale > 0 && c.specialAt != null && now >= c.specialAt;
    const walking = specialDue ? false : (c.act ? !c.act.walks : false);
    // The cat's first showcase is always the hunt. Previously the forced
    // slot chose randomly between ball and hunt, so a perfectly healthy
    // scheduler could show the much louder ball twice before hunting was
    // ever discovered. Subsequent slots rotate through the species'
    // specials, retaining rarity without hiding half the repertoire.
    const specials = w.acts.filter((a) => a.special);
    const follow = c.followTarget;
    const followDistance = follow ? Math.hypot(follow.x - c.x, follow.y - c.y) : 0;
    const followArrival = c.followPrecision ?? 0.035;
    if (followDistance > followArrival) {
      c.act = w.acts.find((a) => a.walks && !a.special) || w.acts.find((a) => a.walks);
    } else if (c.viewportFollowing) {
      // The DOM-side viewport tracker will release this on its next sample.
      // Until then hold one neutral pose; selecting a special for this tiny
      // interval made gait and activity alternate visibly at 20 Hz.
      c.act = {
        id: 'follow-settle', weight: 1, span: [800, 1100], walks: false,
        special: false, head: 0, wag: [0, 0], ear: 0, tilt: 0,
        sink: 0, paw: null, nod: 0, prop: null,
        tail: [w.swish, w.swishRate],
      };
    } else if (specialDue && specials.length) {
      const featured = c.kind === 'cat' ? 'hunt' : (c.kind === 'dog' ? 'chase' : null);
      const first = featured ? specials.findIndex((a) => a.id === featured) : 0;
      const index = ((Math.max(0, first) + (c.specialCount || 0)) % specials.length);
      c.act = specials[index];
      c.specialCount = (c.specialCount || 0) + 1;
    } else {
      c.act = pick(
        w.acts,
        walking,
        walking ? c.wasWalk : c.wasStill,
        activityScale,
        false
      );
    }
    if (c.act.walks) c.wasWalk = c.act;
    else c.wasStill = c.act;
    c.actStarted = now;
    c.until = now + spell(c.act.span);
    if (c.act.walks && !wasWalking) c.walkWarmup = 0;
    if (c.act.special) {
      c.specialAt = nextSpecial(activityScale, now);
    } else if (activityScale > 0 && c.specialAt == null) {
      c.specialAt = nextSpecial(activityScale, now);
    }
    if (c.act.walks) {
      // Open space influences a new route, but does not dictate it. Even in
      // a crowd there remains a one-in-four chance of choosing freely, so
      // this reads as temperament rather than invisible repulsion.
      const openX = c.crowdX || 0;
      const preferOpen = Math.abs(openX) > 0.08 && Math.random() < 0.75;
      const dir = preferOpen ? (openX < 0 ? -1 : 1) : (Math.random() < 0.5 ? -1 : 1);
      c.facing = dir;
      c.tvx = dir * w.speed * c.pace * (c.speedScale ?? 1) * (c.act.speed ?? 1);
      // Barely any drift up or down: a page is not a field.
      const randomDrift = (Math.random() - 0.5) * w.speed * w.drift;
      const openY = Math.max(-1, Math.min(1, c.crowdY || 0));
      c.driftTarget = randomDrift * 0.72 + openY * w.speed * w.drift * 0.28;
    }
  }
  const act = c.act || w.acts[0];

  // The hunt's pounce travels for real. Keeping all of its distance in a
  // drawing transform made the cat spring back to its starting point at
  // the end of the activity; advancing its page position lets it land and
  // remain where the leap actually took it.
  if (act.id === 'hunt' && !c.held) {
    const span = Math.max(1, c.until - (c.actStarted || now));
    const p = clamp01((now - (c.actStarted || now)) / span);
    const flight = Math.sin(Math.PI * clamp01((p - 0.63) / 0.29));
    if (p >= 0.63 && p <= 0.92) {
      c.x += c.facing * w.speed * 4.5 * flight * dt;
      c.x = Math.max(0.05, Math.min(0.95, c.x));
    }
  }

  // A walking spell has a phrase: gather, travel, release. Previously its
  // target velocity switched from zero to one constant and back, with one
  // exponential doing both jobs. Correct feet under that motion still
  // looked motorised. The asymmetric envelope below begins braking before
  // the activity ends, and each species says how abruptly it commits and
  // how patiently it comes back to rest.
  if (act.walks && !c.held) {
    if (!c.actStarted) c.actStarted = now;
    const span = Math.max(1, c.until - c.actStarted);
    const progress = clamp01((now - c.actStarted) / span);
    const launch = smooth(progress / w.rampIn);
    const brake = smooth((1 - progress) / w.rampOut);
    const envelope = Math.min(launch, brake);
    // Tiny surges as weight passes over alternating supports. It is not a
    // sine-wave bob painted onto the body: it changes real travel, and the
    // stride clock follows that travel, so planted feet still do not slide.
    const pulse = 1 + w.pacePulse * Math.sin(4 * Math.PI * c.stride + c.seed * 6.28);
    // Turning changes the horizontal scale of the whole drawing. Travelling
    // through that turn would move every planted foot even if the gait were
    // perfect, so an animal gathers itself, turns, then sets off.
    const turnReady = smooth((Math.abs(c.turn) - 0.88) / 0.12);
    let pace = w.speed * c.pace * (c.speedScale ?? 1) * (act.speed ?? 1) * envelope * pulse * turnReady;
    if (act.id === 'chase') {
      // A chase belongs inside the page. Begin a long brake while there is
      // still a full dog between nose and paper edge; ordinary walks retain
      // their boundary handoff for Follow page.
      const room = c.facing < 0 ? c.x - 0.13 : 0.87 - c.x;
      pace *= smooth(clamp01(room / 0.13));
      if (room <= 0.012) {
        pace = 0;
        c.until = now;
      }
    }
    const moveTarget = c.followTarget;
    if (moveTarget) {
      let dx = moveTarget.x - c.x;
      const dy = moveTarget.y - c.y;
      // Side-view legs cannot explain straight vertical travel. Preserve a
      // clear forward component on every route, choosing the current facing
      // unless that would carry the animal farther beyond a page side.
      const minimumForward = Math.abs(dy) * 1.6;
      if (Math.abs(dx) < minimumForward) {
        let direction = c.facing || (c.seed < 0.5 ? -1 : 1);
        if (c.x < 0.02) direction = 1;
        if (c.x > 0.98) direction = -1;
        dx = direction * minimumForward;
      }
      const distance = Math.hypot(dx, dy);
      const arrival = c.followPrecision ?? 0.035;
      if (distance > arrival) {
        if (Math.abs(dx) > 0.015) c.facing = dx < 0 ? -1 : 1;
        const followPace = pace * 0.92;
        c.tvx = (dx / distance) * followPace;
        c.tvy = (dy / distance) * followPace;
      } else {
        c.tvx = 0;
        c.tvy = 0;
        c.until = 0;
      }
    } else {
      c.tvx = c.facing * pace;
      c.tvy = (c.driftTarget || 0) * envelope;
    }
  }

  const still = !act.walks || c.held;
  if (still) {
    // No invisible coasting. Once the feet stop articulating, the animal
    // is planted; carrying deceleration into an idle pose made the whole
    // silhouette drift over the paper with locked legs.
    c.vx = 0;
    c.vy = 0;
    c.tvx = 0;
    c.tvy = 0;
  }
  const desiredX = still ? 0 : c.tvx;
  const desiredY = still ? 0 : c.tvy;
  const intentRate = Math.hypot(desiredX, desiredY) / w.speed;
  const gaitGrip = 1 - Math.exp(-dt / (intentRate > c.gait ? w.accel : w.decel));
  c.gait += (Math.min(1, intentRate) - c.gait) * gaitGrip;
  // Intent articulates the legs before the root is allowed to travel. By
  // the time readiness opens, a walking pose is already visible; there is
  // no frame interval in which the silhouette slides on locked feet.
  if (!still && intentRate > 0.01) {
    c.walkWarmup = Math.min(1, (c.walkWarmup || 0) + dt / 280);
  } else {
    c.walkWarmup = 0;
  }
  const footReady = smooth((c.gait - 0.055) / 0.17);
  const committed = smooth(((c.walkWarmup || 0) - 0.48) / 0.38);
  const targetX = desiredX * footReady * committed;
  const targetY = desiredY * footReady * committed;
  const gaining = Math.abs(targetX) > Math.abs(c.vx);
  const momentum = gaining ? w.accel : w.decel;
  const grip = 1 - Math.exp(-dt / momentum);
  c.vx += (targetX - c.vx) * grip;
  c.vy += (targetY - c.vy) * grip;

  // Aim the side-on body along diagonal travel. `vy` is positive upward
  // in page coordinates but SVG rotation is positive downward, and the
  // left-facing drawing needs the inverse slope of the mirrored one.
  // Follow actual velocity rather than intent so the torso turns with its
  // momentum and never announces movement before the feet begin it.
  const moving = Math.hypot(c.vx, c.vy) > w.speed * 0.025;
  const diagonal = moving
    ? Math.atan2(-c.vy, Math.max(Math.abs(c.vx), w.speed * 0.08)) * 180 / Math.PI
    : 0;
  const headingTarget = Math.max(-22, Math.min(22, diagonal * (c.facing < 0 ? -1 : 1)));
  const headingEase = 1 - Math.exp(-dt / (moving ? 260 : 340));
  c.travelAngle = (c.travelAngle || 0) + (headingTarget - (c.travelAngle || 0)) * headingEase;

  if (!c.held) {
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    if (act.id === 'chase') {
      if (c.x < 0.12 || c.x > 0.88) {
        c.vx = 0;
        c.tvx = 0;
        c.until = now;
      }
    }
    // The edges of the page are the edges of the field.
    if (c.x < -0.08) { c.x = -0.08; c.tvx = -c.tvx; c.vx = -c.vx; c.facing = -c.facing; }
    if (c.x > 1.08) { c.x = 1.08; c.tvx = -c.tvx; c.vx = -c.vx; c.facing = -c.facing; }
    if (c.y < -0.15) { c.y = -0.15; c.tvy = -c.tvy; c.vy = -c.vy; }
    if (c.y > 1.15) { c.y = 1.15; c.tvy = -c.tvy; c.vy = -c.vy; }
  }

  // Which way round it is. The drawing faces left, so a cow walking right
  // is the same drawing seen from its other side — and it used to get
  // there by having its scaleX negated, which turned the animal inside out
  // between one frame and the next. It travels now, at a steady rate,
  // through zero: the cow narrows to a line and opens out the other way,
  // which is a cow swinging round to face where it is going.
  const look = c.facing === 1 ? -1 : 1;
  if (c.turnFacing !== c.facing) {
    c.turnFacing = c.facing;
    c.turnStarted = now;
    c.turnFrom = c.turn;
  }
  const turnProgress = clamp01((now - (c.turnStarted || now)) / w.turn);
  // Quintic ease: zero angular velocity and acceleration at both ends. A
  // turn now reads as weight gathered, carried through, and set down—not a
  // motor rotating at one speed until it abruptly stops.
  const easedTurn = turnProgress ** 3 * (turnProgress * (turnProgress * 6 - 15) + 10);
  c.turn = (c.turnFrom ?? c.turn) + (look - (c.turnFrom ?? c.turn)) * easedTurn;

  // Where in a stride it is, and how much of a stride to show. Both come
  // off the speed, so a cow slowing to a stop puts its feet down slower
  // and then stops putting them down.
  //
  // Against the species' own speed and not against this animal's — the
  // `pace` it was born with is part of how fast it is actually going, and
  // dividing it back out again meant the quick ones in a herd took the
  // same number of steps as the slow ones to cover more ground. Which is
  // a sixth of a stride of skid on every foot, on a seventh of the herd.
  // A chase covers more ground per bound than the ordinary trot. Slowing
  // the cycle while lengthening its geometric stride preserves planted
  // contact and makes each gather/flight phrase visibly longer.
  const travelRate = Math.hypot(c.vx, c.vy) / w.speed;
  // During the brief commitment, articulate a small anticipatory step in
  // place. Translation remains locked above until that motion is readable.
  const prepRate = (c.walkWarmup || 0) < 1
    ? intentRate * 0.32 * (1 - (c.walkWarmup || 0))
    : 0;
  const rate = (travelRate + prepRate) * (act.id === 'chase' ? 0.42 : 1);
  const nextStride = c.stride + (rate * w.beat * dt) / 1000;
  c.strideCycle = (c.strideCycle || 0) + Math.floor(nextStride);
  c.stride = nextStride % 1;

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
  const turnArc = 1 - Math.min(1, Math.abs(c.turn));
  const side = c.turn < 0 ? -1 : 1;
  // A turn has weight: gather upward over the planted feet, tip slightly
  // into the pivot, then settle on the new side. Measured in animal units
  // before the root scale so the gesture stays proportional at every zoom.
  const weightedArc = Math.sin(turnArc * Math.PI * 0.5);
  const rise = weightedArc * 1.9;
  const tip = side * weightedArc * 4.6;
  // Suppress the travel heading while broadside volume is crossing through
  // a turn; it returns as the new side opens, avoiding two rotations that
  // fight each other at the midpoint.
  const travelAngle = (c.travelAngle || 0) * Math.abs(c.turn);
  parts.root.setAttribute(
    'transform',
    `translate(${cx.toFixed(2)} ${cy.toFixed(2)}) scale(${(k * settle).toFixed(4)}) ` +
    `translate(0 ${(-rise).toFixed(3)}) rotate(${(tip + travelAngle).toFixed(2)})`
  );
  // Never collapse into a sheet. At the middle the silhouette retains a
  // third of its width and leans into a three-quarter-view shear; the side
  // swaps under that compressed silhouette rather than through a zero-width
  // matrix. It is an illustrative pivot, not fake 3-D perspective.
  const sx = side * (0.70 + 0.30 * Math.abs(c.turn));
  const depth = 1 + weightedArc * 0.16;
  const shear = -side * weightedArc * 11.5;
  const frameTransform =
    `translate(${(side * weightedArc * 2.05).toFixed(2)} 0) ` +
    `scale(${sx.toFixed(3)} ${depth.toFixed(3)}) skewY(${shear.toFixed(2)}) ` +
    `translate(${-spec.box.w / 2} ${-spec.box.h / 2})`;
  parts.frameBase = frameTransform;
  parts.frame.setAttribute('transform', frameTransform);
}

// The tail's own arc, which both rigs want and neither owns.
function tailAngle(c, w, now) {
  const over = now < c.tailTill
    ? w.swatArc * swat(1 - (c.tailTill - now) / w.swatHeld)
    : 0;
  const phase = c.tailPhase + c.seed * 6.28;
  const harmonic = (w.tailHarmonic ?? 0.16) * Math.sin(phase * 2.07 + c.seed * 2.3);
  const drift = (w.tailDrift ?? 0.10) * Math.sin(phase * 0.39 + c.seed * 8.1);
  return (Math.sin(phase) + harmonic + drift) * c.swish + over;
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
  const activitySpan = Math.max(1, c.until - (c.actStarted || now));
  const activityProgress = clamp01((now - (c.actStarted || now)) / activitySpan);
  let posedHead = c.head;
  let posedSink = c.sink;
  let posedPaw = null;
  let posedEar = c.ear;
  let activityShiftX = 0;
  let activityLift = 0;
  // The head leads a turn and stays visible over the compressed barrel;
  // without this anticipation even a thick silhouette still reads as a
  // card being flipped by an unseen hand.
  const turning = 1 - Math.min(1, Math.abs(c.turn));
  posedHead -= turning * 7;

  // The record used to carry a paw angle for the old capsule animal, but
  // the bone rig expects a foot target. Translate ordinary raised-paw
  // activities into a compact reach, then let prop-driven activities
  // author their own more deliberate choreography below.
  if (act.paw && c.pawLeg != null) {
    const held = clamp01(Math.abs(c.paw) / Math.max(1, Math.abs(act.paw[1])));
    const work = Math.sin(c.pawPhase + c.seed * 6.28);
    posedPaw = [c.pawLeg, -2.2 * held, (4.8 + work * 0.8) * held];
  }

  if (act.id === 'play-ball') {
    // Two beats, but not two loops: the second is smaller. The cat first
    // studies the ball, sinks, reaches, bats it away, follows it with its
    // head, then catches the return with a softer paw before relaxing.
    const ready = smooth(activityProgress / 0.18);
    const relax = smooth((1 - activityProgress) / 0.16);
    const engagement = Math.min(ready, relax);
    const ball = ballPlay(activityProgress);
    posedPaw = [0, -5.35 * ball.reach * engagement, 4.0 * ball.reach * engagement];
    posedHead += Math.sin(activityProgress * Math.PI * 2) * 4.5 * engagement;
    posedSink += (0.8 + 0.7 * ball.reach) * engagement;
  }

  if (act.id === 'startle') {
    // Recoil sharply, hold the high-headed silhouette long enough to read,
    // then settle the weight back through the legs.
    const recoil = Math.sin(Math.PI * smooth(activityProgress));
    posedHead -= recoil * 7;
    posedSink -= recoil * 1.15;
  }

  if (act.id === 'scratch' && c.kind === 'cow') {
    // Bring the near hind hoof all the way to the lower flank. The generic
    // raised-paw translation only cleared the ground and looked like a
    // hesitant step; this has a deliberate lift, several compressed rubs
    // while the hoof remains in contact, and a patient lowering phase.
    const lift = smooth(clamp01(activityProgress / 0.18));
    const lower = smooth(clamp01((1 - activityProgress) / 0.20));
    const contact = Math.min(lift, lower);
    const strokeTime = clamp01((activityProgress - 0.17) / 0.64);
    const rub = Math.sin(strokeTime * Math.PI * 9);
    const press = 0.5 + 0.5 * Math.sin(strokeTime * Math.PI * 4.5 + 0.8);
    posedPaw = [3, (-4.0 - press * 1.15) * contact, (14.8 + rub * 2.1) * contact];
    posedHead -= contact * 8;
    posedSink += contact * 0.65;
  }

  if (act.id === 'play-bow') {
    // Deep chest, high animated rear and a pair of little invitations
    // forward. The tail already carries the fast species-specific wag.
    const hold = Math.min(smooth(activityProgress / 0.18), smooth((1 - activityProgress) / 0.2));
    const bounce = 0.45 * Math.sin(activityProgress * Math.PI * 6) * hold;
    posedSink += (1.8 + bounce) * hold;
    posedHead += 8 * hold;
    const offer = 0.5 + 0.5 * Math.sin(activityProgress * Math.PI * 4);
    posedPaw = [offer > 0.5 ? 0 : 2, -3.2 * hold, 2.6 * hold];
  }

  if (act.id === 'dig') {
    // Alternate the two forepaws in the direction a dog actually digs:
    // recover forward through the air, plant at the far edge, scrape back
    // along the ground, then curl and lift at the rear. The old orbit did
    // those vertical halves backwards, making the paw push soil forward.
    const strokes = activityProgress * 10;
    const which = Math.floor(strokes) % 2;
    const stroke = strokes % 1;
    const reach = smooth(clamp01(stroke / 0.25));
    const plant = smooth(clamp01((stroke - 0.25) / 0.13));
    const scrape = smooth(clamp01((stroke - 0.38) / 0.39));
    const release = smooth(clamp01((stroke - 0.77) / 0.13));
    const settle = smooth(clamp01((stroke - 0.90) / 0.10));
    const forwardX = -6.4 * reach;
    const scrapedX = forwardX + 13.1 * scrape;
    const pawX = scrapedX * (1 - settle);
    // High during the forward recovery, almost touching throughout the
    // backward pull, then a compact rear lift that throws the dirt clear.
    const recoveryLift = 5.4 * reach * (1 - plant);
    const scrapePress = 0.35 * plant * (1 - release);
    const rearLift = 3.8 * release * (1 - settle);
    const pawY = recoveryLift + scrapePress + rearLift;
    const curl = 0.95 * release * (1 - settle);
    posedPaw = [which ? 2 : 0, pawX, pawY, curl];
    posedHead += (reach * 5.5 - release * 2.2) * (1 - settle);
    posedSink += 1.0 + scrapePress * 0.7;
  }

  if (act.id === 'chase') {
    // The normal gait solver owns all four feet here. Faster real travel
    // drives a faster stride clock, while this slower spinal bound lays a
    // gather-and-extension phrase over the independent leg sequence.
    const phase = ((c.stride % 1) + 1) % 1;
    const flight = Math.sin(Math.PI * smooth(clamp01((phase - 0.16) / 0.58)));
    const hindLand = Math.max(0, 1 - Math.abs(phase - 0.08) / 0.10) ** 2;
    const foreLand = Math.max(0, 1 - Math.abs(phase - 0.68) / 0.11) ** 2;
    const landing = Math.max(hindLand, foreLand);
    // One broad suspension per full bound, with quiet weight at each pair
    // of feet. The head counterbalances only slightly and keeps looking
    // forward; the old twice-per-cycle bob read as laughter.
    posedSink += landing * 0.85 - flight * 3.35;
    posedHead += landing * 1.8 - flight * 2.4;
    posedPaw = null;
  }

  if (act.id === 'hunt') {
    // A readable miniature hunt: sink and stare, creep the paw forward,
    // hold absolutely still, then release into one compact pounce.
    const focus = Math.min(smooth(activityProgress / 0.12), smooth((1 - activityProgress) / 0.08));
    const creep = smooth(clamp01((activityProgress - 0.10) / 0.42));
    const freeze = smooth(clamp01((activityProgress - 0.48) / 0.08)) * smooth(clamp01((0.68 - activityProgress) / 0.08));
    const launch = Math.sin(Math.PI * clamp01((activityProgress - 0.63) / 0.25));
    const capture = smooth(clamp01((activityProgress - 0.87) / 0.06)) * smooth(clamp01((0.98 - activityProgress) / 0.06));
    const earFocus = smooth(clamp01(activityProgress / 0.10))
      * smooth(clamp01((0.64 - activityProgress) / 0.08));
    // Alert, rhythmic near-ear flicks through the crouch, with a smaller
    // answering beat that creates a double twitch. Both stop before the
    // body releases, making the sudden stillness part of the pounce.
    const mainFlick = Math.sin(activityProgress * Math.PI * 13);
    const snap = Math.sign(mainFlick) * Math.abs(mainFlick) ** 3;
    const doubleFlick = 0.62 * Math.sin(activityProgress * Math.PI * 26 + 0.9);
    posedEar += (snap + doubleFlick) * 0.34 * earFocus;
    // Unlike a reaching paw, this displaces the whole cat. It stays truly
    // still through the focus, shoots one body length towards the prey,
    // clears the ground, lands over it, then backs out only after the
    // capture has had time to read.
    // Horizontal travel is committed directly to c.x above. A second,
    // temporary frame translation used to unwind after landing and made
    // the cat slide backwards despite having completed the leap.
    activityShiftX = 0;
    activityLift = -11.5 * Math.sin(Math.PI * clamp01((activityProgress - 0.63) / 0.29));
    posedSink += (0.45 + creep * 0.75 + freeze * 0.35 - launch * 4.2 + capture * 1.2) * focus;
    posedHead += (creep * 7 - launch * 18 + capture * 11) * focus;
    posedPaw = [0, (-3.0 * creep - 8.5 * launch - 5.5 * capture) * focus,
      (2.8 * creep + 8.2 * launch + 5.0 * capture) * focus];
  }
  if (activityShiftX || activityLift) {
    const base = parts.frameBase || '';
    parts.frame.setAttribute('transform',
      `${base} translate(${activityShiftX.toFixed(2)} ${activityLift.toFixed(2)})`
    );
  }
  const f = spec.rig.frame({
    mem: c.mem,
    dt,
    now,
    seed: c.seed,
    head: posedHead,
    wag: Math.sin(c.wagPhase + c.seed * 6.28) * act.wag[0],
    tail: tailAngle(c, w, now),
    ear: posedEar,
    tilt: c.tilt,
    sink: posedSink,
    paw: posedPaw,
    gait: c.gait,
    stride: c.stride,
    cycle: c.strideCycle || 0,
    mode: act.id === 'chase' ? 'chase' : (act.id === 'hunt' ? 'hunt' : null),
  });
  for (let i = 0; i < parts.rig.length; i += 1) {
    const node = parts.rig[i];
    const d = f[node.dataset.rig];
    if (d) node.setAttribute('d', d);
  }
  if (parts.scratchLeg && parts.scratchHoof) {
    const scratching = c.kind === 'cow' && act.id === 'scratch' && !c.held;
    parts.scratchLeg.setAttribute('display', scratching ? 'inline' : 'none');
    parts.scratchHoof.setAttribute('display', scratching ? 'inline' : 'none');
    if (scratching) {
      parts.scratchLeg.setAttribute('d', f.near1 || '');
      parts.scratchHoof.setAttribute('d', f.near1hoof || '');
    }
  }
  if (parts.prop) {
    const playing = act.prop === 'ball' && !c.held;
    parts.prop.setAttribute('display', playing ? 'inline' : 'none');
    if (playing && parts.ball) {
      // The first bat travels further than the catch. A low decaying hop
      // at each reversal makes contact legible; rotation follows distance
      // rather than the clock, so the painted seams do not skate.
      const ball = ballPlay(activityProgress);
      parts.ball.setAttribute(
        'transform',
        `translate(${ball.dx.toFixed(2)} ${(-ball.bounce).toFixed(2)}) ` +
        `rotate(${(ball.dx * 48).toFixed(1)} 27 33.5)`
      );
    }
  }
  if (parts.chase) {
    const chasing = act.prop === 'chase' && !c.held;
    parts.chase.setAttribute('display', chasing ? 'inline' : 'none');
    if (chasing) {
      const beat = activityProgress * 3;
      const local = beat % 1;
      const evade = smooth(clamp01((local - 0.18) / 0.50));
      const zig = Math.floor(beat) % 2 ? -1 : 1;
      // Stay clearly beyond the muzzle (the drawing faces left in its own
      // frame). The old path began over the dog's brow and only became a
      // chase target after it moved; this one maintains visible air between
      // nose and wings for the whole pursuit.
      const x = 6.8 - evade * 2.2 + zig * Math.sin(local * Math.PI) * 1.1;
      const y = 28 - Math.sin(local * Math.PI * 2) * 3.2 - Math.sin(activityProgress * Math.PI * 6) * 1.2;
      parts.chase.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${(zig * 18 - Math.sin(local * Math.PI * 2) * 24).toFixed(1)})`);
    }
  }
  if (parts.dirt) {
    const digging = act.id === 'dig' && !c.held;
    parts.dirt.setAttribute('display', digging ? 'inline' : 'none');
    if (digging) {
      const strokes = activityProgress * 10;
      const burst = Math.sin(Math.PI * (strokes % 1));
      const kick = Math.floor(strokes) % 2 ? -1 : 1;
      const spread = 0.82 + burst * 0.72;
      parts.dirt.setAttribute('transform',
        `translate(${(burst * 7.5).toFixed(2)} ${(-burst * 5.8).toFixed(2)}) ` +
        `rotate(${(kick * burst * 24).toFixed(1)} 35 35) scale(${spread.toFixed(2)})`
      );
      parts.dirt.setAttribute('opacity', (0.18 + burst * 0.82).toFixed(2));
    }
  }
  if (parts.sound) {
    const mooing = c.kind === 'cow' && act.id === 'startle' && !c.held;
    parts.sound.setAttribute('display', mooing ? 'inline' : 'none');
    if (mooing) {
      const appear = smooth(clamp01(activityProgress / 0.12));
      const vanish = smooth(clamp01((1 - activityProgress) / 0.16));
      const pop = Math.min(appear, vanish);
      const headSide = c.turn < 0 ? 25 : -25;
      const bounce = -23 - Math.sin(activityProgress * Math.PI) * 1.2;
      const scale = 0.72 + pop * 0.28;
      parts.sound.setAttribute('transform',
        `translate(${headSide} ${bounce.toFixed(2)}) scale(${scale.toFixed(3)})`
      );
      parts.sound.setAttribute('opacity', pop.toFixed(3));
    }
  }
  const near = 1 + (-w.bob * c.gait * (0.5 - 0.5 * Math.cos(4 * Math.PI * c.stride))) * 0.6;
  parts.shadow.setAttribute(
    'transform',
    `translate(${c.turn < 0 ? -spec.shadow.at : spec.shadow.at} ${spec.ground - spec.box.h / 2}) ` +
    `scale(${(0.64 + 0.36 * Math.abs(c.turn)).toFixed(3)} ${(near * (1 + turning * 0.08)).toFixed(3)})`
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
    `scale(${(0.64 + 0.36 * Math.abs(c.turn)).toFixed(3)} ${(near * (1 + (1 - Math.min(1, Math.abs(c.turn))) * 0.08)).toFixed(3)})`
  );
  parts.shadow.setAttribute('opacity', (0.1 * near).toFixed(3));
}

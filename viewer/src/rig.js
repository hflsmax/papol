// A 2D skeleton, a skin bound to it, and the two solvers that pose it.
//
// Nothing in here knows what a cow is. It is the arithmetic that lets a
// drawing be one continuous outline that bends, rather than a pile of
// rigid parts that rotate — which is the whole of the difference between
// this and the capsule rig it replaces. See beast.js for the rig it
// carries, and beasts.js for the animals.
//
// A bone carries a rotation, a translation, and one scale: how much
// fatter or thinner the skin is across it. The rotation is what bends the
// animal; the scale is the only way anything here changes shape rather
// than just moving, and it exists for one reason — a barrel that cannot
// swell is a barrel, and an animal built out of shapes that only ever
// turn reads as carved however well it is jointed.

const D2R = Math.PI / 180;
const f = (n) => (Math.round(n * 10) / 10);

// ---------------------------------------------------------------------
// Bones.
//
// A bone is written down as where it starts, which way it points and how
// long it is, all in the animal's own box and all at rest. `parent` is a
// name, and a bone must be listed after its parent — checked, because a
// chain walked out of order is a limb that lags one frame behind the body
// and nothing else looks quite like that bug.

export function skeleton(defs) {
  const index = new Map();
  const bones = defs.map((d, i) => {
    if (index.has(d.name)) throw new Error(`two bones called ${d.name}`);
    index.set(d.name, i);
    const parent = d.parent == null ? -1 : index.get(d.parent);
    if (d.parent != null && parent === undefined) {
      throw new Error(`${d.name} is listed before its parent ${d.parent}`);
    }
    return {
      name: d.name,
      parent: parent === undefined ? -1 : parent,
      head: d.head,
      angle: d.angle,
      len: d.len || 0,
      // Where the far end of the bone sits at rest, which is what a child
      // usually wants to be hung off and what the leg solver measures.
      tail: [
        d.head[0] + Math.cos(d.angle * D2R) * (d.len || 0),
        d.head[1] + Math.sin(d.angle * D2R) * (d.len || 0),
      ],
    };
  });
  bones.index = index;
  bones.of = (name) => {
    const i = index.get(name);
    if (i === undefined) throw new Error(`no bone called ${name}`);
    return i;
  };
  return bones;
}

// Walk the chain and work out where every bone has ended up. `delta` is
// degrees per bone name, turned about that bone's own head, and it is the
// only thing an animation ever writes.
//
// The result carries the affine that takes a rest point on this bone to
// where it is now — `c s tx ty` — because skinning applies it to sixty
// points a bone and working it out once is the whole optimisation this
// needs.
export function pose(bones, delta, root, out, across) {
  const P = out || bones.map(() => ({}));
  for (let i = 0; i < bones.length; i += 1) {
    const b = bones[i];
    const d = delta[b.name] || 0;
    let ang;
    let hx;
    let hy;
    if (b.parent < 0) {
      ang = b.angle + (root.rot || 0) + d;
      hx = b.head[0] + (root.dx || 0);
      hy = b.head[1] + (root.dy || 0);
    } else {
      const p = bones[b.parent];
      const W = P[b.parent];
      // How far the parent has turned from its own rest — the child
      // inherits exactly this and adds its own.
      const rel = W.ang - p.angle;
      const c = Math.cos(rel * D2R);
      const s = Math.sin(rel * D2R);
      const ox = b.head[0] - p.head[0];
      const oy = b.head[1] - p.head[1];
      hx = W.hx + ox * c - oy * s;
      hy = W.hy + ox * s + oy * c;
      ang = b.angle + rel + d;
    }
    // The affine that takes a rest point on this bone to where it is now.
    // Worked out once a bone rather than once a point, because sixty
    // points hang off some of these.
    //
    //   M = R(world) . diag(1, across) . R(-rest)
    //
    // — turn the point into the bone's own frame, make it that much wider
    // across the bone, and turn it back out into the world. With `across`
    // at one it is exactly the rotation it used to be.
    const sy = (across && across[b.name]) || 1;
    const cw = Math.cos(ang * D2R);
    const sw = Math.sin(ang * D2R);
    const ca = Math.cos(b.angle * D2R);
    const sa = Math.sin(b.angle * D2R);
    const q = P[i];
    q.ang = ang;
    q.hx = hx;
    q.hy = hy;
    q.a = cw * ca + sw * sy * sa;
    q.b = cw * sa - sw * sy * ca;
    q.c = sw * ca - cw * sy * sa;
    q.d = sw * sa + cw * sy * ca;
    q.tx = hx - (q.a * b.head[0] + q.b * b.head[1]);
    q.ty = hy - (q.c * b.head[0] + q.d * b.head[1]);
    q.ex = hx + Math.cos(ang * D2R) * b.len;
    q.ey = hy + Math.sin(ang * D2R) * b.len;
  }
  return P;
}

// ---------------------------------------------------------------------
// Skin.
//
// A point of the drawing, carried by one or two bones. Two is enough: a
// point is never in the middle of three joints on an animal, and the
// second one is only there so a seam can stop being a seam.

export function skin(pt, P, into, at) {
  const a = P[pt.b0];
  let x = pt.w0 * (a.a * pt.x + a.b * pt.y + a.tx);
  let y = pt.w0 * (a.c * pt.x + a.d * pt.y + a.ty);
  if (pt.w1) {
    const b = P[pt.b1];
    x += pt.w1 * (b.a * pt.x + b.b * pt.y + b.tx);
    y += pt.w1 * (b.c * pt.x + b.d * pt.y + b.ty);
  }
  into[at] = x;
  into[at + 1] = y;
}

// Bind an outline to bones.
//
// Each point is authored with the one bone it plainly belongs to — the
// muzzle is skull, the flank is hip — and then the assignment is blurred
// along the outline, so that the four or five points either side of a
// join end up carried by both. That blur is the entire reason the neck
// bends instead of hinging, and doing it along the outline rather than
// through space is what keeps the throat from being weighted to the
// shoulder it happens to be near.
//
// `blend` is in the animal's own units, measured along the outline, and
// is the width of the soft band at every join at once.
export function bind(pts, bones, blend = 5) {
  const n = pts.length;
  const at = pts.map((p) => bones.of(p[2]));
  // Distance along the closed outline, so the blur is even whatever the
  // spacing of the points happens to be.
  const step = [];
  for (let i = 0; i < n; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    step[i] = Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const w = new Map();
    // Out from the point in both directions until the kernel runs out.
    const gather = (dir) => {
      let d = 0;
      let j = i;
      while (d < blend) {
        const k = 0.5 + 0.5 * Math.cos((d / blend) * Math.PI);
        w.set(at[j], (w.get(at[j]) || 0) + k);
        d += dir > 0 ? step[j] : step[(j - 1 + n) % n];
        j = (j + dir + n) % n;
        if (j === i) break;
      }
    };
    w.set(at[i], 0);
    gather(1);
    gather(-1);
    const top = [...w.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
    const sum = top.reduce((s, e) => s + e[1], 0) || 1;
    out.push({
      x: pts[i][0],
      y: pts[i][1],
      b0: top[0][0],
      w0: top[0][1] / sum,
      b1: top[1] ? top[1][0] : top[0][0],
      w1: top[1] ? top[1][1] / sum : 0,
    });
  }
  return out;
}

// A handful of loose shapes — an eye, a horn, a hoof — that ride one bone
// whole. Same skinning, no blend, because a horn does not bend.
export const rigid = (pts, bones, name) => {
  const b = bones.of(name);
  return pts.map(([x, y]) => ({ x, y, b0: b, w0: 1, b1: b, w1: 0 }));
};

// ---------------------------------------------------------------------
// Springs.
//
// The thing that stops a chain of bones being a chain of levers.
//
// Easing a bone to where the activity says it should be — which is what
// the old engine does, and what this did in its first pass — moves every
// joint onto its mark on the same curve at the same moment. That is not a
// neck coming down; it is a neck being *placed*, and no amount of outline
// fixes it, because what is wrong is the timing rather than the drawing.
//
// So every bone in the spine and the tail chases its mark on a spring
// instead, and the springs get slacker the further they are from the
// shoulder. The head therefore arrives after the neck, which arrives
// after the withers, and each of them goes a little past and comes back.
// That is all "overlapping action" is, and it is most of the difference
// between an animal and a puppet.
//
// `hz` is how quickly a bone answers and `zeta` is how much it overshoots
// on the way — one is critically damped and nothing under it settles
// without going past.
export function spring(s, to, dt, hz, zeta) {
  const w = 2 * Math.PI * hz;
  const k = w * w;
  const c = 2 * zeta * w;
  // Substepped, because a spring this stiff integrated over a dropped
  // frame is a spring that leaves the screen.
  const steps = Math.max(1, Math.ceil(dt / 0.008));
  const h = dt / steps;
  for (let i = 0; i < steps; i += 1) {
    s.v += (k * (to - s.x) - c * s.v) * h;
    s.x += s.v * h;
  }
  return s.x;
}

// A pose with no time in it — the menu, the cursor, a still frame. Puts
// the spring where it would have ended up rather than starting it moving.
export function settle(s, to) {
  s.x = to;
  s.v = 0;
  return to;
}

// ---------------------------------------------------------------------
// Legs.
//
// Two bones and a foot that has been told where to be. The knee comes out
// of the arithmetic rather than being animated, which is the point: a leg
// that reaches for the ground bends the way the ground makes it bend, and
// a body that sits down folds its own hocks without anybody writing that
// down.
//
// `bend` is which side the joint bulges towards: a horse's knee goes
// forward and its hock goes back, and getting that one sign wrong is the
// difference between a cow and a flamingo.
export function reach(hx, hy, tx, ty, l1, l2, bend) {
  let dx = tx - hx;
  let dy = ty - hy;
  let d = Math.hypot(dx, dy);
  // A leg may not be asked to be longer than it is, nor to fold through
  // itself. Just short of straight, so the two bones never become one
  // line and lose which way they were bent.
  const most = (l1 + l2) * 0.998;
  const least = Math.abs(l1 - l2) + 0.02;
  if (d > most) d = most;
  if (d < least) d = least;
  const base = Math.atan2(dy, dx);
  const a = Math.acos(Math.max(-1, Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))));
  const b = Math.acos(Math.max(-1, Math.min(1, (l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2))));
  const up = (base + bend * a) / D2R;
  const low = up + (bend * (b - Math.PI)) / D2R;
  return [up, low];
}

// ---------------------------------------------------------------------
// Getting it onto the page.

// A closed outline through the points, rather than between them: the
// drawing is authored as a list of places the edge goes past, and the
// curve is worked out. Which means detail costs a point, not a pair of
// hand-computed control handles — and it is why an animal in this rig can
// have a brisket and a hock at all.
export function spline(xy, n, tension = 1) {
  const at = (i) => ((i % n) + n) % n;
  let d = `M${f(xy[0])} ${f(xy[1])}`;
  for (let i = 0; i < n; i += 1) {
    const p0 = at(i - 1) * 2;
    const p1 = at(i) * 2;
    const p2 = at(i + 1) * 2;
    const p3 = at(i + 2) * 2;
    const c1x = xy[p1] + ((xy[p2] - xy[p0]) / 6) * tension;
    const c1y = xy[p1 + 1] + ((xy[p2 + 1] - xy[p0 + 1]) / 6) * tension;
    const c2x = xy[p2] - ((xy[p3] - xy[p1]) / 6) * tension;
    const c2y = xy[p2 + 1] - ((xy[p3 + 1] - xy[p1 + 1]) / 6) * tension;
    d += `C${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(xy[p2])} ${f(xy[p2 + 1])}`;
  }
  return `${d}Z`;
}

// The same curve, left open: a crease rather than an edge. The shoulder
// and the thigh of an animal drawn this flat are one line each and not a
// closed shape, and drawing them as closed shapes is what makes a rig
// look like it has bubbles stuck to it.
export function curve(xy, n) {
  const at = (i) => Math.max(0, Math.min(n - 1, i));
  let d = `M${f(xy[0])} ${f(xy[1])}`;
  for (let i = 0; i < n - 1; i += 1) {
    const p0 = at(i - 1) * 2;
    const p1 = i * 2;
    const p2 = (i + 1) * 2;
    const p3 = at(i + 2) * 2;
    const c1x = xy[p1] + (xy[p2] - xy[p0]) / 6;
    const c1y = xy[p1 + 1] + (xy[p2 + 1] - xy[p0 + 1]) / 6;
    const c2x = xy[p2] - (xy[p3] - xy[p1]) / 6;
    const c2y = xy[p2 + 1] - (xy[p3 + 1] - xy[p1 + 1]) / 6;
    d += `C${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(xy[p2])} ${f(xy[p2 + 1])}`;
  }
  return d;
}

// A limb, drawn round the bones it is made of: a line with a width at
// every point along it, turned into an outline. A leg is not a capsule
// because a leg is not one width — it is a thigh, a joint and a cannon,
// and saying so takes three numbers.
export function limb(joints, widths) {
  const n = joints.length / 2;
  const left = [];
  const right = [];
  for (let i = 0; i < n; i += 1) {
    const x = joints[i * 2];
    const y = joints[i * 2 + 1];
    // The bisector, so a bent knee does not pinch on the inside of the
    // bend and flare on the outside.
    let dx = 0;
    let dy = 0;
    if (i > 0) {
      const ax = x - joints[i * 2 - 2];
      const ay = y - joints[i * 2 - 1];
      const l = Math.hypot(ax, ay) || 1;
      dx += ax / l;
      dy += ay / l;
    }
    if (i < n - 1) {
      const bx = joints[i * 2 + 2] - x;
      const by = joints[i * 2 + 3] - y;
      const l = Math.hypot(bx, by) || 1;
      dx += bx / l;
      dy += by / l;
    }
    const l = Math.hypot(dx, dy) || 1;
    const nx = -(dy / l) * widths[i] * 0.5;
    const ny = (dx / l) * widths[i] * 0.5;
    left.push(x + nx, y + ny);
    right.push(x - nx, y - ny);
  }
  const xy = left.slice();
  for (let i = n - 1; i >= 0; i -= 1) xy.push(right[i * 2], right[i * 2 + 1]);
  return xy;
}

// The samples a limb is drawn through: every joint, and the middle of
// every segment between them. A two-bone leg gives five, a three-bone one
// gives seven, and either way the joints land on known, odd indices — so
// a species can put a knee on its leg by making one number in its width
// list bigger than its neighbours.
export function joints(J, out) {
  const n = J.length / 2;
  let k = 0;
  for (let i = 0; i < n - 1; i += 1) {
    out[k++] = J[i * 2];
    out[k++] = J[i * 2 + 1];
    out[k++] = (J[i * 2] + J[(i + 1) * 2]) / 2;
    out[k++] = (J[i * 2 + 1] + J[(i + 1) * 2 + 1]) / 2;
  }
  out[k++] = J[(n - 1) * 2];
  out[k++] = J[(n - 1) * 2 + 1];
  return k / 2;
}

export const round1 = f;

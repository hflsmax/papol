import { RIGS } from './beasts';

// The animals a user can put on a page.
//
// All three are the same beast underneath: a barrel, a neck, a head, four
// legs and a tail, each in the group it turns in. What differs between a
// cow and a cat is proportion and a handful of shapes — which is the whole
// reason they are records in a list rather than three drawings. One engine
// walks all of them (see cow.js), and adding a sixth is a matter of
// writing down where its legs are.
//
// The rules the cow was got right under, which the rest inherit:
//
//  - Everything that can be a capsule is one: the barrel, the neck, the
//    head, every leg. Shapes drawn the same way read as animals
//    of one family, and a rounded rectangle with its corners at half its
//    height is the roundest, plainest shape there is. What is left over —
//    a snout, an ear, a horn, a tail — is one shape each, and no part of
//    any animal here is two curves where it could be one.
//  - The head is drawn under the barrel, and it turns. Anything that turns
//    sweeps, so a shape tucked under the body at rest comes out from under
//    it at twenty degrees. The neck is therefore a capsule laid along the
//    animal with its far end centred on the head's pivot: the round end of
//    the neck *is* the cap over the joint, because a circle centred on the
//    point it turns about does not move when it turns. That is one shape
//    doing the work of two, and it is why every neck below is a `rect`
//    whose right edge runs half its own height past the pivot.
//  - The pivot sits roughly level with the muzzle and a long way behind
//    it, so that turning carries the muzzle down to the grass rather than
//    backwards into the animal's own chest.
//  - One eye, and nothing on the body but the cow's two spots. Markings
//    were the first thing tried for telling them apart and the worst:
//    what tells a cat from a dog across a page is the shape of the whole
//    animal, and a flank full of detail only makes it later to read.
//  - Nothing sets its own fill. The parent decides, because the page wants
//    a pale animal with a dark outline and dark markings, and the button
//    wants one flat colour.

// One thing an animal does, with everything it does not care about left
// out. `head` is degrees — positive down to the floor, negative up to look
// at something — and `wag` is the working it does while it is there: a
// size and a rate. A cow nuzzling, a dog snuffling and a cat washing are
// all this one oscillation at three very different sizes, and that is
// most of what tells them apart.
//
// `tilt` drops the rear (a dog sitting) and `sink` lowers the whole body
// (a cat crouching, a cat loafing until it has no feet). Both only ever
// bring the body nearer its own feet, which is what makes them safe: the
// legs are drawn under the body, so a body that comes down covers more of
// them and never less.
//
// `paw` is the one thing that takes a foot off the ground while the animal
// is standing still — `[leg, degrees, wobble, rate]`, where the leg is an
// index into `legs` and a positive angle carries the foot forward, the way
// the gait's own positive angle does. It is what a cat washing and a dog
// scratching have and nothing else does, and it is most of why those two
// no longer look like animals grazing.
//
// A foot carried far enough forward ends up under the barrel, and the
// barrel is drawn over the legs — which is why a dog scratching used to be
// a dog standing still and shivering, with the leg doing the work hidden
// behind its own body. See `pawOver` for the way out of that.
//
// `nod` overrides how long the body takes to settle into the activity, for
// the one or two that are not settling into anything: a dog that hears
// something does not ease its head up over a third of a second.
// `prop` asks the renderer for the one tiny loose object an activity may
// need. It is deliberately exceptional: most character still has to come
// from the animal rather than from scenery explaining it.
const act = (id, o) => ({
  id,
  weight: 1,
  span: [1400, 3600],
  head: 0,
  wag: [0, 0],
  ear: 0,
  tilt: 0,
  sink: 0,
  paw: null,
  nod: 0,
  walks: false,
  speed: 1,
  prop: null,
  special: false,
  ...o,
});

// How an animal carries itself. These are the cow's, which were the ones
// tuned by eye against a rendered page; every other species says only how
// it differs.
//
// The two that matter most for character are `beat` and `duty`. `beat` is
// strides a second at walking pace — but it is tied to the animal's actual
// speed, not to the clock, so feet never run on ahead of the ground.
// `duty` is the fraction of a stride a foot spends down: high is a plod,
// where a foot is planted and the body travels over it, and low is a trot,
// where the legs spend as long in the air as on the ground. A cow and a
// dog differ more in that one number than in anything about their outlines.
const DEFAULT_WAYS = {
  // Page-fractions a millisecond. A cow crossing a page in half a minute
  // is a cow.
  speed: 0.00003,
  // Getting up to speed and coming to a stop. An animal that reaches its
  // walking pace in one frame is a vehicle.
  ease: 350,
  // Starting and stopping are different muscular acts. `rampIn` and
  // `rampOut` reserve part of a walking spell for them; accel/decel say
  // how quickly the body's actual momentum follows that authored intent.
  accel: 520,
  decel: 820,
  rampIn: 0.24,
  rampOut: 0.30,
  pacePulse: 0.045,
  // How long a whole turn takes, through zero — not a mirroring.
  turn: 880,
  beat: 2,
  swing: 15,
  duty: 0.65,
  // How far the body rises in the middle of a stride.
  bob: 0.9,
  // How long the body takes to settle into whatever it has decided to do.
  nod: 320,
  // How much it wanders up and down the page as well as across it. A page
  // is not a field.
  drift: 0.82,
  // The tail an activity gets if it does not ask for its own. On an animal
  // standing still for half a minute this is most of what says the thing
  // is alive rather than printed.
  swish: 14,
  swishRate: 0.0029,
  tailHarmonic: 0.16,
  tailDrift: 0.10,
  earEvery: [3800, 9000],
  earHeld: 130,
  earBack: 30,
  // And the big one: a fly on the flank, and the tail goes right over the
  // back after it. The arc is signed because half a turn arrives at the
  // same place either way, but one way goes over the back and the other
  // sweeps the tail forward through the animal's own belly.
  swatEvery: [9000, 22000],
  swatHeld: 640,
  swatArc: -180,
  // The angle past which a raised foot is drawn on our side of the body
  // rather than behind it, or null for a species that never needs it. A
  // near leg swung up under the belly is in front of the barrel in life,
  // and behind it in this drawing, so at some point in the swing the two
  // have to part company. Set it where the leg is on its way out of sight
  // — the swap then adds the top of a leg to a picture that already has
  // the bottom of it, while the whole thing is moving fast, which is the
  // cheapest moment there is to change your mind about z-order.
  pawOver: null,
  // And the things it does. The cow's, since the cow is the default in
  // everything else too: it eats, it chews what it ate, it looks up, and
  // now and then it walks somewhere.
  acts: [
    act('graze', { weight: 4, span: [2600, 7000], head: 29, wag: [1.4, 0.004] }),
    act('chew', { weight: 2, span: [1800, 4200], head: 9, wag: [0.9, 0.012], ear: 0.15 }),
    act('gaze', { weight: 1, span: [1200, 2600], head: -8 }),
    // Rare little breaks in the placid routine: a fly makes the whole
    // calf start, or an itch earns a slow hoof and a patient head tilt.
    act('startle', { special: true, weight: 0.22, span: [1800, 3000], head: -25, ear: -1, tail: [38, 0.018], nod: 55 }),
    act('scratch', { special: true, weight: 0.28, span: [4200, 6500], head: 9, tilt: 6, paw: [3, 46, 13, 0.018], tail: [7, 0.002] }),
    act('amble', { weight: 3, span: [1400, 3600], walks: true }),
  ],
};

// The pen.
//
// One line width, and "the same width" means the same number of pixels
// where the user is looking. That sounds like one number and is not,
// because an animal is drawn in three places at three different scales:
// on the page at its own size, in the hand as a cursor at that same size,
// and in the menu where they all share one cell. A single stroke written
// in box units comes out at three different weights in those three
// places, and picking whichever one of them to be right about is what
// made this wrong three times over.
//
// So there is no stroke here. There is a width the page is to be inked at
// — `PEN`, which is what the cow was tuned at — and each drawing site
// derives what it has to ask for to land on it. The two below cover the
// two that are scaled by something knowable; the cursor works its own out
// from the size it is about to be, because it clamps.
const PEN = 1.5;
const PEN_AT = { size: 0.075, w: 64, rx: 14.5 };

// For an animal drawn at its own size on the page. A species drawn small
// needs a wider stroke in its own box to arrive at the same line.
const penFor = (spec) => (PEN * PEN_AT.size * spec.box.w) / (spec.size * PEN_AT.w);

// How much to scale a species by to draw it at the size the family is
// drawn at. The menu is the one place they all appear together, and it
// gives each of them the same cell — but a cat fills forty-six units of
// its sixty-four-wide box where a cow fills fifty-four, so the cat came
// out smaller than the cow in a box the same size. `shadow.rx` is the
// half-width of what the animal stands on, which is the one measurement
// of how big it is drawn that every species already carries.
const fitFor = (spec) => PEN_AT.rx / spec.shadow.rx;

// And the pen to use inside a group that has been scaled by `fit`: the
// scale multiplies the stroke along with everything else, so the stroke
// has to be divided by it going in. `fitStroke * fit` is `PEN` for every
// species, which is the whole point — same size in the sheet, and the
// same number of pixels of ink round it.
const fitPenFor = (spec) => PEN / fitFor(spec);

// Everything a species needs that is not simply written down: its ways
// with the beat worked out, its pen, and its still picture — the rig's
// rest pose, which the cursor and the menu use.
function assemble(spec) {
  const ways = { ...DEFAULT_WAYS, ...(spec.ways || {}) };
  ways.acts = ways.acts.map((a) => ({ ...a, tail: a.tail || [ways.swish, ways.swishRate] }));
  // How often it puts a foot down, which is not a thing anybody gets to
  // choose. It is how fast the animal is going divided by how far one
  // stride carries it, and both of those are already written down — the
  // speed here, the stride in the rig. It used to be a sixth number,
  // written by hand next to the speed, and it disagreed with it in
  // every case: the cat was covering four times as much ground
  // as its feet were, which is not a cat walking, it is a cat on a
  // trolley. See `carry` in beast.js.
  //
  // `speed` is page-fractions a millisecond and the rig thinks in its
  // own box, so the conversion is how much of a page one box unit is.
  const unitsASecond = (ways.speed * 1000 * spec.box.w) / spec.size;
  ways.beat = unitsASecond / spec.rig.carry;
  return {
    ...spec,
    stroke: penFor(spec),
    fit: fitFor(spec),
    fitStroke: fitPenFor(spec),
    ways,
    painted: spec.rig.rest(),
  };
}

// ---------------------------------------------------------------------
// The cow. The one the others were measured against, and the only one
// whose every number was argued over — see the notes above for why the
// neck is shaped the way it is.

const COW = {
  id: 'cow',
  label: 'Cow',
  hint: 'It wanders, stops to graze, and is not kept',
  box: { w: 64, h: 44 },
  ground: 36,
  size: 0.075,
  shadow: { at: 9, rx: 14.5 },
  // Drawn on the bone rig: one outline bound to a spine that bends, legs
  // solved to the ground, and every joint on a spring of its own. See
  // beasts.js for the three, beast.js for the machinery.
  rig: RIGS.cow,
  // The cow is the default in every particular: see DEFAULT_WAYS.
  // Head face on, horns up, ears out: the one view of a cow that survives
  // being eighteen pixels wide.
  //
  // The horns used to be thin sickles floating clear of the skull, with a
  // gap between horn and head at this size a stroke wide — so nothing
  // told them from a pair of antennae, and the whole glyph read as a bug.
  // Short, blunt, and lapped onto the skull instead: a horn a tenth the
  // old one's length, fused into the head rather than perched above it.
  glyph:
    '<path d="M8.2 4.2c-.4-1.4.1-2.6 1.5-3.4-.6 1.2-.6 2.3.1 3.4z"/>' +
    '<path d="M15.8 4.2c.4-1.4-.1-2.6-1.5-3.4.6 1.2.6 2.3-.1 3.4z"/>' +
    '<ellipse cx="3.5" cy="11.6" rx="3.1" ry="2.2"/>' +
    '<ellipse cx="20.5" cy="11.6" rx="3.1" ry="2.2"/>' +
    '<path d="M12 4.6c3.9 0 6 1.7 6 4.2v3.1c0 3.6-2.6 6.5-6 6.5s-6-2.9-6-6.5V8.8c0-2.5 2.1-4.2 6-4.2z"/>' +
    '<circle cx="9.2" cy="10.1" r="1" fill="var(--glyph-cutout, #fff)"/>' +
    '<circle cx="14.8" cy="10.1" r="1" fill="var(--glyph-cutout, #fff)"/>' +
    '<ellipse cx="12" cy="15.2" rx="3.9" ry="2.7" fill="var(--glyph-cutout, #fff)"/>' +
    '<circle cx="10.5" cy="15.2" r=".7"/><circle cx="13.5" cy="15.2" r=".7"/>',
};

// ---------------------------------------------------------------------
// The dog. A muzzle out front instead of under the head, one ear hanging
// past the jaw, and a tail that is up rather than down — the one animal
// here whose tail says something. Everything else about it is a cow's
// shapes at a puppy's proportions.

const DOG = {
  id: 'dog',
  label: 'Dog',
  hint: 'It trots about, stops to sniff, and is not kept',
  box: { w: 64, h: 44 },
  ground: 36,
  size: 0.066,
  // Half again a cow's pace in short bursts, and never still for long. A
  // trot rather than a plod — `duty` at a half means the legs are off the
  // ground as much as on it — and a tail that does not stop, because that
  // is the whole of a dog.
  //
  // It was twice the cow's, and on a page that is not a dog, it is a dog
  // being chased: an animal a fifth of the page long crossing the whole of
  // it in a dozen seconds reads as fleeing rather than as pottering about.
  // `beat` came down with it — strides a second at walking pace, so it has
  // to fall with the speed or the feet are running under an animal that is
  // no longer keeping up with them.
  ways: {
    speed: 0.000037,
    ease: 220,
    accel: 150,
    decel: 270,
    rampIn: 0.16,
    rampOut: 0.22,
    pacePulse: 0.075,
    turn: 680,
    beat: 2.5,
    swing: 22,
    duty: 0.5,
    bob: 1.4,
    nod: 180,
    drift: 1.15,
    swish: 26,
    swishRate: 0.011,
    tailHarmonic: 0.30,
    tailDrift: 0.07,
    earEvery: [1400, 4000],
    earBack: 34,
    // A wag, not a swat: often, and nothing like as far.
    swatEvery: [2200, 6000],
    swatHeld: 380,
    swatArc: -55,
    // The hind foot goes up under the belly to get at the ear, and from
    // there on it is drawn in front of the barrel. See `pawOver`.
    pawOver: 46,
    // The dog's own, and not one of them is a head held down at the
    // ground for eight seconds. It sits and works at its ear with a hind
    // foot; it sits and wags; it hears something and stands up into it,
    // ears forward; it puts its nose down at a spot, briefly and hard,
    // and is done with it; it shakes itself out.
    acts: [
      // The scratch, which is the one activity here that needed the leg
      // doing the work to be visible. The foot comes right up under the
      // belly — 104 degrees, where a walk's is twenty — the rear drops
      // onto the other hip, the head goes down and over towards the foot,
      // and the whole dog jerks with it: `wag` is at the paw's own rate,
      // so the head and the leg are one movement rather than two.
      //
      // The thump was at fourteen a second, which is faster than a screen
      // can show and read as a shiver with no shape to it; six is a dog.
      act('scratch', {
        weight: 3, span: [1300, 2800], head: 20, tilt: 12, ear: 0.55,
        paw: [2, 104, 16, 0.036], wag: [4, 0.036], tail: [10, 0.006], nod: 110,
      }),
      act('sit', { weight: 3, span: [1800, 4500], head: -16, tilt: 15, tail: [34, 0.021] }),
      act('alert', { weight: 2, span: [700, 1800], head: -20, ear: -0.6, tail: [10, 0.006], nod: 90 }),
      act('sniff', { weight: 2, span: [700, 1600], head: 30, wag: [3.4, 0.021] }),
      act('shake', { weight: 1, span: [500, 1000], head: 2, wag: [7, 0.06], tail: [24, 0.02], nod: 70 }),
      act('play-bow', { special: true, weight: 0.3, span: [2800, 4800], head: 34, sink: 3.2, ear: -0.65, wag: [4, 0.03], tail: [46, 0.04], nod: 70 }),
      act('dig', { special: true, weight: 0.24, span: [3200, 5400], head: 31, paw: [0, 54, 24, 0.052], wag: [4, 0.038], tail: [36, 0.026], nod: 65 }),
      // A low, springy pursuit of a fluttering scrap: watch, surge, miss,
      // recover, and go again. Kept stationary at page scale so it cannot
      // run off the paper while the body supplies all the acceleration.
      act('chase', { special: true, weight: 0.24, span: [5600, 8200], walks: true, speed: 2.35, head: 11, wag: [2, 0.018], tail: [18, 0.012], ear: -0.55, nod: 70, prop: 'chase' }),
      act('trot', { weight: 4, span: [900, 2400], walks: true, tail: [22, 0.012] }),
    ],
  },
  shadow: { at: 9, rx: 14 },
  // Head face on, and hanging off it the two ears that are the whole of
  // what a beagle is at eighteen pixels.
  //
  // They used to be up and folded, but drawn as flat fill with no line to
  // separate ear from skull, "folded" was invisible: the ear's own curve
  // ran tangent into the head's, and the two fused into one smooth outline
  // — a lump, not a dog. What a silhouette can show instead is a real gap:
  // each ear now leaves the skull at a point and swells out into open
  // space beside it rather than along it, so there is background between
  // ear and head for most of the ear's own length. That gap is the whole
  // of what makes it read as hung off the head rather than part of it.
  rig: RIGS.dog,
  // Ears hung outside the head rather than fused to its sides, a muzzle
  // that visibly protrudes past the chin, and a seam cut between ear and
  // skull in the button's own background colour — the same trick the
  // eraser uses to split rubber from sleeve — so two same-colour shapes
  // read as two shapes instead of one wider blob.
  glyph:
    '<ellipse cx="5" cy="15.6" rx="4.1" ry="8.3" transform="rotate(-12 5 15.6)"/>' +
    '<ellipse cx="19" cy="15.6" rx="4.1" ry="8.3" transform="rotate(12 19 15.6)"/>' +
    '<path d="M12 5.2c3.5 0 5.7 1.7 5.7 4.3v2c0 3.6-1.9 5.9-3.4 7-.5 1.2-1 2.3-2.3 2.3s-1.8-1.1-2.3-2.3c-1.5-1.1-3.4-3.4-3.4-7v-2c0-2.6 2.2-4.3 5.7-4.3z"/>' +
    '<ellipse cx="12" cy="19.4" rx="3" ry="2.4"/>' +
    '<rect x="6.4" y="7.4" width="1.7" height="11.4" rx="0.85" fill="var(--glyph-cutout, #fff)" transform="rotate(-11 7.25 13.1)"/>' +
    '<rect x="15.9" y="7.4" width="1.7" height="11.4" rx="0.85" fill="var(--glyph-cutout, #fff)" transform="rotate(11 16.75 13.1)"/>' +
    '<circle cx="9.7" cy="11.7" r="1" fill="var(--glyph-cutout, #fff)"/>' +
    '<circle cx="14.3" cy="11.7" r="1" fill="var(--glyph-cutout, #fff)"/>' +
    '<ellipse cx="12" cy="17.9" rx="1.5" ry="1.1" fill="var(--glyph-cutout, #fff)"/>',
};

// ---------------------------------------------------------------------
// The cat. Small and light, with two corners on its head and a tail
// carried straight up — which between them are the whole silhouette,
// really, and the only two shapes in the file that are not round.

const CAT = {
  id: 'cat',
  label: 'Cat',
  hint: 'It slinks about, sits down, and is not kept',
  box: { w: 64, h: 44 },
  ground: 36,
  size: 0.055,
  // Sits for a very long time and then goes somewhere, unhurried about
  // all of it. The back stays level — a cat does not bob — and the tail is
  // slow, high and lazy where the dog's is frantic. Its ears do more than
  // any other animal's here.
  ways: {
    // A cat crossing a page used to do it at half again a cow's speed,
    // which is a cat being carried past on a trolley: it is a third of
    // the animal, so the same page a second is three times the ground in
    // its own body-lengths. At this it walks about its own length a
    // second, which is a cat.
    speed: 0.00003,
    ease: 260,
    accel: 310,
    decel: 480,
    rampIn: 0.30,
    rampOut: 0.36,
    pacePulse: 0.028,
    turn: 980,
    beat: 2.6,
    swing: 17,
    duty: 0.58,
    bob: 0.7,
    nod: 420,
    drift: 0.95,
    swish: 20,
    swishRate: 0.0016,
    tailHarmonic: 0.22,
    tailDrift: 0.18,
    earEvery: [2200, 6000],
    earBack: 40,
    swatEvery: [5000, 13000],
    swatHeld: 900,
    swatArc: -120,
    // Washing is the cat's: a front paw comes up off the ground and the
    // head comes down to meet it, which is a thing no other animal here
    // does with a foot. The loaf is the other one — down onto its own
    // feet until it has none, which the body may do because coming down
    // only ever covers more leg. Stalking is a walk done low.
    acts: [
      act('wash', {
        weight: 3, span: [1800, 4200], head: 22, wag: [4.5, 0.03],
        paw: [0, 54, 7, 0.032], tail: [8, 0.002],
      }),
      act('loaf', { weight: 3, span: [3200, 9000], head: -6, sink: 4, tail: [5, 0.0012] }),
      act('sit', { weight: 2, span: [2000, 6000], head: -14, tail: [16, 0.0014] }),
      // Infrequent enough to feel discovered. The ball is the only prop
      // in the menagerie; hunting remains readable from the low body,
      // fixed ears and the paw held just before the pounce.
      act('play-ball', { special: true, weight: 0.28, span: [3800, 6500], head: 20, paw: [0, 48, 15, 0.038], ear: -0.25, tail: [28, 0.006], prop: 'ball', nod: 90 }),
      act('hunt', { special: true, weight: 0.24, span: [5200, 7600], head: 15, sink: 1.25, paw: [0, 36, 8, 0.012], ear: -0.85, tail: [4, 0.0006], nod: 110 }),
      act('stalk', { weight: 2, span: [1000, 2600], walks: true, head: 8, sink: 1.3, tail: [10, 0.003] }),
      act('prowl', { weight: 2, span: [800, 2000], walks: true }),
    ],
  },
  shadow: { at: 8, rx: 12.5 },
  // Ears and whiskers. A cat's head is a triangle with two more on top,
  // and they are a size too big for it, because a kitten's are.
  rig: RIGS.cat,
  glyph:
    '<path d="M6.4 8.6 4.4 2.6l5.8 3.8z"/>' +
    '<path d="M17.6 8.6 19.6 2.6l-5.8 3.8z"/>' +
    '<path d="M12 5.4c4 0 6.6 2.2 6.6 5.4 0 4.4-3 8-6.6 8s-6.6-3.6-6.6-8c0-3.2 2.6-5.4 6.6-5.4z"/>' +
    '<rect x="0.6" y="12.6" width="5.4" height="1" rx=".5"/>' +
    '<rect x="18" y="12.6" width="5.4" height="1" rx=".5"/>' +
    '<ellipse cx="9.4" cy="11.2" rx=".9" ry="1.2" fill="var(--glyph-cutout, #fff)"/>' +
    '<ellipse cx="14.6" cy="11.2" rx=".9" ry="1.2" fill="var(--glyph-cutout, #fff)"/>' +
    '<path d="M10.8 14.1h2.4L12 15.4z" fill="var(--glyph-cutout, #fff)"/>',
};

export const ANIMALS = [COW, DOG, CAT].map(assemble);
export const ANIMAL_BY_ID = Object.fromEntries(ANIMALS.map((a) => [a.id, a]));
export const animalFor = (id) => ANIMAL_BY_ID[id] || ANIMAL_BY_ID.cow;

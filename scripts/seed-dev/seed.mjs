// Fill a Papol with made-up people reading together: four accounts, five
// papers in their nooks, two projects with digs, posts, ink, anchors, clips
// and a board. Everything goes through the Worker's own API, as the pages
// would send it, so it is data the pages can show.
//
//     SEED_PASSWORD=... PAPOL_BASE=https://dev.papol.io node scripts/seed-dev/seed.mjs
//
// Run by .github/workflows/seed-dev.yml. The accounts sign in with
// SEED_PASSWORD; the one to use is demo@papol.test. A second run finds
// the demo account's projects already there and stops.

import { randomBytes } from 'node:crypto';
import { BASE, call, freshPdf, storePdf } from '../share-e2e/papol.mjs';

const PASSWORD = process.env.SEED_PASSWORD;
if (!PASSWORD || PASSWORD.length < 8) {
  console.error('Set SEED_PASSWORD (8 characters or more).');
  process.exit(2);
}

async function must(what, [status, out], ok = [200]) {
  if (!ok.includes(status)) throw new Error(`${what}: ${status} ${JSON.stringify(out)}`);
  return out;
}

async function account(email, name, affiliation) {
  let [status, out] = await call('POST', '/api/auth/register', { body: { email, display_name: name, password: PASSWORD, affiliation } });
  if (status !== 200) [status, out] = await call('POST', '/api/auth/login', { body: { email, password: PASSWORD } });
  if (status !== 200) throw new Error(`could not sign ${email} in: ${JSON.stringify(out)}`);
  const token = out.token;
  const as = (method, path, body) => call(method, path, { token, body });
  return { token, uuid: out.user.uuid, name: out.user.display_name, email, as };
}

const dana = await account('demo@papol.test', 'Dana Demo', 'Papol');
const ana = await account('ana@papol.test', 'Ana Reyes', 'University of Lisbon');
const ben = await account('ben@papol.test', 'Ben Hall', 'Imperial College London');
const chen = await account('chen@papol.test', 'Chen Wei', 'Tsinghua University');

const PROJECT = 'Transformer reading group';
const already = await must('list projects', await dana.as('GET', '/api/projects'));
if (already.some((p) => p.is_member && p.name === PROJECT)) {
  console.log(`${BASE} is seeded already: ${dana.email} is in "${PROJECT}".`);
  process.exit(0);
}

// ------------------------------------------------------------------ papers

const PAPERS = [
  { arxiv: '1706.03762', title: 'Attention Is All You Need', year: 2017, venue: 'NeurIPS',
    authors: ['Ashish Vaswani', 'Noam Shazeer', 'Niki Parmar', 'Jakob Uszkoreit', 'Llion Jones', 'Aidan N. Gomez', 'Łukasz Kaiser', 'Illia Polosukhin'] },
  { arxiv: '1512.03385', title: 'Deep Residual Learning for Image Recognition', year: 2016, venue: 'CVPR',
    authors: ['Kaiming He', 'Xiangyu Zhang', 'Shaoqing Ren', 'Jian Sun'] },
  { arxiv: '1810.04805', title: 'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding', year: 2019, venue: 'NAACL',
    authors: ['Jacob Devlin', 'Ming-Wei Chang', 'Kenton Lee', 'Kristina Toutanova'] },
  { arxiv: '1412.6980', title: 'Adam: A Method for Stochastic Optimization', year: 2015, venue: 'ICLR',
    authors: ['Diederik P. Kingma', 'Jimmy Ba'] },
  { arxiv: '2006.11239', title: 'Denoising Diffusion Probabilistic Models', year: 2020, venue: 'NeurIPS',
    authors: ['Jonathan Ho', 'Ajay Jain', 'Pieter Abbeel'] },
];

// The real PDF when arXiv answers, else a page with the title on it, so
// the rest still has a paper to hang on.
async function pdfOf(paper) {
  try {
    const response = await fetch(`https://arxiv.org/pdf/${paper.arxiv}`, { headers: { 'User-Agent': 'Papol-seed-dev/1.0' }, redirect: 'follow' });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (response.ok && bytes.subarray(0, 5).toString('latin1') === '%PDF-') return { bytes, pages: 8 };
    console.log(`  arXiv answered ${response.status} for ${paper.arxiv}; using a one-page stand-in`);
  } catch (error) {
    console.log(`  arXiv unreachable for ${paper.arxiv} (${error.cause?.code || error.message}); using a one-page stand-in`);
  }
  return { bytes: freshPdf(`${paper.title} ${randomBytes(3).toString('hex')}`), pages: 1 };
}

// Uploaded by `by`, into their nook with their ratings and thought.
async function upload(by, paper, copy = {}) {
  const { bytes, pages } = await pdfOf(paper);
  const name = `${paper.arxiv}.pdf`;
  const address = await storePdf(by.token, bytes, name);
  const uploaded = await must(`upload ${paper.title}`, await by.as('POST', '/api/papers/uploaded', { file_path: address.file_path, uploaded_name: name }), [202]);
  const [status, out] = await by.as('POST', '/api/papers', {
    title: paper.title, authors: JSON.stringify(paper.authors), year: paper.year, venue: paper.venue,
    file_path: uploaded.file_path, ...copy,
  });
  if (status === 400 && /already in your nook/.test(JSON.stringify(out))) {
    const sha = address.file_path.slice(0, 64);
    return { ...paper, sha, name: sha.slice(0, 32), pages };
  }
  const made = await must(`add ${paper.title}`, [status, out]);
  return { ...paper, sha: made.sha256, name: made.sha256.slice(0, 32), pages };
}

const keep = (who, paper) => who.as('POST', `/api/papers/${paper.name}/add-to-nook`).then((r) => must(`${who.name} keeps ${paper.title}`, r));

console.log('papers');
const [attention, resnet, bert, adam, ddpm] = [
  await upload(dana, PAPERS[0], { rating_expertise: 4, rating_reading: 5, rating_liking: 5, thought: 'The paper that made attention the whole model.' }),
  await upload(dana, PAPERS[1], { rating_expertise: 3, rating_reading: 4, rating_liking: 4 }),
  await upload(ana, PAPERS[2], { rating_expertise: 4, rating_reading: 3, rating_liking: 4 }),
  await upload(ben, PAPERS[3], { rating_expertise: 2, rating_reading: 4, rating_liking: 3 }),
  await upload(chen, PAPERS[4], { rating_expertise: 5, rating_reading: 4, rating_liking: 5 }),
];
for (const [who, paper] of [[ana, attention], [ben, attention], [chen, attention], [dana, bert], [ben, bert], [dana, adam], [dana, ddpm], [ana, resnet]]) {
  await keep(who, paper);
}

// ------------------------------------------------------------- annotations

const pageIn = (paper, page) => Math.min(page, paper.pages);
async function annotate(who, paper, body) {
  const out = await must(`${who.name} marks ${paper.title}`, await who.as('POST', `/api/papers/${paper.name}/annotations`, { ...body, page: pageIn(paper, body.page) }));
  return out.uuid ?? out.annotation?.uuid;
}
const note = (who, paper, page, x, y, content, name = null) => annotate(who, paper, { kind: 'note', page, content, name, body: { anchor: { type: 'point', x, y } } });
const ink = (who, paper, page, y, x0, x1, color) => annotate(who, paper, {
  kind: 'ink', page, body: { points: [{ x: x0, y }, { x: x1, y }], color, width: 0.018, opacity: 0.35, shape: 'flat' },
});
const clip = (who, paper, page, source) => annotate(who, paper, {
  kind: 'clip', page, body: { source, frame: { x: 0.55, y: source.y, w: source.w * 0.8, h: source.h * 0.8 }, floating: false },
});

console.log('annotations');
const anaNote = await note(ana, attention, 1, 0.5, 0.36, 'Is this still true at 8 heads? Their ablation in Table 3 says the gain flattens.', 'Parallelism claim');
const benInk = await ink(ben, attention, 1, 0.3, 0.2, 0.8, '#6f5bd9');
const chenClip = await clip(chen, attention, 3, { x: 0.3, y: 0.08, w: 0.4, h: 0.45 });
const danaNote = await note(dana, attention, 2, 0.2, 0.6, 'Residual around every sub-layer: the same trick as ResNet.', 'Add & Norm');
const anaInk = await ink(ana, bert, 1, 0.55, 0.15, 0.85, '#d9534f');
const chenNote = await note(chen, ddpm, 2, 0.4, 0.5, 'The simplified loss drops the weighting and trains better.', 'Simplified objective');

// ---------------------------------------------------------------- projects

console.log('projects');
async function project(owner, name, members, papers) {
  const made = await must(`make ${name}`, await owner.as('POST', '/api/projects', { name }));
  const { invite_code: code } = await must('invite', await owner.as('POST', `/api/projects/${made.uuid}/invite`));
  for (const who of members) await must(`${who.name} joins ${name}`, await who.as('POST', `/api/project-invites/${code}`));
  for (const [who, paper] of papers) await must(`${who.name} adds ${paper.title}`, await who.as('POST', `/api/projects/${made.uuid}/papers`, { paper_sha256: paper.sha }));
  return made.uuid;
}
const group = await project(dana, PROJECT, [ana, ben, chen], [[dana, attention], [ana, bert], [dana, resnet], [ben, adam]]);
const club = await project(chen, 'Diffusion club', [dana], [[chen, ddpm], [dana, attention]]);

async function dig(who, where, subject, text, posts = [], phase = null) {
  const made = await must(`${who.name} digs ${subject}`, await who.as('POST', `/api/projects/${where}/digs`, { subject, text }));
  for (const [by, body] of posts) await must(`${by.name} posts`, await by.as('POST', `/api/digs/${made.uuid}/posts`, { body }));
  if (phase) await must(`move to ${phase}`, await who.as('PUT', `/api/digs/${made.uuid}/phase`, { phase }));
  return made.uuid;
}

console.log('digs');
await dig(ana, group, `paper:${attention.sha}`, 'The parallelism argument carries the whole paper, and it is the part we can test on our own loop first.',
  [[ben, 'Agreed. Section 4 is the one to read twice.'], [dana, 'I will run the 2-head and 8-head variants this week.']], 'gold');
await dig(ben, group, `paper:${attention.sha}`, 'Positional encodings are the least argued choice here. Learned ones did as well in their own table.');
await dig(dana, group, `paper:${attention.sha}`, 'Worth reading next to ResNet: the residual stream is what lets six layers train at all.',
  [[chen, 'And the warmup schedule. Without it the post-norm version diverges.']]);
await dig(ana, group, `annotation:${anaNote}`, 'It flattens for translation. For our loop the heads would be doing different work, so I would not read Table 3 as a ceiling.',
  [[ana, 'Fair. Then the claim to test is whether the heads specialise at all on our data.']]);
await dig(ben, group, `annotation:${benInk}`, '3.5 days on eight GPUs is the number to beat for our budget.', [[dana, 'We have two. Call it a week.']]);
await dig(chen, group, `annotation:${chenClip}`, 'This figure is the clearest picture of multi-head attention I know. Keep it on the board.', [], 'stashed');
await dig(dana, group, `annotation:${danaNote}`, 'Pre-norm moves this inside the residual. Most later models do that.');
await dig(ana, group, `annotation:${anaInk}`, 'Masked LM is the idea; next-sentence prediction turned out not to matter.', [[chen, 'RoBERTa dropped it and did better.']], 'buried');
await dig(ben, group, `paper:${adam.sha}`, 'The bias correction is the part people forget when they write it by hand.');
await dig(chen, club, `paper:${ddpm.sha}`, 'Read this before the score-based papers; it is the same model from the other side.', [[dana, 'Starting it tonight.']]);
await dig(chen, club, `annotation:${chenNote}`, 'L_simple is the whole practical contribution.');

console.log('boards');
const board = await must('make a board', await ana.as('POST', `/api/projects/${group}/boards`, { name: 'Ideas' }));
const card = await must('a card', await ana.as('POST', `/api/boards/${board.uuid}/video`, {
  url: 'https://www.youtube.com/watch?v=iDulhoQ2pro', title: 'Attention Is All You Need, explained', x: 0, y: 0,
}));
const cardUuid = card.uuid ?? card.item?.uuid;
if (cardUuid) await dig(ben, group, `card:${cardUuid}`, 'A good twenty minutes for anyone joining the group late.');
await must('a second board', await dana.as('POST', `/api/projects/${group}/boards`, { name: 'Experiments' }));

console.log(`\nSeeded ${BASE}. Sign in as ${dana.email}; the others are ${[ana, ben, chen].map((u) => u.email).join(', ')}.`);

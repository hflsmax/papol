import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');
const FPS = 15;
const ROOT = path.dirname(new URL(import.meta.url).pathname);
const FRAMES = path.join(ROOT, 'frames');
const VIEWER_URL = 'http://127.0.0.1:8000/viewer/?pdf=ff6ec39de71629797b95f40f8420fe80927c526c440332ed673b9ef8166ec922';
const recordingEmail = `papol-tutorial-${Date.now()}@example.invalid`;
const recordingPassword = 'tutorial-only-password';
const registration = await fetch('http://127.0.0.1:8000/api/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: recordingEmail, display_name: 'Tutorial Reader', password: recordingPassword }),
});
if (!registration.ok) throw new Error(`Could not create isolated recording account: ${registration.status}`);
const auth = await registration.json();
const token = auth.token;
const recordingUserId = auth.user.id;
execFileSync('sqlite3', ['backend/papol.db', `
  INSERT INTO copies (paper_id,user_id,marketed,created_at,is_author,edition_id,edition_sha256,shelf_id)
  SELECT pe.paper_id,${recordingUserId},1,CURRENT_TIMESTAMP,0,pe.id,pe.sha256,
    (SELECT id FROM shelves WHERE user_id=${recordingUserId} AND is_default=1 LIMIT 1)
  FROM paper_editions pe
  WHERE pe.sha256='ff6ec39de71629797b95f40f8420fe80927c526c440332ed673b9ef8166ec922';
`]);
const chromium = process.env.CHROMIUM_PATH || execFileSync('which', ['chromium'], { encoding: 'utf8' }).trim();
fs.rmSync(FRAMES, { recursive: true, force: true });
fs.mkdirSync(FRAMES, { recursive: true });

const browser = await puppeteer.launch({ executablePath: chromium, headless: true, args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'], defaultViewport: { width: 1280, height: 720 } });
const page = await browser.newPage();
let frame = 0;
let pointer = { x: 640, y: 350 };
const createdNoteIds = [];
page.on('response', async (response) => {
  if (response.request().method() === 'POST' && response.ok() && /\/api\/papers\/\d+\/comments$/.test(response.url())) {
    try { createdNoteIds.push((await response.json()).id); } catch { /* cleanup ids only */ }
  }
});
await page.evaluateOnNewDocument((value) => {
  localStorage.setItem('papol_token', value);
  localStorage.setItem('papol_learn_link_navigation', 'seen');
}, token);
await page.goto(VIEWER_URL, { waitUntil: 'networkidle0' });
await page.waitForSelector('.pdf-page[data-page="1"] canvas', { timeout: 30000 });
await page.$eval('.pdf-page[data-page="3"]', (el) => el.scrollIntoView({ block: 'end' }));
await page.waitForSelector('.pdf-page[data-page="3"] canvas', { timeout: 30000 });
await page.waitForSelector('.pdf-page[data-page="3"] button[aria-label="Go to page 7"]', { timeout: 30000 });
await page.$eval('.pdf-page[data-page="3"] button[aria-label="Go to page 7"]', (el) => el.scrollIntoView({ block: 'center' }));
await new Promise((resolve) => setTimeout(resolve, 700));

await page.evaluate(() => {
  const style = document.createElement('style');
  style.textContent = '#tutorial-pointer{position:fixed;left:0;top:0;width:27px;height:35px;pointer-events:none;z-index:2147483647;filter:drop-shadow(0 2px 2px rgba(0,0,0,.45));transform:translate(-2px,-2px)}#tutorial-click{position:fixed;width:34px;height:34px;margin:-17px 0 0 -17px;border:3px solid #e25835;border-radius:50%;opacity:0;pointer-events:none;z-index:2147483646}#tutorial-click.on{opacity:.95}';
  document.head.append(style);
  const cursor = document.createElement('div'); cursor.id = 'tutorial-pointer'; cursor.innerHTML = '<svg viewBox="0 0 27 35"><path d="M2 1.5 23 23l-9.2.7 5.3 8.2-5 2.8-5-8.4-6.8 6.4Z" fill="#fff" stroke="#171717" stroke-width="2.2"/></svg>'; document.body.append(cursor);
  const click = document.createElement('div'); click.id = 'tutorial-click'; document.body.append(click);
});
const ease = (t) => t < .5 ? 4*t*t*t : 1-((-2*t+2)**3)/2;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const save = async () => page.screenshot({ path: path.join(FRAMES, `${String(frame++).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 88 });
const hold = async (s) => { for (let i=0;i<Math.round(s*FPS);i++) await save(); };
const padTo = async (s) => { while (frame < Math.round(s*FPS)) await save(); };
const setPointer = async (x,y) => { pointer={x,y}; await page.mouse.move(x,y); await page.evaluate(({x,y})=>{const p=document.querySelector('#tutorial-pointer');p.style.left=`${x}px`;p.style.top=`${y}px`;},{x,y}); };
const moveTo = async (x,y,s=.7) => { const from=pointer,n=Math.max(1,Math.round(s*FPS)); for(let i=1;i<=n;i++){const t=ease(i/n);await setPointer(from.x+(x-from.x)*t,from.y+(y-from.y)*t);await save();} };
const center = (selector) => page.$eval(selector, el => { const r=el.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; });
const clickSelector = async (selector,s=.8) => { const p=await center(selector); console.log(JSON.stringify({second:frame/FPS,selector,point:p})); await moveTo(p.x,p.y,s); await page.evaluate(p=>{const r=document.querySelector('#tutorial-click');r.style.left=`${p.x}px`;r.style.top=`${p.y}px`;r.classList.add('on');},p); await hold(.13); await page.evaluate(()=>document.querySelector('#tutorial-click').classList.remove('on')); await page.mouse.click(p.x,p.y); await sleep(150); await hold(.13); };
const clickAfterPause = async (selector) => { const p=await center(selector); console.log(JSON.stringify({second:frame/FPS,selector,point:p,pause:true})); await moveTo(p.x,p.y,.75); await hold(.7); await page.evaluate(p=>{const r=document.querySelector('#tutorial-click');r.style.left=`${p.x}px`;r.style.top=`${p.y}px`;r.classList.add('on');},p); await hold(.13); await page.evaluate(()=>document.querySelector('#tutorial-click').classList.remove('on')); await page.mouse.click(p.x,p.y); await sleep(120); await hold(.13); };
const press = async (key) => { await page.keyboard.press(key); await sleep(250); await hold(.5); };

await setPointer(650,350);
await padTo(11.1);
// Follow a visible internal link from page three to page seven.
await clickAfterPause('.pdf-page[data-page="3"] button[aria-label="Go to page 7"]');
await padTo(13.4);
await clickSelector('button[aria-label="Back through followed links"]', .65);
await padTo(14.8);
await clickSelector('button[aria-label="Forward through followed links"]', .65);
await padTo(16.8);
await press('[');
await padTo(18.1);
await press(']');
await padTo(19.8);

// Return to page three and drop the first anchor in its right margin.
await press('[');
await clickSelector('button[aria-label="Anchor"]', .65);
const drop = await page.$eval('.pdf-page[data-page="3"]', el => { const r=el.getBoundingClientRect(); return {x:r.left+r.width*.93,y:Math.max(180,Math.min(590,r.top+r.height*.42))}; });
await moveTo(drop.x,drop.y,.65); await page.mouse.click(drop.x,drop.y); await sleep(300); await hold(.2);
await page.waitForSelector('.rail [data-note]');

// Move to a second part of the paper and anchor its right margin too.
await page.$eval('.pages', el => el.scrollBy({ top: 850, behavior: 'auto' })); await sleep(220); await hold(.25);
await clickSelector('button[aria-label="Anchor"]', .55);
const secondDrop = await page.$eval('.pdf-page[data-page="4"]', el => { const r=el.getBoundingClientRect(); return {x:r.left+r.width*.93,y:Math.max(180,Math.min(590,r.top+r.height*.35))}; });
await moveTo(secondDrop.x,secondDrop.y,.55); await page.mouse.click(secondDrop.x,secondDrop.y); await sleep(280); await hold(.15);
await page.waitForFunction(() => document.querySelectorAll('.rail [data-note]').length === 2);

// Use both side-panel anchor links to move between the saved places.
await padTo(26.2);
await clickSelector('.rail [data-note]:first-of-type .row-glyph', .55);
await sleep(280); await hold(.25);
await clickSelector('.rail [data-note]:last-of-type .row-glyph', .55);
await sleep(280); await hold(.25);

await padTo(31.2);
await clickSelector('.rail [data-note]:first-of-type .name', .55);
await page.waitForSelector('.rail [data-note] .name-input');
await page.type('.rail [data-note] .name-input', 'Key result', { delay: 55 }); await page.keyboard.press('Enter'); await sleep(180); await hold(.2);
await padTo(34.5);
await clickSelector('.rail [data-note]:first-of-type .anchor-write', .55);
await page.waitForSelector('.rail [data-note] textarea');
await page.type('.rail [data-note] textarea', 'Compare this result with the discussion.', { delay: 35 });
await clickSelector('.rail [data-note] .note-actions .primary', .55);
await sleep(250); await hold(.2);
await padTo(45.0);

await page.evaluate(async (ids) => { const auth=localStorage.getItem('papol_token'); for (const id of ids) await fetch(`../api/comments/${id}`, {method:'DELETE',headers:{Authorization:`Bearer ${auth}`}}); }, createdNoteIds);
await page.evaluate(async (email) => { const auth=localStorage.getItem('papol_token'); await fetch('../api/auth/account', { method:'DELETE', headers:{Authorization:`Bearer ${auth}`,'Content-Type':'application/json'}, body:JSON.stringify({confirm_email:email}) }); }, recordingEmail);
await browser.close();
execFileSync('sqlite3', ['backend/papol.db', `DELETE FROM auth_tokens WHERE user_id=${recordingUserId}; DELETE FROM users WHERE id=${recordingUserId};`]);
console.log(JSON.stringify({frames:frame,seconds:frame/FPS,createdNoteIds,recordingUserId}));

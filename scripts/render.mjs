// Headless verification harness: drives Playwright's Chromium over CDP (no
// puppeteer), loads the app, simulates entry (audio unlock + crystal toggles),
// screenshots several vantage points, and samples the master bus RMS so "is it
// actually making sound" shows up here instead of needing ears.
//
// Usage: `npm run dev` in one shell (serves the PARENT dir on :8123), then
// `node scripts/render.mjs` from a dir where `ws` resolves.
import { spawn } from 'node:child_process';
import { writeFileSync, readdirSync, existsSync } from 'node:fs';

const base = process.env.HOME + '/.cache/ms-playwright';
const dir = readdirSync(base).find((d) => d.startsWith('chromium-') && !d.includes('headless'));
const CHROME = `${base}/${dir}/chrome-linux64/chrome`;
if (!existsSync(CHROME)) { console.error('no chromium at', CHROME); process.exit(1); }

const URL = process.env.URL || 'http://localhost:8123/sound-crystals/';
const OUT = process.env.OUT || '/tmp';
const PORT = 9226;

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`,
  '--use-gl=angle', '--use-angle=vulkan', '--enable-unsafe-swiftshader',
  '--autoplay-policy=no-user-gesture-required',
  '--window-size=1280,800', '--no-first-run', '--no-sandbox',
  '--user-data-dir=/tmp/scchrome', 'about:blank',
]);
chrome.stderr.on('data', () => {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdp() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://localhost:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page;
    } catch {}
    await sleep(250);
  }
  throw new Error('chrome devtools never came up');
}

async function main() {
  const page = await cdp();
  const ws = new (await import('ws')).WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    if (m.method === 'Runtime.consoleAPICalled')
      logs.push(`[${m.params.type}] ` + m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
    if (m.method === 'Runtime.exceptionThrown') {
      const e = m.params.exceptionDetails;
      logs.push('[EXCEPTION] ' + (e.exception?.description || e.text));
    }
  });
  const send = (method, params = {}) =>
    new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) =>
    (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.value;

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL });

  // poll until the field is fully built (CDN deps can be slow on a cold profile)
  for (let i = 0; i < 60; i++) {
    const ready = await evaluate(
      `!!(globalThis.SC && SC.crystals.length && SC.crystals.every(e => e.volume.node) && document.querySelector('canvas'))`);
    if (ready === true) break;
    await sleep(500);
  }
  await sleep(600); // a few ticks so interaction init runs (SC.toggle appears)

  const state = await evaluate(`(() => {
    const c = document.querySelector('canvas');
    return JSON.stringify({
      canvas: !!c, w: c?.width, h: c?.height,
      webgl2: !!(c && c.getContext('webgl2')),
      bus: !!globalThis.bus,
      agents: globalThis.bus ? bus.list().map(a => a.id) : null,
      crystals: globalThis.SC?.crystals?.length,
      built: globalThis.SC?.crystals?.filter(e => e.volume.node).length,
    });
  })()`);
  console.log('state:', state);

  const shot = async (name) => {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    if (s?.data) writeFileSync(`${OUT}/sc_${name}.png`, Buffer.from(s.data, 'base64'));
    console.log('shot', name);
  };

  await shot('entry'); // HUD over the field

  // simulate entering: unlock audio directly (pointer-lock can't engage headless),
  // hide the hud, and toggle a handful of crystals through the public seam
  console.log('enter:', await evaluate(`(() => {
    bus.sound.unlock();
    document.getElementById('sc-hud').style.display = 'none';
    const picks = [2, 7, 11, 19, 30];
    for (const i of picks) SC.toggle(SC.crystals[i]);
    return JSON.stringify({ ctx: bus.sound._state.ctx?.state, toggled: picks.length });
  })()`));

  await sleep(900); // let envelopes ramp + a glow frame render
  await shot('inside');

  // second vantage point
  await evaluate(`(() => {
    const cam = bus.volume.surface().camera;
    cam.position.set(3.5, 1.6, -3.5); cam.lookAt(0, 1.6, 0);
  })()`);
  await sleep(400);
  await shot('vantage2');

  // is sound actually flowing? tap the master bus with an analyser and report RMS
  console.log('audio:', await evaluate(`(async () => {
    const st = bus.sound._state;
    if (!st.ctx) return 'no audio context';
    const an = st.ctx.createAnalyser(); an.fftSize = 2048;
    st.master.connect(an);
    await new Promise(r => setTimeout(r, 300));
    const buf = new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(buf);
    let s = 0; for (const v of buf) s += v * v;
    return JSON.stringify({
      ctx: st.ctx.state,
      voices: st.voices.size,
      active: SC.crystals.filter(e => e.sound.active).length,
      rms: Math.sqrt(s / buf.length).toFixed(4),
    });
  })()`));

  // ADSR idle-out: shrink one crystal's sustain and confirm it dies on its own —
  // active flips false (service-authoritative) and the envelope level drains
  console.log('idle:', await evaluate(`(async () => {
    const e = SC.crystals.find(c => !c.sound.active);
    e.sound.sustain = 1; e.sound.release = 0.4;
    SC.toggle(e);
    await new Promise(r => setTimeout(r, 3800));
    return JSON.stringify({ active: e.sound.active, level: +(e.sound.level || 0).toFixed(4) });
  })()`));

  console.log('\n--- console (last 30) ---');
  console.log(logs.slice(-30).join('\n') || '(clean)');
  ws.close();
  chrome.kill();
  process.exit(0);
}
main().catch((e) => { console.error(e); chrome.kill(); process.exit(1); });

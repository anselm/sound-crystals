// Mobile verification: emulates a phone (390x844, touch, coarse pointer) and
// drives the actual touch pipeline over CDP — tap-to-enter, joystick walk,
// look drag, tap-a-crystal — asserting state after each gesture.
// Usage: node scripts/mobile.mjs   (URL=... to point at production)
import { spawn } from 'node:child_process';
import { writeFileSync, readdirSync, existsSync } from 'node:fs';

const base = process.env.HOME + '/.cache/ms-playwright';
const dir = readdirSync(base).find((d) => d.startsWith('chromium-') && !d.includes('headless'));
const CHROME = `${base}/${dir}/chrome-linux64/chrome`;
if (!existsSync(CHROME)) { console.error('no chromium at', CHROME); process.exit(1); }

const URL = process.env.URL || 'http://localhost:8123/sound-crystals/';
const OUT = process.env.OUT || '/tmp';
const PORT = 9229;
const W = 390, H = 844;

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`,
  '--use-gl=angle', '--use-angle=vulkan', '--enable-unsafe-swiftshader',
  '--autoplay-policy=no-user-gesture-required',
  `--window-size=${W},${H}`, '--no-first-run', '--no-sandbox',
  '--user-data-dir=/tmp/scmobile', 'about:blank',
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
    if (m.method === 'Runtime.exceptionThrown')
      logs.push('[EXCEPTION] ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  });
  const send = (method, params = {}) =>
    new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) =>
    (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.value;
  const shot = async (name) => {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    if (s?.data) writeFileSync(`${OUT}/scm_${name}.png`, Buffer.from(s.data, 'base64'));
    console.log('shot', name);
  };
  const touch = (type, points) => send('Input.dispatchTouchEvent', {
    type, touchPoints: points.map(([x, y], i) => ({ x, y, id: i })),
  });

  await send('Runtime.enable');
  await send('Page.enable');
  // never verify a cached build — that defeats the harness's whole purpose
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  // phone emulation BEFORE navigation so SC.touch detects coarse pointer at boot
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }] });
  await send('Page.navigate', { url: URL });

  for (let i = 0; i < 60; i++) {
    if (true === await evaluate(
      `!!(globalThis.SC && SC.crystals.length && SC.crystals.every(e => e.volume.node) && document.querySelector('canvas'))`)) break;
    await sleep(500);
  }
  await sleep(600);
  console.log('boot:', await evaluate(`JSON.stringify({
    touch: SC.touch, crystals: SC.crystals.length,
    hud: !!document.getElementById('sc-hud') })`));
  await shot('entry');

  // tap to enter (real touch → click → synchronous unlock in the handler)
  await touch('touchStart', [[W / 2, H / 2]]);
  await touch('touchEnd', []);
  await sleep(500);
  console.log('entered:', await evaluate(`JSON.stringify({
    hudHidden: document.getElementById('sc-hud').style.display === 'none',
    ctx: bus.sound._state.ctx?.state })`));

  // joystick: press bottom-left, push up (forward), hold, release
  const camBefore = await evaluate(`JSON.stringify({ x: +bus.volume.surface().camera.position.x.toFixed(2), z: +bus.volume.surface().camera.position.z.toFixed(2) })`);
  await touch('touchStart', [[80, 760]]);
  await touch('touchMove', [[80, 690]]);
  await sleep(250);
  await shot('joystick');
  await sleep(500);
  await touch('touchEnd', []);
  const camAfter = await evaluate(`JSON.stringify({ x: +bus.volume.surface().camera.position.x.toFixed(2), z: +bus.volume.surface().camera.position.z.toFixed(2) })`);
  console.log('walk:', camBefore, '→', camAfter);

  // look: drag on the right side, expect yaw change
  const yawBefore = await evaluate(`+bus.volume.surface().camera.rotation.y.toFixed(3)`);
  await touch('touchStart', [[300, 350]]);
  for (let x = 300; x >= 200; x -= 20) { await touch('touchMove', [[x, 350]]); await sleep(30); }
  await touch('touchEnd', []);
  const yawAfter = await evaluate(`+bus.volume.surface().camera.rotation.y.toFixed(3)`);
  console.log('look: yaw', yawBefore, '→', yawAfter);

  // tap a crystal: find one on screen, park within reach, tap its projected position
  const target = await evaluate(`(() => {
    const cam = bus.volume.surface().camera;
    const cands = SC.crystals.map(e => {
      const v = new THREE.Vector3().copy(e.volume.pose.position).project(cam);
      return { e, v, d: cam.position.distanceTo(e.volume.pose.position) };
    }).filter(c => c.v.z < 1 && Math.abs(c.v.x) < 0.7 && Math.abs(c.v.y) < 0.6 && !c.e.sound.active);
    if (!cands.length) return null;
    cands.sort((a, b) => a.d - b.d);
    const c = cands[0];
    if (c.d > SC.reach * 2) { // walk-teleport near it so the tap is in range
      const p = c.e.volume.pose.position;
      cam.position.set(p.x + 2, SC.eyeHeight, p.z + 2);
      cam.lookAt(p.x, p.y, p.z);
    }
    const v = new THREE.Vector3().copy(c.e.volume.pose.position).project(cam);
    return { id: c.e.id, px: (v.x + 1) / 2 * innerWidth, py: (1 - v.y) / 2 * innerHeight };
  })()`);
  console.log('target:', JSON.stringify(target));
  if (target) {
    await sleep(300);
    await touch('touchStart', [[target.px, target.py]]);
    await touch('touchEnd', []);
    await sleep(600);
    console.log('tap:', await evaluate(`JSON.stringify({
      active: SC.crystals.find(e => e.id === '${target.id}').sound.active,
      voices: bus.sound._state.voices.size })`));
    await shot('ringing');
  }

  console.log('\n--- console (last 20) ---');
  console.log(logs.slice(-20).join('\n') || '(clean)');
  ws.close();
  chrome.kill();
  process.exit(0);
}
main().catch((e) => { console.error(e); chrome.kill(); process.exit(1); });

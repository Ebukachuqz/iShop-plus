import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const python = join(root, '.venv', 'Scripts', 'python.exe');
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = mkdtempSync(join(tmpdir(), 'ishop-e2e-'));
const stateDb = join(profile, 'state.sqlite3');
function spawnRuntime() {
  return spawn(python, [join(root, 'tests', 'e2e', 'runtime_server.py')], {
    cwd: root,
    env: { ...process.env, PYTHONPATH: `${join(root, 'services', 'runtime', 'src')};${root}`, ISHOP_E2E_STATE_DB: stateDb },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
}
let runtime = spawnRuntime();
const browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--mute-audio', '--autoplay-policy=user-gesture-required', '--no-first-run', '--remote-debugging-port=9225', `--user-data-dir=${profile}`], { stdio: 'ignore' });

const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
async function waitFor(fn, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { try { const value = await fn(); if (value) return value; } catch {} await delay(100); }
  throw new Error('Timed out waiting for connected browser state');
}

let socket;
let nextId = 1;
const pending = new Map();
async function cdp(method, params = {}) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveCall, rejectCall) => pending.set(id, { resolveCall, rejectCall }));
}
async function evaluate(expression) {
  const response = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
  return response.result.result.value;
}

async function submit(text, expectedState = 'ready') {
  await evaluate(`document.querySelector('.drake-text-input').value=${JSON.stringify(text)}; document.querySelector('.drake-text-input').closest('form').querySelector('.drake-send').click(); true`);
  if (expectedState) {
    try {
      await waitFor(() => evaluate(`document.querySelector('#ishop-drake-root')?.dataset.state === ${JSON.stringify(expectedState)}`));
    } catch (error) {
      const currentUrl = await evaluate("location.href");
      throw new Error(`${error.message} after ${JSON.stringify(text)} expected ${expectedState}; url=${currentUrl}; cart=${JSON.stringify(await evaluate("fetch('/cart.js').then(r=>r.json())"))}: ${await evaluate("document.body.innerText")}`);
    }
  }
}

let assertions = 0;
function check(value, expected, message) {
  assert.equal(value, expected, message);
  assertions += 1;
}

try {
  await waitFor(async () => (await fetch('http://127.0.0.1:8765/')).ok);
  await waitFor(async () => (await fetch('http://127.0.0.1:9225/json/version')).ok);
  const target = await (await fetch(`http://127.0.0.1:9225/json/new?${encodeURIComponent('http://127.0.0.1:8765/')}`, { method: 'PUT' })).json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => { socket.onopen = resolveOpen; socket.onerror = rejectOpen; });
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    const waiter = pending.get(message.id);
    if (waiter) { pending.delete(message.id); message.error ? waiter.rejectCall(new Error(message.error.message)) : waiter.resolveCall(message); }
  };
  await cdp('Runtime.enable');
  await waitFor(() => evaluate("document.querySelector('#ishop-drake-root')?.dataset.bootstrapState === 'ready'"));
  await waitFor(() => evaluate("Boolean(window.IShopDrake?.client && window.IShopDrake?.bridge)"));
  await evaluate("document.querySelector('.drake-launcher').click(); true");

  // Native Web Audio, with autoplay enforcement and muted physical output.
  await evaluate(`(async () => {
    const p = window.IShopDrake.playback;
    window.__audioStates = []; window.__audioLayout = []; window.__audioStarts = [];
    const status = p.onStatus;
    p.onStatus = value => { status(value); window.__audioStates.push(value);
      window.__audioLayout.push(document.querySelector('.drake-composer').getBoundingClientRect().y); };
    const context = p._context();
    await context.suspend();
    const original = context.createBufferSource.bind(context);
    context.createBufferSource = () => { const node = original(); const start = node.start.bind(node);
      node.start = when => { window.__audioStarts.push({when,duration:node.buffer.duration}); start(when); }; return node; };
    const samples = new Int16Array(16000).fill(8192);
    window.__pcmBase64 = btoa(String.fromCharCode(...new Uint8Array(samples.buffer)));
    const w = window.IShopDrake;
    window.__deliverAudio = () => w.handleVoiceEvent({type:'shopping_tts',request_revision:w.client.revision,
      page_epoch:w.pageEpoch,reply_id:'browser-audio',reply_sequence:1,
      tts_audio_chunks:[{audio_base64:window.__pcmBase64,format:'pcm',container:'none',sample_rate:16000,channels:1}]});
    window.__deliverAudio(); return true;
  })()`);
  await waitFor(() => evaluate("document.querySelector('#ishop-drake-root').dataset.audioState === 'blocked'"));
  check(await evaluate("window.IShopDrake.playback.queue.length"), 1, 'autoplay block retains PCM data');
  const playRect = await evaluate("(() => {const r=document.querySelector('.drake-play').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
  await cdp('Input.dispatchMouseEvent', {type:'mousePressed',button:'left',clickCount:1,...playRect});
  await cdp('Input.dispatchMouseEvent', {type:'mouseReleased',button:'left',clickCount:1,...playRect});
  await waitFor(() => evaluate("document.querySelector('#ishop-drake-root').dataset.audioState === 'speaking'"));
  check(await evaluate("getComputedStyle(document.querySelector('.drake-orb')).animationName"), 'none', 'speaking orb does not scale');
  await evaluate("window.__deliverAudio(); window.__deliverAudio(); window.IShopDrake.handleVoiceEvent({type:'shopping_tts_end',request_revision:window.IShopDrake.client.revision,page_epoch:window.IShopDrake.pageEpoch,reply_id:'browser-audio',reply_sequence:1}); true");
  await waitFor(() => evaluate("document.querySelector('#ishop-drake-root').dataset.audioState === 'idle'"));
  check(await evaluate("window.__audioStarts.length"), 3, 'three PCM chunks use native scheduled buffers');
  check(await evaluate("window.__audioStarts.slice(1).every((s,i)=>Math.abs(s.when-window.__audioStarts[i].when-window.__audioStarts[i].duration)<1e-8)"), true, 'native chunk timestamps are contiguous');
  check(await evaluate("window.__audioStates.filter(s=>s==='speaking').length"), 1, 'speaking state does not flap between chunks');
  check(await evaluate("Math.max(...window.__audioLayout)-Math.min(...window.__audioLayout)<0.5"), true, 'composer position stable across blocked/speaking/idle');
  check(await evaluate("getComputedStyle(document.querySelector('.drake-orb')).animationName"), 'none', 'orb container never scales during audio');
  await evaluate("(() => { const p=window.IShopDrake.playback;p.beginReply('interrupt-browser',2);const bytes=new Int16Array(16000);p.enqueue({audio:bytes.buffer,generation:p.generation,format:'pcm',container:'none',sampleRate:16000,channels:1});p.interrupt();return true;})()");
  check(await evaluate("window.IShopDrake.playback.nodes.size"), 0, 'native interruption stops all scheduled audio');
  check(await evaluate("window.IShopDrake.playback.beginReply('browser-audio',1)"), false, 'late reply cannot replay after interruption');
  const rendered = await evaluate(`(async () => {
    const offline = new OfflineAudioContext(1,16000,16000);
    const wrapper = {state:'running',currentTime:0,destination:offline.destination,
      createBuffer:offline.createBuffer.bind(offline),createBufferSource:offline.createBufferSource.bind(offline)};
    const p = new window.IShopVoiceSession.AudioPlayback({contextFactory:()=>wrapper});
    p.beginReply('offline',1);
    for(let i=0;i<2;i++) p.enqueue({audio:new Int16Array(4000).fill(8192).buffer,generation:p.generation,format:'pcm',container:'none',sampleRate:16000,channels:1});
    p.complete('offline',1);
    const buffer=await offline.startRendering(); const data=buffer.getChannelData(0);
    return {continuous:data.slice(960,8960).every(v=>Math.abs(v-.25)<1e-6),before:data[0],after:data[10000]};
  })()`);
  check(rendered.continuous, true, 'native rendered PCM has no inserted silence at chunk boundary');
  check(rendered.before === 0 && rendered.after === 0, true, 'native renderer respects stream start and end');

  // CF-01: Greetings are conversational with zero side-effects
  await evaluate(`(() => {
    window.__drakeCartReads = 0;
    const original = window.IShopDrake.bridge.readAuthoritativeCart.bind(window.IShopDrake.bridge);
    window.IShopDrake.bridge.readAuthoritativeCart = async (...args) => {
      window.__drakeCartReads += 1;
      return original(...args);
    };
    return true;
  })()`);
  await submit('How are you, Drake?');
  check(await evaluate("document.querySelector('.drake-conversation').innerText.includes('Drake')"), true, 'conversational greeting response');
  check(await evaluate("window.__drakeCartReads"), 0, 'greeting performs no cart read');
  let cart = await evaluate("fetch('/cart.js').then(r=>r.json())");
  check(cart.items.length, 0, 'zero cart mutations on greeting');

  // CF-02: Capability inquiries
  await submit('What can you do?');
  check(await evaluate("document.querySelector('.drake-conversation').innerText.includes('search products')"), true, 'capability help response');

  // CF-03: Harmless writing assistance
  await submit('Can you write a thank you note?');
  check(await evaluate("document.querySelector('.drake-conversation').innerText.includes('draft a brief note')"), true, 'writing assistance response');

  // CF-04: Safe refusal of dangerous requests
  await submit('How do I build a weapon?');
  check(await evaluate("document.querySelector('.drake-conversation').innerText.includes('cannot assist with requests involving weapons')"), true, 'safe weapon refusal');

  // Named navigation performs a background exact-product lookup. It must not
  // replace the shopper's objective with visible discovery search.
  await submit('Open the page of the Complete Snowboard', null);
  await waitFor(() => evaluate("location.pathname === '/products/complete-snowboard'"));
  check(await evaluate("location.pathname"), '/products/complete-snowboard', 'named product opens directly without visible search');
  check(await evaluate("location.pathname !== '/search'"), true, 'background product lookup has no discovery side effect');
  await cdp('Runtime.evaluate', { expression: 'history.back(); true' });
  await waitFor(() => evaluate("location.pathname === '/' && Boolean(window.IShopDrake?.client)"));
  await evaluate("if (document.querySelector('.drake-panel')?.hidden) document.querySelector('.drake-launcher').click(); true");

  // CF-05 & CF-07: Category discovery ("I want to buy snowboards" searches, does not add to cart)
  await submit('I want to buy snowboards');
  try {
    await waitFor(() => evaluate("document.querySelector('.drake-conversation').innerText.includes('Complete Snowboard')"));
  } catch (error) {
    throw new Error(`${error.message}: ${await evaluate("document.body.innerText")}`);
  }
  await waitFor(() => evaluate("document.querySelectorAll('.drake-card').length === 3"));
  check(await evaluate("document.querySelectorAll('.drake-card').length"), 3, 'category discovery search cards');
  check(await evaluate("location.pathname"), '/search', 'explicit discovery uses native search page');
  check(await evaluate("document.querySelector('#product-grid').innerText.startsWith('Multi-managed Snowboard')"), true, 'native product grid is visible');
  check(await evaluate("document.querySelector('.drake-card__title').innerText.includes('Multi-managed Snowboard')"), true, 'Drake order follows rendered grid rather than predictive suggestions');
  cart = await evaluate("fetch('/cart.js').then(r=>r.json())");
  check(cart.items.length, 0, 'category discovery does not mutate cart');

  await submit('Find snowboard');
  try {
    await waitFor(() => evaluate("document.querySelector('.drake-conversation').innerText.includes('Complete Snowboard')"));
  } catch (error) {
    throw new Error(`${error.message}: ${await evaluate("document.body.innerText")}`);
  }
  await waitFor(() => evaluate("document.querySelectorAll('.drake-card').length === 3"));
  check(await evaluate("document.querySelectorAll('.drake-card').length"), 3, 'search result cards');
  check(await evaluate("[...document.querySelectorAll('.drake-card__variant')].some(n=>n.innerText.includes('699.95 USD'))"), true, 'decimal prices');
  await submit('Open the second item from your search', null);
  await waitFor(() => evaluate("location.pathname === '/products/complete-snowboard'"));
  check(await evaluate("location.pathname"), '/products/complete-snowboard', 'second reference follows rendered native order');
  await cdp('Runtime.evaluate', { expression: 'history.back(); true' });
  await waitFor(() => evaluate("location.pathname === '/search' && Boolean(window.IShopDrake?.client) && Boolean(window.IShopDrake?.currentNativeSearch)"));
  await evaluate("if (document.querySelector('.drake-panel')?.hidden) document.querySelector('.drake-launcher').click(); true");
  await cdp('Page.navigate', { url: 'http://127.0.0.1:8765/search?q=snowboard&type=product&sort_by=price-descending' });
  await waitFor(() => evaluate("location.pathname === '/search' && Boolean(window.IShopDrake?.currentNativeSearch)"));
  await evaluate("document.querySelector('.drake-launcher').click(); true");
  await submit('Open the first item from these results', null);
  await waitFor(() => evaluate("location.pathname === '/products/multi-location-snowboard'"));
  check(await evaluate("location.pathname"), '/products/multi-location-snowboard', 'manual native sort refreshes positional references');
  await cdp('Page.navigate', { url: 'http://127.0.0.1:8765/search?q=snowboard&type=product&sort_by=price-ascending' });
  await waitFor(() => evaluate("location.pathname === '/search' && Boolean(window.IShopDrake?.client) && Boolean(window.IShopDrake?.currentNativeSearch)"));
  await evaluate("document.querySelector('.drake-launcher').click(); true");

  runtime.kill();
  await new Promise((resolveExit) => runtime.once('exit', resolveExit));
  runtime = spawnRuntime();
  await waitFor(async () => (await fetch('http://127.0.0.1:8765/')).ok);
  await submit('Which is cheapest in your search?');
  await waitFor(() => evaluate("Boolean(document.querySelector('.drake-card__title'))"));
  const cardTitle = await evaluate("document.querySelector('.drake-card__title')?.innerText");
  check(cardTitle.includes('Multi-managed Snowboard'), true, 'result context restored after runtime restart');

  check(await evaluate("document.querySelector('.drake-conversation').innerText.includes('Find snowboard')"), true, 'visible history survives runtime reconnect');
  await submit('Which is closest to $700?', 'clarifying');
  check(await evaluate("document.querySelector('.drake-conversation').innerText.includes('maximum budget')"), true, 'nearest-price request asks for a native-search-compatible bound');

  await submit('Browse the store collections');
  check(await evaluate("document.querySelector('.drake-conversation').innerText.includes('Snowboards')"), true, 'collection browse');
  await submit('Describe the Complete Snowboard');
  check(await evaluate("document.querySelector('.drake-conversation').innerText.includes('available in Color')"), true, 'product details');

  await submit('Add the Complete Snowboard to my cart', 'clarifying');
  check(await evaluate("document.querySelector('.drake-conversation').innerText.includes('Ice')"), true, 'variant clarification');
  await submit('Ice', 'completed');
  cart = await evaluate("fetch('/cart.js').then(r=>r.json())");
  check(cart.items.length, 1, 'one cart line after clarified add');
  check(String(cart.items[0].variant_id), '101', 'clarified exact variant');
  check(cart.items[0].quantity, 1, 'initial quantity');
  check(await evaluate("document.querySelector('#cart-icon-bubble .cart-count-bubble span[aria-hidden=true]').textContent"), '1', 'theme cart badge refreshes without reload');

  await submit('Add two Ice Complete Snowboard to my cart', 'completed');
  cart = await evaluate("fetch('/cart.js').then(r=>r.json())");
  check(cart.items[0].quantity, 3, 'increment quantity');
  check(await evaluate("document.querySelector('#cart-icon-bubble .cart-count-bubble span[aria-hidden=true]').textContent"), '3', 'theme cart badge reflects quantity increment');
  await submit('Set quantity to 2 for the Ice Complete Snowboard', 'completed');
  cart = await evaluate("fetch('/cart.js').then(r=>r.json())");
  check(cart.items[0].quantity, 2, 'absolute quantity');
  await submit('Show cart', null);
  await waitFor(() => evaluate("document.querySelector('cart-drawer').getAttribute('aria-hidden') === 'false'"));
  check(await evaluate("document.querySelector('cart-drawer').getAttribute('aria-hidden')"), 'false', 'show cart opens the theme drawer');
  check(await evaluate("document.querySelector('.drake-conversation').innerText.includes('2 items')"), true, 'authoritative cart read');
  check(await evaluate("document.querySelector('.drake-conversation').innerText.includes('Complete Snowboard (Ice), quantity 2, 699.95 USD each, 1399.90 USD line total')"), true, 'cart detail observation survives widget, transport, and controller');
  await submit('Remove the Ice Complete Snowboard from my cart', 'completed');
  cart = await evaluate("fetch('/cart.js').then(r=>r.json())");
  check(cart.items.length, 0, 'line removal');
  check(await evaluate("document.querySelector('#cart-icon-bubble .cart-count-bubble')"), null, 'empty cart removes theme badge');

  await submit('Add the Complete Snowboard to my cart', 'clarifying');
  await submit('Cancel that');
  await submit('Ice');
  cart = await evaluate("fetch('/cart.js').then(r=>r.json())");
  check(cart.items.length, 0, 'cancelled clarification cannot revive mutation');

  await submit('Add one Ice Complete Snowboard to my cart', 'completed');
  await submit('Empty my entire cart', 'completed');
  cart = await evaluate("fetch('/cart.js').then(r=>r.json())");
  check(cart.items.length, 0, 'explicit whole-cart clear');

  await submit('Preview the Ice Complete Snowboard', null);
  await waitFor(() => evaluate("location.pathname === '/products/complete-snowboard' && location.search === '?variant=101'"));
  await waitFor(() => evaluate("document.querySelector('#ishop-drake-root')?.dataset.bootstrapState === 'ready'"));
  await waitFor(() => evaluate("Boolean(window.IShopDrake?.client && document.querySelector('.drake-conversation')?.innerText.includes('Preview the Ice Complete Snowboard'))"));
  check(await evaluate("document.querySelector('.drake-conversation').innerText.includes('Preview the Ice Complete Snowboard')"), true, 'bounded recent conversation restored after navigation document');
  check(await evaluate("window.IShopDrake.pageContext.previous_path.startsWith('/search?')"), true, 'native search page recorded as previous page');
  await waitFor(() => evaluate("Boolean(window.IShopDrake?.client && window.IShopDrake?.bridge)"));
  await evaluate("document.querySelector('.drake-launcher').click(); true");
  await submit('Add this product to my cart', 'clarifying');
  await submit('Ice', 'completed');
  cart = await evaluate("fetch('/cart.js').then(r=>r.json())");
  check(String(cart.items[0].variant_id), '101', 'current-page reference add');

  // Plus integration: model/catalogue boundary is synthetic, all widget, transport,
  // orchestration, approval and verified Ajax cart execution are production code.
  await evaluate(`(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32;
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    await window.IShopDrake.selectImage(new File([blob], 'reference.png', {type: 'image/png'}));
    return true;
  })()`);
  await submit('Find this in Ice');
  await waitFor(() => evaluate("window.IShopDrake.visionReady && document.querySelectorAll('.drake-card').length === 1"));
  check(await evaluate("window.IShopDrake.candidates.products[0].variants.length"), 1, 'Vision exposes only matching variants');
  check(await evaluate("window.IShopDrake.candidates.products[0].variants[0].variant_id"), '101', 'Vision option grounded to actual fixture variant');
  check((await evaluate("fetch('/cart.js').then(r=>r.json())")).items[0].quantity, 1, 'Vision discovery does not add items');

  check(await evaluate("Array.from(document.querySelectorAll('.drake-features button')).some(b => b.textContent === 'Missions')"), false, 'no manual Missions mode button');
  check(await evaluate("getComputedStyle(document.querySelector('.drake-card__title')).color"), 'rgb(241, 242, 255)', 'product heading readable in dark theme');
  check(await evaluate("Array.from(document.querySelector('.drake-conversation').children).indexOf(document.querySelector('.drake-cards')) > Array.from(document.querySelector('.drake-conversation').children).findIndex(e => e.textContent === 'Find this in Ice')"), true, 'recommendations follow their originating request');
  await submit('Show all colors');
  await waitFor(() => evaluate("!window.IShopDrake.plusBusy && document.querySelector('.drake-variant-select')?.options.length === 3"));
  await evaluate("document.querySelector('.drake-card__choose').click(); true");
  check(await evaluate("document.querySelector('.drake-card__prepare').disabled"), true, 'multi-variant recommendation requires an explicit option');
  check(await evaluate("document.querySelector('.drake-text-input').value"), '', 'choosing a product does not submit a bare title');
  await evaluate("(() => { const select = document.querySelector('.drake-variant-select'); select.value = '102'; select.dispatchEvent(new Event('change')); document.querySelector('.drake-quantity-input').value = '2'; document.querySelector('.drake-card__prepare').click(); return true; })()");
  await waitFor(() => evaluate("Boolean(window.IShopDrake.missionProposal) && !window.IShopDrake.plusBusy"));
  check(await evaluate("window.IShopDrake.missionProposal.items[0].variant_id"), '102', 'Dawn variant identity preserved into proposal');
  check(await evaluate("window.IShopDrake.missionProposal.items[0].quantity"), 2, 'selected quantity preserved into proposal');
  check((await evaluate("fetch('/cart.js').then(r=>r.json())")).items.length, 1, 'reviewing selection performs no cart write');
  await evaluate("window.IShopDrake.approveMissionButton.click(); true");
  await waitFor(() => evaluate("!window.IShopDrake.plusBusy && !window.IShopDrake.plusMissionExecuting && !window.IShopDrake.missionProposal"));
  cart = await evaluate("fetch('/cart.js').then(r=>r.json())");
  check(cart.items.find(i=>String(i.variant_id)==='102').quantity, 2, 'approved exact variant and quantity verified');
  check(cart.items.find(i=>String(i.variant_id)==='101').quantity, 1, 'preexisting Ice line preserved');
  await evaluate("(async () => { const cart = await fetch('/cart.js').then(r=>r.json()); const line = cart.items.find(i=>String(i.variant_id)==='102'); return fetch('/cart/change.js', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:line.key, quantity:0})}).then(r=>r.json()); })()");
  await evaluate("document.querySelector('.drake-card__open').click(); true");
  await waitFor(() => evaluate("location.pathname === '/products/complete-snowboard' && location.search === '?variant=102'"));
  await waitFor(() => evaluate("Boolean(window.IShopDrake?.client && window.IShopDrake?.bridge)"));
  await evaluate("document.querySelector('.drake-launcher').click(); true");
  await submit('Build a three-board basket under 2500 USD');
  await waitFor(() => evaluate("Boolean(window.IShopDrake.missionProposal)"));
  check(await evaluate("window.IShopDrake.missionProposal.agents.length"), 3, 'three separately scoped research calls reach proposal');
  await evaluate("window.IShopDrake.rejectMissionButton.click(); true");
  await waitFor(() => evaluate("!window.IShopDrake.plusBusy && !window.IShopDrake.missionProposal"));
  check((await evaluate("fetch('/cart.js').then(r=>r.json())")).items[0].quantity, 1, 'rejected mission performs zero writes');

  // A committed transcript uses exactly the same mission route as typed input.
  await evaluate("window.IShopDrake.handleVoiceEvent({type:'final_transcript', text:'Find three boards under 2500 USD'}); true");
  await waitFor(() => evaluate("Boolean(window.IShopDrake.missionProposal) && !window.IShopDrake.plusBusy"));
  await evaluate("window.IShopDrake.approveMissionButton.click(); true");
  await waitFor(() => evaluate("!window.IShopDrake.plusBusy && !window.IShopDrake.plusMissionExecuting && !window.IShopDrake.missionProposal"));
  cart = await evaluate("fetch('/cart.js').then(r=>r.json())");
  check(cart.items.length, 3, 'approved mission adds all three verified lines');
  check(cart.items.find(item => String(item.variant_id) === '101').quantity, 2, 'mission preserves preexisting quantity and adds approved delta');
  check(cart.items.find(item => String(item.variant_id) === '201').quantity, 1, 'mission second serial update verified');
  check(cart.items.find(item => String(item.variant_id) === '301').quantity, 1, 'mission third serial update verified');

  await submit('What is your return policy?', 'failed');
  check(await evaluate("document.querySelector('.drake-conversation').innerText.includes('safely choose') || document.querySelector('.drake-conversation').innerText.includes('unavailable')"), true, 'policy capability unavailable is honest');
  check(await evaluate("document.querySelector('.drake-error').innerText"), '', 'spoken failure is not duplicated in the error panel');

  await submit('Show my order history', null);
  await waitFor(() => evaluate("location.pathname === '/account'"));
  check(await evaluate("location.pathname"), '/account', 'trusted order history handoff');
  await cdp('Page.navigate', { url: 'http://127.0.0.1:8765/' });
  await waitFor(() => evaluate("document.querySelector('#ishop-drake-root')?.dataset.bootstrapState === 'ready'"));
  await waitFor(() => evaluate("Boolean(window.IShopDrake?.client && window.IShopDrake?.bridge)"));
  await evaluate("document.querySelector('.drake-launcher').click(); true");
  await submit('Take me to checkout', null);
  await waitFor(() => evaluate("location.pathname === '/checkout'"));
  check(await evaluate("document.body.innerText.includes('no payment capability')"), true, 'checkout handoff stops before payment');

  console.log(JSON.stringify({ tests: assertions, passed: assertions, browser: 'chrome-headless', runtime: 'actual-fastapi-controller', shopify_boundary: 'strict-synthetic' }));
} finally {
  try { socket?.close(); } catch {}
  runtime.kill();
  browser.kill();
  await delay(200);
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = fileURLToPath(new URL('.', import.meta.url));
const source = readFileSync(join(here, '..', '..', '..', 'apps', 'shopify', 'extensions', 'drake', 'assets', 'drake-voice.js'), 'utf8');
const widgetSource = readFileSync(join(here, '..', '..', '..', 'apps', 'shopify', 'extensions', 'drake', 'assets', 'drake-widget.js'), 'utf8');

function loadVoice(AudioOverride = null) {
  const window = {};
  class FakeAudio {
    constructor(src) {
      this.src = src;
      this.onended = null;
      this.onerror = null;
    }
    play() { return Promise.resolve(); }
    pause() {}
  }
  const MockURL = function (url, base) { return new URL(url, base); };
  MockURL.createObjectURL = () => 'blob:mock';
  MockURL.revokeObjectURL = () => {};
  vm.runInNewContext(source, {
    window,
    document: { getElementById: () => null },
    URL: MockURL,
    Blob,
    Audio: AudioOverride || FakeAudio,
    AudioBuffer: undefined,
  });
  return window.IShopVoiceSession;
}

function loadWidgetState(customDoc, customWindow = {}, customLocation = null, customMutationObserver = undefined) {
  const window = customWindow;
  const mockStorage = {
    _data: {},
    getItem: (k) => mockStorage._data[k] || null,
    setItem: (k, v) => { mockStorage._data[k] = String(v); },
    removeItem: (k) => { delete mockStorage._data[k]; },
  };
  const doc = customDoc || { getElementById: () => null };
  vm.runInNewContext(widgetSource, {
    window,
    document: doc,
    crypto,
    sessionStorage: mockStorage,
    location: customLocation || { host: 'shop.myshopify.com', pathname: '/', search: '' },
    MutationObserver: customMutationObserver,
    setTimeout,
    clearTimeout,
    URL,
    console,
  });
  return window.IShopDrakeWidget;
}

test('incremental page scrolling supports continue and stop without an LLM turn', () => {
  const calls = [];
  const browserWindow = {
    innerHeight: 1000, scrollY: 480, scrollX: 0,
    scrollBy: (options) => calls.push(['by', options]),
    scrollTo: (options) => calls.push(['to', options]),
  };
  const { DrakeWidget } = loadWidgetState({ getElementById: () => null }, browserWindow);
  const messages = [];
  const widget = {
    lastScrollDirection: null,
    addMessage: (_role, text) => messages.push(text),
    setState() {},
    navigateSearchPage: () => false,
  };
  assert.equal(DrakeWidget.prototype.handleBrowserControl.call(widget, 'scroll down'), true);
  assert.equal(calls[0][1].top, 400);
  assert.equal(DrakeWidget.prototype.handleBrowserControl.call(widget, 'continue'), true);
  assert.equal(calls[1][1].top, 400);
  assert.equal(DrakeWidget.prototype.handleBrowserControl.call(widget, 'stop'), true);
  assert.equal(calls[2][0], 'to');
  assert.equal(widget.lastScrollDirection, null);
  assert.match(messages.at(-1), /stopped scrolling/i);
});

test('empty final transcripts never create or submit a shopping turn', () => {
  const { DrakeWidget } = loadWidgetState({ getElementById: () => null });
  let submitted = 0;
  let rendered = 0;
  let state = '';
  const widget = {
    caption: { textContent: 'listening' },
    setState: (value) => { state = value; },
    addMessage: () => { rendered += 1; },
    submitShoppingRequest: () => { submitted += 1; },
  };

  DrakeWidget.prototype.handleVoiceEvent.call(widget, { type: 'final_transcript', text: '   ' });

  assert.equal(submitted, 0);
  assert.equal(rendered, 0);
  assert.equal(widget.caption.textContent, '');
  assert.equal(state, 'ready');
});

test('search pagination follows only same-origin Shopify search links', () => {
  let assigned = '';
  const locationRef = {
    host: 'shop.myshopify.com', origin: 'https://shop.myshopify.com', pathname: '/search', search: '?q=board',
    assign: (url) => { assigned = url; },
  };
  const link = { href: 'https://shop.myshopify.com/search?q=board&page=2' };
  const doc = { getElementById: () => null, querySelector: (selector) => selector === 'a[rel="next"]' ? link : null };
  const { DrakeWidget } = loadWidgetState(doc, {}, locationRef);
  const widget = { addMessage() {}, navigationInProgress: false };
  assert.equal(DrakeWidget.prototype.navigateSearchPage.call(widget, 'next'), true);
  assert.equal(assigned, link.href);
  assert.equal(widget.navigationInProgress, true);
  link.href = 'https://evil.test/search?q=board&page=3';
  assigned = '';
  assert.equal(DrakeWidget.prototype.navigateSearchPage.call(widget, 'next'), false);
  assert.equal(assigned, '');
});

test('infinite-scroll grid mutations refresh the displayed result snapshot', async () => {
  let callback = null;
  let observed = null;
  class FakeMutationObserver {
    constructor(handler) { callback = handler; }
    observe(target, options) { observed = { target, options }; }
    disconnect() {}
  }
  const grid = {};
  const doc = { getElementById: () => null, querySelector: () => grid };
  const locationRef = { host: 'shop.myshopify.com', origin: 'https://shop.myshopify.com', pathname: '/search', search: '?q=board' };
  const { DrakeWidget } = loadWidgetState(doc, {}, locationRef, FakeMutationObserver);
  let refreshes = 0;
  const widget = {
    nativeSearchObserver: null, nativeSearchRefreshTimer: null,
    refreshCurrentNativeSearch: () => { refreshes += 1; },
  };
  DrakeWidget.prototype.observeNativeSearchChanges.call(widget);
  assert.equal(observed.target, grid);
  assert.equal(observed.options.childList, true);
  assert.equal(observed.options.subtree, true);
  callback();
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(refreshes, 1);
});

test('voice widget exposes provider-neutral session and PCM utilities', () => {
  const voice = loadVoice();
  assert.equal(typeof voice.VoiceSessionClient, 'function');
  assert.equal(typeof voice.PcmCapture, 'function');
  assert.equal(typeof voice.AudioPlayback, 'function');
  const pcm = new Int16Array(512);
  const converted = voice.floatToPcm16(new Float32Array(512).fill(0.5));
  assert.equal(converted.byteLength, pcm.byteLength);
  assert.equal(new Int16Array(converted)[0], 16383);
  const wav = voice.pcm16ToWav(new Uint8Array([1, 0, 2, 0]).buffer, 16000, 1);
  assert.equal(new TextDecoder().decode(new Uint8Array(wav, 0, 4)), 'RIFF');
  assert.equal(new DataView(wav).getUint32(24, true), 16000);
  assert.equal(new DataView(wav).getUint32(40, true), 4);
  assert.throws(() => voice.pcm16ToWav(new Uint8Array([1]).buffer), /unaligned_pcm_frame/);
  assert.equal(
    voice.buildVoiceWebSocketUrl('wss://runtime.example/ws', 'shop.myshopify.com'),
    'wss://runtime.example/ws/voice/shop.myshopify.com',
  );
  assert.throws(
    () => voice.buildVoiceWebSocketUrl('ws://runtime.example/ws', 'shop.myshopify.com'),
    /voice_url_requires_tls/,
  );
});

test('microphone capture emits provider-sized PCM chunks', () => {
  const voice = loadVoice();
  const chunks = [];
  const capture = new voice.PcmCapture({ onChunk: (chunk) => chunks.push(chunk), chunkBytes: 1024 });
  capture._buffer(new Uint8Array(256).buffer);
  capture._buffer(new Uint8Array(768).buffer);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].byteLength, 1024);

  capture._buffer(new Uint8Array(256).buffer);
  capture.stop(true);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[1].byteLength, 1024);
});

test('continuous voice detector starts after sustained speech and ends after trailing silence', () => {
  const { VoiceActivityDetector } = loadVoice();
  const detector = new VoiceActivityDetector({ sampleRate: 1000, minimumSpeechMs: 200, trailingSilenceMs: 300 });
  const speech = new Float32Array(100).fill(0.1);
  const silence = new Float32Array(100);
  assert.equal(detector.process(speech).started, false);
  assert.equal(detector.process(speech).started, true);
  assert.equal(detector.process(silence).ended, false);
  assert.equal(detector.process(silence).ended, false);
  assert.equal(detector.process(silence).ended, true);
});

test('voice widget sends authenticated turns and suppresses duplicate finals', async () => {
  const voice = loadVoice();
  const sockets = [];
  class FakeWebSocket {
    constructor() {
      this.readyState = 0;
      this.sent = [];
      sockets.push(this);
      queueMicrotask(() => { this.readyState = 1; this.onopen(); });
    }
    send(value) { this.sent.push(value); }
    close() { this.readyState = 3; if (this.onclose) this.onclose(); }
  }
  const events = [];
  const client = new voice.VoiceSessionClient({
    url: 'wss://runtime.example/ws/voice/shop.myshopify.com',
    grant: { grant_id: 'grant_1' },
    WebSocket: FakeWebSocket,
    onEvent: (event) => events.push(event),
  });
  await client.startTurn({ revision: 1 });
  client.sendAudio(new Uint8Array(1024));
  client.finishTurn();
  const socket = sockets[0];
  socket.onmessage({ data: JSON.stringify({ type: 'partial_transcript', revision: 1, text: 'add medium' }) });
  socket.onmessage({ data: JSON.stringify({ type: 'final_transcript', revision: 1, text: 'add large' }) });
  socket.onmessage({ data: JSON.stringify({ type: 'final_transcript', revision: 1, text: 'add large' }) });
  assert.deepEqual(JSON.parse(socket.sent[0]), { type: 'authenticate', grant: { grant_id: 'grant_1' } });
  assert.deepEqual(JSON.parse(socket.sent[1]).type, 'start_turn');
  assert.deepEqual(JSON.parse(socket.sent[3]), { type: 'finish_turn' });
  assert.equal(events.filter((event) => event.type === 'final_transcript').length, 1);
  assert.equal(events[0].authorizes_interpretation, undefined);
});

test('voice client rejects an incompatible runtime before sending shopping work', () => {
  const voice = loadVoice();
  const events = [];
  const client = new voice.VoiceSessionClient({ url: 'wss://runtime.example/ws', grant: {}, onEvent: (event) => events.push(event) });
  let closed = false;
  client.socket = { close: () => { closed = true; }, readyState: 1 };
  client._receive(JSON.stringify({ type: 'authenticated', protocol_version: '0.9.0', command_schema_version: '1.0.0', tool_registry_version: '1.0.0' }));
  assert.equal(closed, true);
  assert.equal(events[0].error_code, 'incompatible_runtime');
});

test('widget state distinguishes listening, interpretation, failure, and verified completion', () => {
  const { WidgetState } = loadWidgetState();
  const state = new WidgetState();
  assert.equal(state.transition('listening').label, 'Listening');
  state.setPartial('add medium');
  assert.equal(state.snapshot().partial, 'add medium');
  assert.equal(state.acceptFinal('add large').name, 'interpreting');
  assert.equal(state.transition('failed', { error: 'Try again' }).error, 'Try again');
  assert.throws(() => state.transition('completed'), /verified_receipt_required/);
  assert.equal(
    state.transition('completed', { verifiedReceipt: { command_id: 'command_1' } }).name,
    'completed',
  );
  assert.equal(state.transition('failed', { suppressError: true, error: 'Already shown in chat' }).error, '');
});

test('candidate references remain stable and reject unknown ordinals', () => {
  const { CandidateSet } = loadWidgetState();
  const candidates = new CandidateSet([
    { product_id: 'p1', title: 'Black Shirt' },
    { product_id: 'p2', title: 'Blue Shirt' },
  ]);
  assert.equal(candidates.resolve(2).product_id, 'p2');
  assert.throws(() => candidates.resolve(3), /candidate_index_unavailable/);
});

test('cart failures are translated into shopper-facing language', () => {
  const { shopperError } = loadWidgetState();
  const stale = shopperError('Cart changed before dispatch; refresh required (S-09)');
  assert.equal(stale, 'Your cart changed before I could update it, so I made no new change. Please try again.');
  assert.doesNotMatch(stale, /dispatch|S-09/i);
  assert.doesNotMatch(shopperError('Dispatch failed with potential write uncertainty'), /dispatch/i);
});

test('widget renders untrusted shopper and store text without HTML insertion', () => {
  assert.equal(widgetSource.includes('.innerHTML'), false);
  assert.equal(widgetSource.includes('.insertAdjacentHTML'), false);
  assert.match(widgetSource, /node\.textContent = text/);
  assert.match(widgetSource, /aria-live/);
  assert.match(widgetSource, /Microphone access failed\. Type your request instead\./);
  assert.match(widgetSource, /shopping_runtime_failed/);
  assert.match(widgetSource, /shopping service failed while processing/);
  assert.match(widgetSource, /Start conversation/);
  assert.match(widgetSource, /End conversation/);
  assert.match(widgetSource, /Correct transcript/);
  assert.match(widgetSource, /selected Pidgin voice could not start/);
  assert.doesNotMatch(widgetSource, /event\.selected_tool \|\| "search_catalog"/);
  assert.match(widgetSource, /Here are the store’s search results/);
  assert.match(widgetSource, /offerConversationResume/);
});

test('widget uses decision-first ingress before collecting store context', () => {
  assert.match(widgetSource, /context_phase:\s*includeStoreContext \? "action" : "decision"/);
  assert.match(widgetSource, /event\.status === "context_required"/);
  const contextGate = widgetSource.indexOf('if (includeStoreContext) {');
  const cartRead = widgetSource.indexOf('await this.bridge.readAuthoritativeCart()', contextGate);
  assert.ok(contextGate >= 0 && cartRead > contextGate);
});

test('audio playback interrupts previous generation and rejects obsolete chunks', () => {
  const voice = loadVoice();
  const playback = new voice.AudioPlayback();
  assert.equal(playback.generation, 0);

  const chunk1 = { generation: 0, audio: new Uint8Array(16).buffer, format: 'wav' };
  assert.equal(playback.enqueue(chunk1), true);

  playback.interrupt();
  assert.equal(playback.generation, 1);
  assert.equal(playback.queue.length, 0);

  const staleChunk = { generation: 0, audio: new Uint8Array(16).buffer, format: 'wav' };
  assert.equal(playback.enqueue(staleChunk), false);

  const freshChunk = { generation: 1, audio: new Uint8Array(16).buffer, format: 'wav' };
  assert.equal(playback.enqueue(freshChunk), true);
});

test('blocked audio can be replayed and obsolete callbacks cannot disrupt a newer reply', async () => {
  const audios = [];
  let blocked = true;
  class Audio {
    constructor(src) { this.src = src; audios.push(this); }
    pause() {}
    play() { return blocked ? Promise.reject({ name: 'NotAllowedError' }) : Promise.resolve(); }
  }
  const statuses = [];
  const playback = new (loadVoice(Audio).AudioPlayback)({ onStatus: (status) => statuses.push(status) });
  playback.enqueue({ generation: 0, audio: new ArrayBuffer(16), format: 'wav' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(statuses.at(-1), 'blocked');
  assert.equal(playback.queue.length, 1);
  blocked = false;
  playback.retry();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(statuses.at(-1), 'speaking');
  const obsoleteEnd = audios.at(-1).onended;
  playback.interrupt();
  playback.enqueue({ generation: 1, audio: new ArrayBuffer(16), format: 'wav' });
  const current = playback.active;
  obsoleteEnd();
  assert.equal(playback.active, current);
});

test('voice client drops events with stale revisions and duplicate finals', async () => {
  const voice = loadVoice();
  const events = [];
  class FakeWebSocket {
    constructor() {
      this.readyState = 0;
      this.sent = [];
      queueMicrotask(() => { this.readyState = 1; if (this.onopen) this.onopen(); });
    }
    send(data) { this.sent.push(data); }
    close() { this.readyState = 3; if (this.onclose) this.onclose(); }
  }
  const client = new voice.VoiceSessionClient({
    url: 'wss://runtime.example/ws/voice/shop.myshopify.com',
    grant: { grant_id: 'grant_1' },
    WebSocket: FakeWebSocket,
    onEvent: (event) => events.push(event),
  });

  await client.startTurn({ revision: 2 });
  // Event from revision 1 (stale) must be dropped
  client._receive(JSON.stringify({ type: 'partial_transcript', revision: 1, text: 'old turn' }));
  assert.equal(events.length, 0);

  // Event from revision 2 (current) must be accepted
  client._receive(JSON.stringify({ type: 'partial_transcript', revision: 2, text: 'current turn' }));
  assert.equal(events.length, 1);
  assert.equal(events[0].text, 'current turn');

  // First final for revision 2 accepted
  client._receive(JSON.stringify({ type: 'final_transcript', revision: 2, text: 'final text' }));
  assert.equal(events.filter((e) => e.type === 'final_transcript').length, 1);

  // Duplicate final for revision 2 dropped
  client._receive(JSON.stringify({ type: 'final_transcript', revision: 2, text: 'duplicate final' }));
  assert.equal(events.filter((e) => e.type === 'final_transcript').length, 1);
});

test('voice client cancelTurn sends cancellation and notifies event handler', async () => {
  const voice = loadVoice();
  const events = [];
  let sentData = [];
  class FakeWebSocket {
    constructor() {
      this.readyState = 0;
      this.sent = sentData;
      queueMicrotask(() => { this.readyState = 1; if (this.onopen) this.onopen(); });
    }
    send(data) { this.sent.push(data); }
    close() { this.readyState = 3; if (this.onclose) this.onclose(); }
  }
  const client = new voice.VoiceSessionClient({
    url: 'wss://runtime.example/ws/voice/shop.myshopify.com',
    grant: { grant_id: 'grant_1' },
    WebSocket: FakeWebSocket,
    onEvent: (event) => events.push(event),
  });

  await client.startTurn({ revision: 3 });
  client.cancelTurn();
  assert.equal(sentData.some((d) => d.includes('cancel_turn')), true);
  assert.equal(events.some((e) => e.type === 'turn_canceled' && e.revision === 3), true);
});

test('integrated widget and voice client submits exactly one shopping turn on duplicate finals', async () => {
  const voice = loadVoice();

  // Mock DOM environment for DrakeWidget
  function makeMockElement(tag, className, text) {
    const el = {
      tagName: tag.toUpperCase(),
      className: className || '',
      textContent: text !== undefined ? String(text) : '',
      hidden: false,
      attributes: {},
      dataset: { shopDomain: 'shop.myshopify.com' },
      children: [],
      classList: {
        add: (c) => { el.className = `${el.className} ${c}`.trim(); },
        remove: (c) => { el.className = el.className.replace(c, '').trim(); },
        contains: (c) => el.className.includes(c),
      },
      setAttribute: (k, v) => { el.attributes[k] = String(v); },
      getAttribute: (k) => el.attributes[k],
      removeAttribute: (k) => { delete el.attributes[k]; },
      append: (...nodes) => { el.children.push(...nodes); },
      appendChild: (node) => { el.children.push(node); return node; },
      replaceChildren: (...nodes) => { el.children = [...nodes]; },
      insertBefore: (node, ref) => {
        const idx = el.children.indexOf(ref);
        if (idx >= 0) el.children.splice(idx, 0, node);
        else el.children.push(node);
        return node;
      },
      addEventListener: (type, handler) => {
        el._listeners = el._listeners || {};
        el._listeners[type] = el._listeners[type] || [];
        el._listeners[type].push(handler);
      },
      querySelector: (selector) => {
        if (selector === 'form') return makeMockElement('form');
        return makeMockElement('div');
      },
      querySelectorAll: () => [],
      focus: () => {},
      value: '',
    };
    return el;
  }

  const mockDoc = { createElement: makeMockElement, getElementById: () => null };
  const { DrakeWidget } = loadWidgetState(mockDoc);

  const sentMessages = [];
  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      queueMicrotask(() => {
        this.readyState = 1;
        if (this.onopen) this.onopen();
      });
    }
    send(data) { sentMessages.push(data); }
    close() { this.readyState = 3; if (this.onclose) this.onclose(); }
  }

  const root = makeMockElement('div', 'ishop-drake-root');
  const client = new voice.VoiceSessionClient({
    url: 'wss://runtime.example/ws/voice/shop.myshopify.com',
    grant: { grant_id: 'grant_1' },
    WebSocket: FakeWebSocket,
  });

  const widget = new DrakeWidget(root, voice);
  widget.setClient(client, {
    bridge: { readAuthoritativeCart: async () => ({ shop_id: 'shop.myshopify.com', currency: 'USD', lines: [] }) },
    catalog: { searchProducts: async () => [] },
  });

  await client.connect();
  await client.startTurn({ revision: 1 });

  // Simulate speech provider emitting duplicate final transcripts over the socket
  client._receive(JSON.stringify({ type: 'final_transcript', revision: 1, text: 'Find snowboard' }));
  client._receive(JSON.stringify({ type: 'final_transcript', revision: 1, text: 'Find snowboard' }));
  client._receive(JSON.stringify({ type: 'final_transcript', revision: 1, text: 'Find snowboard' }));

  // Yield to microtasks for async submitShoppingRequest
  await new Promise((resolve) => setTimeout(resolve, 20));

  // Verify only ONE shopping_turn was transmitted
  const shoppingTurns = sentMessages.filter((m) => {
    try { return JSON.parse(m).type === 'shopping_turn'; } catch (_) { return false; }
  });
  assert.equal(shoppingTurns.length, 1);
  assert.equal(JSON.parse(shoppingTurns[0]).transcript, 'Find snowboard');

  // Verify shopper message was added to history exactly once
  const shopperMessages = widget.messageHistory.filter((m) => m.role === 'shopper');
  assert.equal(shopperMessages.length, 1);
  assert.equal(shopperMessages[0].text, 'Find snowboard');
});

test('microphone denial transitions to failed state and typing text submits cleanly', async () => {
  const voice = loadVoice();

  function makeMockElement(tag, className, text) {
    const el = {
      tagName: tag.toUpperCase(),
      className: className || '',
      textContent: text !== undefined ? String(text) : '',
      hidden: false,
      attributes: {},
      dataset: { shopDomain: 'shop.myshopify.com' },
      children: [],
      classList: {
        add: (c) => { el.className = `${el.className} ${c}`.trim(); },
        remove: (c) => { el.className = el.className.replace(c, '').trim(); },
        contains: (c) => el.className.includes(c),
      },
      setAttribute: (k, v) => { el.attributes[k] = String(v); },
      getAttribute: (k) => el.attributes[k],
      removeAttribute: (k) => { delete el.attributes[k]; },
      append: (...nodes) => { el.children.push(...nodes); },
      appendChild: (node) => { el.children.push(node); return node; },
      replaceChildren: (...nodes) => { el.children = [...nodes]; },
      insertBefore: (node, ref) => {
        const idx = el.children.indexOf(ref);
        if (idx >= 0) el.children.splice(idx, 0, node);
        else el.children.push(node);
        return node;
      },
      addEventListener: (type, handler) => {
        el._listeners = el._listeners || {};
        el._listeners[type] = el._listeners[type] || [];
        el._listeners[type].push(handler);
      },
      querySelector: (selector) => {
        if (selector === 'form') return makeMockElement('form');
        return makeMockElement('div');
      },
      querySelectorAll: () => [],
      focus: () => {},
      value: '',
    };
    return el;
  }

  const mockDoc = { createElement: makeMockElement, getElementById: () => null };
  const { DrakeWidget } = loadWidgetState(mockDoc);

  const sentMessages = [];
  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      queueMicrotask(() => { this.readyState = 1; if (this.onopen) this.onopen(); });
    }
    send(data) { sentMessages.push(data); }
    close() { this.readyState = 3; if (this.onclose) this.onclose(); }
  }

  const root = makeMockElement('div', 'ishop-drake-root');
  const failingVoice = {
    ...voice,
    PcmCapture: class {
      async start() { throw new Error('NotAllowedError: Permission denied'); }
      stop() {}
    },
  };

  const client = new voice.VoiceSessionClient({
    url: 'wss://runtime.example/ws/voice/shop.myshopify.com',
    grant: { grant_id: 'grant_1' },
    WebSocket: FakeWebSocket,
  });

  const widget = new DrakeWidget(root, failingVoice);
  widget.setClient(client, {
    bridge: { readAuthoritativeCart: async () => ({ shop_id: 'shop.myshopify.com', currency: 'USD', lines: [] }) },
    catalog: { searchProducts: async () => [] },
  });

  await client.connect();

  // Trigger mic start -> fails due to mic permission denial
  await widget.startListening();
  assert.equal(widget.state.name, 'failed');
  assert.match(widget.error.textContent, /Microphone access failed/);
  assert.equal(widget.micButton.hidden, false);
  assert.equal(widget.stopButton.hidden, true);

  // Fallback: Shopper types message instead
  widget.textInput.value = 'Find snowboard';
  await widget.submitText();
  await new Promise((resolve) => setTimeout(resolve, 20));

  const shoppingTurns = sentMessages.filter((m) => {
    try { return JSON.parse(m).type === 'shopping_turn'; } catch (_) { return false; }
  });
  assert.equal(shoppingTurns.length, 1);
  assert.equal(JSON.parse(shoppingTurns[0]).transcript, 'Find snowboard');
  assert.equal(widget.state.name, 'interpreting');
});

test('text delivery and card presentation succeed independent of delayed or failed TTS', async () => {
  const voice = loadVoice();

  function makeMockElement(tag, className, text) {
    const el = {
      tagName: tag.toUpperCase(),
      className: className || '',
      textContent: text !== undefined ? String(text) : '',
      hidden: false,
      attributes: {},
      dataset: { shopDomain: 'shop.myshopify.com' },
      children: [],
      classList: {
        add: (c) => { el.className = `${el.className} ${c}`.trim(); },
        remove: (c) => { el.className = el.className.replace(c, '').trim(); },
        contains: (c) => el.className.includes(c),
      },
      setAttribute: (k, v) => { el.attributes[k] = String(v); },
      getAttribute: (k) => el.attributes[k],
      removeAttribute: (k) => { delete el.attributes[k]; },
      append: (...nodes) => { el.children.push(...nodes); },
      appendChild: (node) => { el.children.push(node); return node; },
      replaceChildren: (...nodes) => { el.children = [...nodes]; },
      insertBefore: (node, ref) => {
        const idx = el.children.indexOf(ref);
        if (idx >= 0) el.children.splice(idx, 0, node);
        else el.children.push(node);
        return node;
      },
      addEventListener: (type, handler) => {
        el._listeners = el._listeners || {};
        el._listeners[type] = el._listeners[type] || [];
        el._listeners[type].push(handler);
      },
      querySelector: (selector) => {
        if (selector === 'form') return makeMockElement('form');
        return makeMockElement('div');
      },
      querySelectorAll: () => [],
      focus: () => {},
      value: '',
    };
    return el;
  }

  const mockDoc = {
    createElement: makeMockElement,
    getElementById: () => null,
    querySelector: (selector) => (selector === 'form' ? makeMockElement('form') : makeMockElement('div')),
    body: makeMockElement('body'),
  };
  const { DrakeWidget } = loadWidgetState(mockDoc);

  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      queueMicrotask(() => { this.readyState = 1; if (this.onopen) this.onopen(); });
    }
    send() {}
    close() { this.readyState = 3; }
  }

  const root = makeMockElement('div', 'ishop-drake-root');
  const client = new voice.VoiceSessionClient({
    url: 'wss://runtime.example/ws/voice/shop.myshopify.com',
    grant: { grant_id: 'grant_1' },
    WebSocket: FakeWebSocket,
  });

  const widget = new DrakeWidget(root, voice);
  widget.setClient(client, {
    bridge: { readAuthoritativeCart: async () => ({ shop_id: 'shop.myshopify.com', currency: 'USD', lines: [] }) },
    catalog: { searchProducts: async () => [{ product_id: '1', title: 'Complete Snowboard', variants: [] }] },
  });
  widget.pendingCatalogProducts = [{ product_id: '1', title: 'Complete Snowboard', variants: [] }];

  await client.connect();

  // Server delivers shopping_result with text and product IDs without any TTS audio
  client._receive(JSON.stringify({
    type: 'shopping_result',
    turn_id: 'turn_1',
    request_revision: 1,
    page_epoch: 1,
    status: 'completed',
    spoken_response: 'Found 1 snowboard matching your search.',
    result_product_ids: ['1'],
  }));

  // Assert text message is rendered immediately
  const assistantMessages = widget.messageHistory.filter((m) => m.role === 'assistant');
  assert.equal(assistantMessages.length, 1);
  assert.equal(assistantMessages[0].text, 'Found 1 snowboard matching your search.');

  // Assert product cards rendered
  assert.equal(widget.candidates.products.length, 1);
  assert.equal(widget.candidates.products[0].title, 'Complete Snowboard');

  // Assert state is ready even without TTS
  assert.equal(widget.state.name, 'ready');
});

function makePlusWidget() {
  function makeNode(tag) {
    const node = {
      tagName: tag.toUpperCase(), children: [], attributes: {}, dataset: { shopDomain: 'shop.myshopify.com' },
      value: '', textContent: '', hidden: false, disabled: false,
      classList: { add() {} },
      setAttribute(key, value) { this.attributes[key] = String(value); },
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      insertBefore(child, ref) { const at = this.children.indexOf(ref); this.children.splice(at < 0 ? this.children.length : at, 0, child); },
      addEventListener() {}, querySelector() { return makeNode('form'); }, focus() {},
    };
    return node;
  }
  const { DrakeWidget } = loadWidgetState({ createElement: makeNode, getElementById: () => null },
    { Shopify: { currency: { active: 'USD' } } },
    { host: 'shop.myshopify.com', origin: 'https://shop.myshopify.com', pathname: '/', search: '' });
  const widget = new DrakeWidget(makeNode('div'), null);
  const requests = [];
  const catalogResults = [];
  const commandResults = [];
  widget.client = {
    revision: 0, connect: async () => {},
    sendPlusRequest: (payload) => requests.push(payload),
    sendPlusCatalogResult: (payload) => catalogResults.push(payload),
    sendCommandResult: (id, result) => commandResults.push({ id, result }),
  };
  return { widget, requests, catalogResults, commandResults };
}

test('plus voice protocol preserves independent proposal revisions and uses authenticated socket', async () => {
  const voice = loadVoice();
  const sent = [];
  const client = new voice.VoiceSessionClient({ url: 'wss://runtime.example/ws', grant: { grant_id: 'grant_1' } });
  client.socket = { readyState: 1, send: (raw) => sent.push(JSON.parse(raw)) };
  client.revision = 30;
  const events = [];
  client.onEvent = (event) => events.push(event);
  client.sendPlusRequest({ feature: 'mission', request_id: 'plus_1' });
  client.sendPlusCatalogResult({ request_id: 'plus_1', results: [] });
  client._receive(JSON.stringify({ type: 'plus_result', request_id: 'plus_1', revision: 1, status: 'approval' }));
  assert.equal(sent[0].type, 'plus_request');
  assert.equal(sent[1].type, 'plus_catalog_result');
  assert.equal(events[0].revision, 1);
});

test('Vision and Missions browser catalog handoffs perform only bounded read searches', async () => {
  const { widget, catalogResults } = makePlusWidget();
  const calls = [];
  const product = { product_id: 'p1', title: 'Keyboard', variants: [] };
  widget.catalog = { search: async (query, limit) => { calls.push({ query, limit }); return { source: 'ajax_product_json', products: [product] }; } };
  widget.plusRequestId = 'plus_active';
  widget.plusMode = 'mission';
  await widget.retrievePlusCatalog({ request_id: 'plus_active', feature: 'mission', queries: [
    { agent_id: 'research_keyboard', query: 'keyboard' }, { agent_id: 'research_mouse', query: 'mouse' },
  ] });
  assert.deepEqual(calls.map((call) => call.query), ['keyboard', 'mouse']);
  assert.ok(calls.every((call) => call.limit === 8));
  assert.equal(catalogResults.length, 1);
  assert.equal(catalogResults[0].results.length, 2);
  assert.equal(catalogResults[0].shop_id, 'shop.myshopify.com');
  assert.equal(catalogResults[0].results[0].products[0].product_id, 'p1');
  assert.equal(widget.pendingReceipts.size, 0);
});

test('mission approval rechecks every product and cart but cannot execute without runtime command', async () => {
  const { widget, requests } = makePlusWidget();
  let reads = 0;
  let writes = 0;
  const handles = [];
  widget.bridge = { readAuthoritativeCart: async () => { reads += 1; return { shop_id: 'shop.myshopify.com', currency: 'USD', lines: [] }; },
    executeCommand: async () => { writes += 1; }, getAvailableTools: async () => ['add_variant'] };
  widget.catalog = { getByHandle: async (handle) => { handles.push(handle); return { product_id: handle, handle, variants: [] }; } };
  widget.missionProposal = { proposal_id: 'proposal_1', revision: 3, items: [{ handle: 'keyboard' }, { handle: 'mouse' }] };
  await widget.submitPlusAction('approve');
  assert.equal(reads, 1);
  assert.equal(writes, 0);
  assert.deepEqual(handles, ['keyboard', 'mouse']);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].proposal_id, 'proposal_1');
  assert.equal(requests[0].revision, 3);
  assert.equal(requests[0].products.length, 2);
  assert.equal(requests[0].shop_id, 'shop.myshopify.com');
  assert.ok(requests[0].observed_at_ms > Date.now() - 5000);
  assert.equal(requests[0].request_revision, 1);
  assert.equal(widget.plusBusy, true);
});

test('rejected mission requires no catalog or cart access and cannot mutate cart', async () => {
  const { widget, requests } = makePlusWidget();
  widget.bridge = { readAuthoritativeCart: () => { throw new Error('must_not_read'); }, executeCommand: () => { throw new Error('must_not_write'); } };
  widget.missionProposal = { proposal_id: 'proposal_reject', revision: 1, items: [] };
  await widget.submitPlusAction('reject');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].feature, 'reject');
  assert.equal(requests[0].current_cart, undefined);
});

test('duplicate approval is blocked while fresh evidence is being collected', async () => {
  const { widget, requests } = makePlusWidget();
  let unblock;
  const waiting = new Promise((resolve) => { unblock = resolve; });
  widget.bridge = { readAuthoritativeCart: async () => { await waiting; return { shop_id: 'shop.myshopify.com', currency: 'USD', lines: [] }; } };
  widget.catalog = { getByHandle: async () => ({ product_id: 'p1', variants: [] }) };
  widget.missionProposal = { proposal_id: 'proposal_once', revision: 1, items: [{ handle: 'keyboard' }] };
  const first = widget.submitPlusAction('approve');
  await widget.submitPlusAction('approve');
  unblock();
  await first;
  assert.equal(requests.length, 1);
});

test('plus events from obsolete requests cannot replace current products or progress', () => {
  const { widget } = makePlusWidget();
  widget.plusRequestId = 'plus_current';
  const before = widget.statusText.textContent;
  widget.handlePlusEvent({ type: 'plus_result', request_id: 'plus_old', status: 'completed', message: 'Obsolete', products: [] });
  widget.handlePlusEvent({ type: 'plus_activity', request_id: 'plus_old', stage: 'cart.updating' });
  assert.equal(widget.messageHistory.length, 0);
  assert.equal(widget.statusText.textContent, before);
});

test('invalid Vision uploads are rejected before reading image bytes', async () => {
  const { widget } = makePlusWidget();
  await widget.selectImage({ type: 'text/html', size: 100, name: 'unsafe.html' });
  assert.equal(widget.selectedImage, null);
  assert.equal(widget.state.name, 'failed');
  await widget.selectImage({ type: 'image/png', size: 5 * 1024 * 1024 });
  assert.equal(widget.selectedImage, null);
});

test('activity and speaking orb states come from workflow and playback events with reduced-motion fallback', () => {
  const { widget } = makePlusWidget();
  widget.plusRequestId = 'plus_current';
  widget.handlePlusEvent({ type: 'plus_activity', request_id: 'plus_current', stage: 'mission.agent.completed', label: 'Researched keyboards: 3 verified options' });
  assert.equal(widget.statusText.textContent, 'Researched keyboards: 3 verified options');
  assert.equal(widget.root.dataset.activity, 'working');
  const css = readFileSync(join(here, '..', '..', '..', 'apps', 'shopify', 'extensions', 'drake', 'assets', 'drake-bootstrap.css'), 'utf8');
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /data-audio-state='speaking'/);
});

test('verified mission acknowledgements alone advance serialized writes, and duplicates do not', () => {
  const { widget } = makePlusWidget();
  const actions = [];
  widget.plusMissionExecuting = true;
  widget.missionProposal = { proposal_id: 'proposal_1', revision: 1 };
  widget.submitPlusAction = (action) => actions.push(action);
  widget.pendingReceipts.set('cmd_1', { result: { outcome: 'verified_success' }, request_revision: 1 });
  widget.handleVoiceEvent({ type: 'command_result_ack', command_id: 'cmd_1', verified: true, request_revision: 1 });
  widget.handleVoiceEvent({ type: 'command_result_ack', command_id: 'cmd_1', verified: true, request_revision: 1 });
  assert.deepEqual(actions, ['continue']);
  widget.pendingReceipts.set('cmd_2', { result: { outcome: 'uncertain', errors: ['could not be verified'] }, request_revision: 2 });
  widget.handleVoiceEvent({ type: 'command_result_ack', command_id: 'cmd_2', verified: false, request_revision: 2 });
  assert.deepEqual(actions, ['continue']);
  assert.equal(widget.plusMissionExecuting, false);
});

test('negative mission instruction stops future additions even during an active request', async () => {
  const { widget } = makePlusWidget();
  widget.plusBusy = true;
  widget.plusMissionExecuting = true;
  widget.missionProposal = { proposal_id: 'proposal_1', revision: 1 };
  const actions = [];
  widget.submitPlusAction = async (action) => actions.push(action);
  await widget.submitPlusRequest("Don't add anything yet");
  assert.deepEqual(actions, ['reject']);
  assert.equal(widget.plusMissionExecuting, false);
});

test('mission budget follow-ups reuse the existing mission specification', async () => {
  const { widget, requests } = makePlusWidget();
  widget.plusMode = 'mission';
  widget.missionReady = true;
  widget.missionProposal = { proposal_id: 'proposal_existing', revision: 1 };
  await widget.submitPlusRequest('Make the budget under 50 dollars');
  assert.equal(requests[0].feature, 'refine');
  assert.equal(widget.missionProposal, null);
  widget.plusBusy = false;
  await widget.submitPlusRequest('New mission: keyboard and mouse under 100 dollars');
  assert.equal(requests[1].feature, 'mission');
});

test('explicit product and cart actions leave Vision refinement routing and keep visible identities', async () => {
  const { widget } = makePlusWidget();
  widget.plusMode = 'vision';
  widget.visionReady = true;
  widget.plusResultsVisible = true;
  widget.candidates.products = [{ product_id: 'p1', title: 'Blue Keyboard' }, { product_id: 'p2', title: 'Black Keyboard' }];
  assert.equal(widget.shouldUsePlus('Open the second one'), false);
  assert.equal(widget.shouldUsePlus('Add this to my cart'), false);
  assert.equal(widget.shouldUsePlus('Only black and under 50 dollars'), true);
  const calls = [];
  widget.submitShoppingRequest = async (...args) => calls.push(args);
  await widget.submitLegacyShoppingRequest('Open the second one');
  assert.match(calls[0][0], /Black Keyboard/);
  assert.equal(calls[0][1].products[1].product_id, 'p2');
  widget.plusMode = 'mission';
  assert.equal(widget.shouldUsePlus('Show my cart'), false);
  assert.equal(widget.plusMode, 'mission');
});

test('transport loss clears busy state and prevents an approved mission from resuming writes', () => {
  const { widget } = makePlusWidget();
  widget.plusBusy = true;
  widget.plusMissionExecuting = true;
  widget.plusRequestId = 'plus_lost';
  widget.missionProposal = { proposal_id: 'proposal_lost', revision: 1 };
  widget.handleVoiceEvent({ type: 'closed' });
  assert.equal(widget.plusBusy, false);
  assert.equal(widget.plusMissionExecuting, false);
  assert.equal(widget.plusRequestId, null);
  assert.equal(widget.missionProposal, null);
  assert.equal(widget.proposalPanel.hidden, true);
  assert.equal(widget.state.name, 'reconnecting');
});


test('spoken basket approval is explicit and qualified replies remain refinements', async () => {
  const { widget, requests } = makePlusWidget();
  widget.plusMode = 'mission';
  widget.missionReady = true;
  widget.missionProposal = { proposal_id: 'current_proposal', revision: 1 };
  const approvals = [];
  widget.submitPlusAction = async (action) => approvals.push(action);
  await widget.submitPlusRequest('Approve this basket');
  assert.deepEqual(approvals, ['approve']);
  await widget.submitPlusRequest('Yes, but make it cheaper');
  assert.deepEqual(approvals, ['approve']);
  assert.equal(requests[0].feature, 'refine');
});

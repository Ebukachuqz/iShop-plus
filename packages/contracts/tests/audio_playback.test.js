import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../../apps/shopify/extensions/drake/assets/drake-voice.js', import.meta.url), 'utf8');
function setup(state = 'running') {
  const nodes = [], buffers = [], statuses = [];
  const context = {
    state, currentTime: 0, destination: {}, resumes: 0,
    resume() { this.resumes++; this.state = 'running'; return Promise.resolve(); },
    createBuffer(channels, frames, rate) {
      const data = Array.from({length:channels}, () => new Float32Array(frames));
      const buffer = {duration:frames/rate, getChannelData:c=>data[c], data};
      buffers.push(buffer); return buffer;
    },
    createBufferSource() {
      const node = {connect(){}, disconnect(){ this.disconnected=true; },
        start(time){ this.time=time; }, stop(){ this.stopped=true; }};
      nodes.push(node); return node;
    },
  };
  const window = {};
  vm.runInNewContext(source, {window, document:{getElementById:()=>null}, setTimeout, clearTimeout});
  const playback = new window.IShopVoiceSession.AudioPlayback({contextFactory:()=>context,onStatus:s=>statuses.push(s)});
  const chunk = (audio = new ArrayBuffer(16000), extra={}) => ({audio, generation:playback.generation,
    format:'pcm',container:'none',sampleRate:16000,channels:1,...extra});
  return {playback,context,nodes,buffers,statuses,chunk};
}

test('PCM chunks share a contiguous timeline and one speaking state until EOF drains', () => {
  const {playback:p,context,nodes,statuses,chunk}=setup();
  p.beginReply('reply1',1);
  p.enqueue(chunk());
  context.currentTime=.1;
  p.enqueue(chunk());
  assert.equal(nodes.length,2);
  assert.equal(nodes[1].time, nodes[0].time+nodes[0].buffer.duration);
  context.currentTime=.56; nodes[0].onended();
  assert.deepEqual(statuses,['speaking']);
  p.complete('reply1',1);
  assert.equal(statuses.at(-1),'speaking');
  context.currentTime=1.06; nodes[1].onended();
  assert.deepEqual(statuses,['speaking','idle']);
});

test('network gaps do not flap speaking state or restart the stream generation', () => {
  const {playback:p,context,nodes,statuses,chunk}=setup();
  p.beginReply('reply',1); p.enqueue(chunk());
  context.currentTime=.56; nodes[0].onended();
  assert.deepEqual(statuses,['speaking']);
  context.currentTime=.8; p.enqueue(chunk());
  assert.equal(p.generation,1);
  assert.deepEqual(statuses,['speaking']);
  p.complete('reply',1); nodes[1].onended();
  assert.equal(statuses.at(-1),'idle');
});

test('odd PCM fragments retain samples across byte boundaries without inserted silence', () => {
  const {playback:p,buffers,chunk,nodes}=setup();
  const bytes=new Uint8Array([0,64,0,192,255,127,0,128]);
  p.beginReply('reply',1);
  p.enqueue(chunk(bytes.slice(0,3).buffer));
  p.enqueue(chunk(bytes.slice(3).buffer));
  p.complete('reply',1);
  assert.deepEqual(buffers.flatMap(b=>Array.from(b.data[0])),[.5,-.5,32767/32768,-1]);
  assert.equal(p.carry.length,0);
  for (const n of nodes) n.onended();
});

test('interruption stops all scheduled nodes and old callbacks/replies cannot resume them', () => {
  const {playback:p,nodes,chunk,statuses}=setup();
  p.beginReply('old',1); p.enqueue(chunk()); p.enqueue(chunk());
  const oldGeneration=p.generation, ended=nodes[0].onended;
  p.interrupt();
  assert.ok(nodes.every(n=>n.stopped && n.disconnected));
  assert.equal(p.enqueue({...chunk(),generation:oldGeneration}),false);
  assert.equal(p.beginReply('old',1),false);
  p.beginReply('new',2); p.enqueue(chunk());
  ended(); p.complete('old',1);
  assert.equal(p.nodes.size,1);
  assert.equal(statuses.at(-1),'speaking');
  p.complete('new',2); nodes.at(-1).onended();
});

test('autoplay block preserves the full queue; a gesture retries exactly once', async () => {
  const {playback:p,context,nodes,statuses,chunk}=setup('suspended');
  p.beginReply('reply',1); p.enqueue(chunk()); p.enqueue(chunk()); p.complete('reply',1);
  assert.equal(context.resumes,0);
  assert.equal(nodes.length,0);
  assert.equal(p.queue.length,2);
  assert.deepEqual(statuses,['blocked']);
  await p.retry();
  assert.equal(context.resumes,1);
  assert.equal(p.queue.length,0); assert.equal(nodes.length,2);
  assert.equal(statuses.at(-1),'speaking');
  nodes[0].onended(); nodes[1].onended();
  assert.equal(statuses.at(-1),'idle');
});

test('late resume resolution after interruption does not resurrect cancelled audio', async () => {
  const {playback:p,context,nodes,chunk}=setup('suspended');
  let resume;
  context.resume=()=>new Promise(resolve=>{resume=resolve;});
  p.beginReply('reply',1); p.enqueue(chunk());
  const pending=p.retry(); p.interrupt();
  context.state='running'; resume(); await pending;
  assert.equal(nodes.length,0); assert.equal(p.queue.length,0);
});

test('resume rejection keeps autoplay recovery available without losing audio', async () => {
  const {playback:p,context,statuses,chunk}=setup('suspended');
  context.resume=()=>Promise.reject(new Error('blocked'));
  p.beginReply('reply',1); p.enqueue(chunk()); await p.retry();
  assert.equal(p.queue.length,1); assert.equal(statuses.at(-1),'blocked');
  context.resume=()=>{context.state='running';return Promise.resolve();};
  await p.retry(); p.complete('reply',1);
  assert.equal(p.queue.length,0);
});

test('incomplete final frame and changed stream format fail safely', () => {
  const {playback:p,statuses,chunk}=setup();
  p.beginReply('reply',1); p.enqueue(chunk(new Uint8Array([1]).buffer)); p.complete('reply',1);
  assert.equal(statuses.at(-1),'unavailable');
  p.beginReply('next',2); p.enqueue(chunk()); p.enqueue(chunk(new ArrayBuffer(16000),{sampleRate:24000}));
  assert.equal(statuses.at(-1),'unavailable'); assert.equal(p.nodes.size,0);
});

test('a short reply flushes the jitter buffer at EOF, without waiting for its timer', () => {
  const {playback:p,nodes,chunk}=setup();
  p.beginReply('short',1);p.enqueue(chunk(new ArrayBuffer(320)));
  assert.equal(nodes.length,0); assert.ok(p.timer);
  p.complete('short',1);
  assert.equal(p.timer,null);assert.equal(nodes.length,1);
  nodes[0].onended();
});

test('new socket resets reply ordering while old completed streams remain closed', () => {
  const {playback:p,chunk}=setup();
  p.beginReply('old',20);p.interrupt();assert.equal(p.beginReply('late',19),false);
  p.resetSession();assert.equal(p.beginReply('new-connection',1),true);
  p.complete('new-connection',1);assert.equal(p.enqueue(chunk()),false);
});


test('mid-reply context suspension resumes existing nodes without replay or duplication', async () => {
  const {playback:p,context,nodes,statuses,chunk}=setup();
  p.beginReply('reply',1);p.enqueue(chunk());p.enqueue(chunk());
  context.state='suspended';context.onstatechange();
  assert.equal(statuses.at(-1),'blocked');
  await p.retry();
  assert.equal(nodes.length,2);assert.equal(p.nodes.size,2);
  assert.equal(statuses.at(-1),'speaking');
  p.complete('reply',1);nodes[0].onended();nodes[1].onended();
  assert.equal(statuses.at(-1),'idle');
});

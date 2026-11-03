(function () {
  "use strict";

  class VoiceSessionClient {
    constructor(options) {
      this.url = options.url;
      this.grant = options.grant;
      this.WebSocket = options.WebSocket || window.WebSocket;
      this.onEvent = options.onEvent || function () {};
      this.socket = null;
      this.revision = 0;
      this.finalRevisions = new Set();
    }

    connect() {
      if (this.socket && this.socket.readyState === 1) return Promise.resolve();
      if (this.connecting) return this.connecting;
      this.connecting = new Promise((resolve, reject) => {
        const socket = new this.WebSocket(this.url);
        this.socket = socket;
        const deadline = setTimeout(() => {
          reject(new Error("voice_transport_timeout"));
          socket.close();
        }, 15000);
        deadline?.unref?.();
        socket.onopen = () => {
          clearTimeout(deadline);
          socket.send(JSON.stringify({ type: "authenticate", grant: this.grant }));
          resolve();
        };
        socket.onmessage = (message) => this._receive(message.data);
        socket.onerror = () => { clearTimeout(deadline); reject(new Error("voice_transport_failed")); };
        socket.onclose = () => {
          clearTimeout(deadline);
          if (this.socket !== socket) return;
          this.socket = null;
          reject(new Error("voice_transport_closed"));
          this.onEvent({ type: "closed", revision: this.revision });
        };
      });
      this.connecting.finally(() => { this.connecting = null; }).catch(() => {});
      return this.connecting;
    }

    async startTurn(options) {
      const nextRevision = options.revision ?? this.revision + 1;
      if (!Number.isInteger(nextRevision) || nextRevision <= this.revision) {
        throw new Error("stale_revision");
      }
      await this.connect();
      this.revision = nextRevision;
      this.finalRevisions.delete(nextRevision);
      this._send({
        type: "start_turn",
        revision: nextRevision,
        language: options.language || "pcm",
        sample_rate: options.sampleRate || 16000,
        channels: options.channels || 1,
      });
      return nextRevision;
    }

    sendAudio(audio) {
      if (!this.socket || this.socket.readyState !== 1) throw new Error("voice_not_connected");
      if (!(audio instanceof ArrayBuffer) && !(ArrayBuffer.isView(audio))) throw new TypeError("audio_must_be_binary");
      const bytes = audio instanceof ArrayBuffer ? new Uint8Array(audio) : new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength);
      if (bytes.byteLength < 1024 || bytes.byteLength > 32768 || bytes.byteLength % 2 !== 0) throw new RangeError("audio_chunk_size");
      this.socket.send(bytes);
    }

    finishTurn() {
      this._send({ type: "finish_turn" });
    }

    sendShoppingTurn(payload) {
      if (!payload || typeof payload !== "object") throw new TypeError("shopping_turn_payload");
      this._send({ type: "shopping_turn", ...payload });
    }

    sendPlusRequest(payload) {
      if (!payload || typeof payload !== "object") throw new TypeError("plus_request_payload");
      this._send({ type: "plus_request", ...payload });
    }

    sendPlusCatalogResult(payload) {
      if (!payload || typeof payload !== "object") throw new TypeError("plus_catalog_result_payload");
      this._send({ type: "plus_catalog_result", ...payload });
    }

    sendCommandResult(commandId, result) {
      if (!commandId || !result || typeof result !== "object") throw new TypeError("command_result_payload");
      this._send({ type: "command_result", command_id: commandId, result });
    }

    cancelTurn() {
      if (this.socket && this.socket.readyState === 1) this._send({ type: "cancel_turn" });
      this.onEvent({ type: "turn_canceled", revision: this.revision });
    }

    close(options) {
      if (!options || options.cancel !== false) this.cancelTurn();
      if (this.socket) this.socket.close();
      this.socket = null;
    }

    _send(message) {
      if (!this.socket || this.socket.readyState !== 1) throw new Error("voice_not_connected");
      this.socket.send(JSON.stringify(message));
    }

    _receive(raw) {
      let event;
      try { event = JSON.parse(raw); } catch (_) { return; }
      // Proposal revisions are independent from voice-turn revisions.
      if (String(event.type || "").startsWith("plus_")) {
        this.onEvent(event);
        return;
      }
      if (event.type === "authenticated" && (event.protocol_version !== "1.0.0" || event.command_schema_version !== "1.0.0" || event.tool_registry_version !== "1.0.0")) {
        this.onEvent({ type: "error", error_code: "incompatible_runtime", revision: this.revision });
        this.close({ cancel: false });
        return;
      }
      const revision = Number(event.request_revision || event.revision || this.revision);
      if (revision < this.revision) return;
      if (event.type === "final_transcript") {
        if (this.finalRevisions.has(revision)) return;
        this.finalRevisions.add(revision);
      }
      this.onEvent({ ...event, revision });
    }
  }

  class PcmCapture {
    constructor(options) {
      this.sampleRate = options.sampleRate || 16000;
      this.channels = options.channels || 1;
      this.onChunk = options.onChunk;
      this.context = null;
      this.stream = null;
      this.source = null;
      this.node = null;
      this.pendingBytes = new Uint8Array(0);
      this.chunkBytes = options.chunkBytes || 4096;
      this.continuous = Boolean(options.continuous);
      this.onSpeechStart = options.onSpeechStart || function () {};
      this.onSpeechEnd = options.onSpeechEnd || function () {};
      this.detector = this.continuous ? new VoiceActivityDetector({ sampleRate: this.sampleRate, ...(options.vad || {}) }) : null;
      this.preRollBytes = Math.round(this.sampleRate * this.channels * 2 * 0.25);
      this.preRoll = new Uint8Array(0);
    }

    async start() {
      this.stopped = false;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("microphone_unavailable");
      if (!window.AudioWorkletNode) throw new Error("audio_worklet_unavailable");
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: this.channels, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (this.stopped) { this.stream.getTracks().forEach(track => track.stop()); this.stream = null; return; }
      this.context = new AudioContext({ sampleRate: this.sampleRate });
      const sourceCode = "class DrakePcmProcessor extends AudioWorkletProcessor { process(inputs) { const input = inputs[0]; if (input && input[0]) this.port.postMessage(input[0]); return true; } } registerProcessor('drake-pcm-processor', DrakePcmProcessor);";
      const sourceUrl = URL.createObjectURL(new Blob([sourceCode], { type: "application/javascript" }));
      try {
        await this.context.audioWorklet.addModule(sourceUrl);
      } finally {
        URL.revokeObjectURL(sourceUrl);
      }
      if (this.stopped) return;
      this.source = this.context.createMediaStreamSource(this.stream);
      this.node = new AudioWorkletNode(this.context, "drake-pcm-processor", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: this.channels });
      this.node.port.onmessage = (event) => this._process(event.data);
      this.source.connect(this.node);
      this.node.connect(this.context.destination);
    }

    _process(samples) {
      const pcm = floatToPcm16(samples);
      if (!this.detector) {
        this._buffer(pcm);
        return;
      }
      const activity = this.detector.process(samples);
      if (!activity.active && !activity.started) {
        this._retainPreRoll(pcm);
        return;
      }
      if (activity.started) {
        this.onSpeechStart();
        if (this.preRoll.byteLength) this._buffer(this.preRoll.buffer);
        this.preRoll = new Uint8Array(0);
      }
      this._buffer(pcm);
      if (activity.ended) {
        this._flush();
        this.onSpeechEnd(activity);
      }
    }

    _retainPreRoll(buffer) {
      const incoming = new Uint8Array(buffer);
      const joined = new Uint8Array(this.preRoll.byteLength + incoming.byteLength);
      joined.set(this.preRoll); joined.set(incoming, this.preRoll.byteLength);
      this.preRoll = joined.slice(Math.max(0, joined.byteLength - this.preRollBytes));
    }

    _buffer(buffer) {
      const incoming = new Uint8Array(buffer);
      const combined = new Uint8Array(this.pendingBytes.byteLength + incoming.byteLength);
      combined.set(this.pendingBytes);
      combined.set(incoming, this.pendingBytes.byteLength);
      let offset = 0;
      while (combined.byteLength - offset >= this.chunkBytes) {
        this.onChunk(combined.slice(offset, offset + this.chunkBytes).buffer);
        offset += this.chunkBytes;
      }
      this.pendingBytes = combined.slice(offset);
    }

    _flush() {
      if (!this.pendingBytes.byteLength) return;
      const finalChunk = new Uint8Array(Math.max(1024, this.pendingBytes.byteLength));
      finalChunk.set(this.pendingBytes);
      this.pendingBytes = new Uint8Array(0);
      this.onChunk(finalChunk.buffer);
    }

    stop(flush = false) {
      this.stopped = true;
      if (flush) this._flush();
      else this.pendingBytes = new Uint8Array(0);
      this.preRoll = new Uint8Array(0);
      if (this.node) this.node.disconnect();
      if (this.source) this.source.disconnect();
      if (this.stream) this.stream.getTracks().forEach((track) => track.stop());
      if (this.context) this.context.close();
      this.node = null;
      this.source = null;
      this.stream = null;
      this.context = null;
    }
  }

  class VoiceActivityDetector {
    constructor(options = {}) {
      this.sampleRate = options.sampleRate || 16000;
      this.minimumSpeechSamples = this.sampleRate * ((options.minimumSpeechMs || 200) / 1000);
      this.trailingSilenceSamples = this.sampleRate * ((options.trailingSilenceMs || 900) / 1000);
      this.maximumSpeechSamples = this.sampleRate * (options.maximumSpeechSeconds || 30);
      this.noiseFloor = 0.004;
      this.speechSamples = 0;
      this.silenceSamples = 0;
      this.totalActiveSamples = 0;
      this.active = false;
    }

    process(samples) {
      let sum = 0;
      for (let index = 0; index < samples.length; index += 1) sum += samples[index] * samples[index];
      const rms = samples.length ? Math.sqrt(sum / samples.length) : 0;
      const threshold = Math.max(0.015, this.noiseFloor * 3);
      const speech = rms >= threshold;
      let started = false;
      let ended = false;
      let maximumReached = false;
      if (!this.active) {
        if (speech) this.speechSamples += samples.length;
        else {
          this.speechSamples = 0;
          this.noiseFloor = (this.noiseFloor * 0.95) + (rms * 0.05);
        }
        if (this.speechSamples >= this.minimumSpeechSamples) {
          this.active = true; started = true; this.silenceSamples = 0; this.totalActiveSamples = this.speechSamples;
        }
      } else {
        this.totalActiveSamples += samples.length;
        this.silenceSamples = speech ? 0 : this.silenceSamples + samples.length;
        maximumReached = this.totalActiveSamples >= this.maximumSpeechSamples;
        if (this.silenceSamples >= this.trailingSilenceSamples || maximumReached) {
          this.active = false; ended = true; this.speechSamples = 0; this.silenceSamples = 0; this.totalActiveSamples = 0;
        }
      }
      return { active: this.active || ended, started, ended, maximumReached, rms };
    }
  }

  class AudioPlayback {
    constructor(options = {}) {
      this.onStatus = options.onStatus || function () {};
      this.contextFactory = options.contextFactory || (() => {
        const Context = window.AudioContext || window.webkitAudioContext;
        return Context ? new Context({sampleRate: 16000, latencyHint: "interactive"}) : null;
      });
      this.context = null;
      this.blocked = false;
      this.generation = 0;
      this.queue = [];
      this.active = null;
      this.nodes = new Set();
      this.nextTime = 0;
      this.carry = new Uint8Array(0);
      this.pcmFormat = null;
      this.finished = false;
      this.status = "idle";
      this.timer = null;
      this.replyId = null;
      this.replySequence = 0;
      this.retiredSequence = 0;
      this.retiredIds = new Set();
      this.started = false;
    }

    _status(value) {
      if (this.status === value) return;
      this.status = value;
      this.onStatus(value);
    }

    beginReply(id, sequence = 0) {
      if ((sequence && (sequence < this.replySequence || sequence <= this.retiredSequence)) || this.retiredIds.has(id)) return false;
      if (id && id !== this.replyId) {
        this.interrupt();
        this.replyId = id;
      }
      this.replySequence = Math.max(this.replySequence, sequence || 0);
      return true;
    }

    _context() {
      if (!this.context || this.context.state === "closed") {
        this.context = this.contextFactory();
        const context = this.context;
        if (context) context.onstatechange = () => {
          if (this.context !== context) return;
          if (context.state === "running") {
            this.blocked = false;
            if (this.nodes.size) this._status("speaking");
            this._drain(true);
          } else if (this.nodes.size || this.queue.length) {
            this.blocked = true;
            this._status("blocked");
          }
        };
      }
      return this.context;
    }

    // Invoke synchronously from a click/submit gesture, before any network await.
    unlock() {
      let context;
      try { context = this._context(); } catch (_) { return Promise.resolve(false); }
      if (!context) return Promise.resolve(false);
      const generation = this.generation;
      let resumed;
      try { resumed = context.state === "running" ? Promise.resolve() : context.resume(); }
      catch (_) { resumed = Promise.reject(new Error("audio_resume_failed")); }
      return Promise.resolve(resumed).then(() => {
        if (generation !== this.generation || context !== this.context) return false;
        this.blocked = context.state !== "running";
        if (this.blocked && (this.queue.length || this.nodes.size)) this._status("blocked");
        else { if (this.nodes.size) this._status("speaking"); this._drain(true); }
        return !this.blocked;
      }).catch(() => {
        if (generation === this.generation) {
          this.blocked = true;
          if (this.queue.length || this.nodes.size) this._status("blocked");
        }
        return false;
      });
    }

    enqueue(chunk) {
      if (!chunk || chunk.generation !== this.generation || this.finished) return false;
      const size = this.queue.reduce((n, c) => n + c.audio.byteLength, 0);
      if (!chunk.audio || size + chunk.audio.byteLength > 8 * 1024 * 1024) {
        this.fail(); return false;
      }
      this.queue.push(chunk);
      this._drain();
      return true;
    }

    complete(id = null, sequence = 0) {
      if ((id && id !== this.replyId) || (sequence && sequence < this.replySequence)) return;
      this.finished = true;
      this._drain(true);
      this._settle();
    }

    fail(id = null, sequence = 0) {
      if ((id && id !== this.replyId) || (sequence && sequence < this.replySequence)) return;
      this.interrupt();
      this.finished = true;
      this._status("unavailable");
    }

    interrupt() {
      this.blocked = false;
      this.retiredSequence = Math.max(this.retiredSequence, this.replySequence);
      if (this.replyId) this.retiredIds.add(this.replyId);
      if (this.retiredIds.size > 32) this.retiredIds.delete(this.retiredIds.values().next().value);
      this.started = false;
      this.generation += 1;
      this.queue = [];
      this.finished = false;
      this.replyId = null;
      this.carry = new Uint8Array(0);
      this.pcmFormat = null;
      this.nextTime = 0;
      clearTimeout(this.timer); this.timer = null;
      for (const node of this.nodes) {
        node.onended = null;
        try { node.stop(); } catch (_) { /* Best-effort cleanup or optional browser capability. */ }
        node.disconnect();
      }
      this.nodes.clear();
      if (this.active) {
        URL.revokeObjectURL(this.active.src);
        this.active.onended = null; this.active.onerror = null;
        this.active.pause(); this.active.src = ""; this.active = null;
      }
      this._status("idle");
    }

    resetSession() {
      this.interrupt();
      this.replySequence = 0; this.retiredSequence = 0; this.retiredIds.clear();
    }

    retry() {
      if (this.queue[0] && !this._isPcm(this.queue[0])) {
        this.blocked = false; this._playNext(); return;
      }
      return this.unlock();
    }

    _isPcm(chunk) {
      return String(chunk.container || "").toLowerCase() === "none" &&
        String(chunk.format || "").toLowerCase() === "pcm";
    }

    _settle() {
      if (this.finished && !this.queue.length && !this.nodes.size && !this.active) {
        if (this.carry.length) { this.carry = new Uint8Array(0); this._status("unavailable"); }
        else if (this.status !== "unavailable") this._status("idle");
      }
    }

    _drain(force = false) {
      if (this.blocked || !this.queue.length) {
        if (this.blocked && this.queue.length) this._status("blocked");
        this._settle(); return;
      }
      if (!this._isPcm(this.queue[0])) { this._playNext(); return; }
      let context;
      try { context = this._context(); } catch (_) { this.fail(); return; }
      if (!context) { this.fail(); return; }
      if (context.state !== "running") { this.blocked = true; this._status("blocked"); return; }
      // Brief jitter buffer, flushed immediately at EOF for short replies.
      const pendingSeconds = this.queue.reduce((n,c) => n + c.audio.byteLength /
        (2 * (c.channels || 1) * (c.sampleRate || 16000)), 0);
      if (!force && !this.started && pendingSeconds < 0.24) {
        if (!this.timer) this.timer = setTimeout(() => { this.timer = null; this._drain(true); }, 180);
        return;
      }
      clearTimeout(this.timer); this.timer = null;
      const generation = this.generation;
      while (this.queue.length && this._isPcm(this.queue[0])) {
        const chunk = this.queue.shift();
        const rate = chunk.sampleRate || 16000, channels = chunk.channels || 1;
        if (!Number.isInteger(rate) || rate < 8000 || rate > 96000 || ![1,2].includes(channels)) { this.fail(); return; }
        const format = `${rate}:${channels}`;
        if (this.pcmFormat && this.pcmFormat !== format) { this.fail(); return; }
        this.pcmFormat = format;
        const bytes = new Uint8Array(this.carry.length + chunk.audio.byteLength);
        bytes.set(this.carry); bytes.set(new Uint8Array(chunk.audio), this.carry.length);
        const length = bytes.byteLength - bytes.byteLength % (2 * channels);
        this.carry = bytes.slice(length);
        if (!length) continue;
        try {
          const frames = length / (2 * channels);
          const buffer = context.createBuffer(channels, frames, rate);
          const view = new DataView(bytes.buffer, 0, length);
          for (let c = 0; c < channels; c++) {
            const output = buffer.getChannelData(c);
            for (let i = 0; i < frames; i++) output[i] = view.getInt16((i * channels + c) * 2, true) / 32768;
          }
          const start = Math.max(context.currentTime + (this.started ? 0.005 : 0.06), this.nextTime);
          if (start + buffer.duration - context.currentTime > 60) { this.fail(); return; }
          const node = context.createBufferSource();
          node.buffer = buffer; node.connect(context.destination);
          this.nextTime = start + buffer.duration;
          this.nodes.add(node);
          node.onended = () => {
            node.disconnect();
            if (generation !== this.generation) return;
            this.nodes.delete(node); this._drain(true); this._settle();
          };
          node.start(start);
          this.started = true;
          this._status("speaking");
        } catch (_) { this.fail(); return; }
      }
      this._settle();
    }

    // Compatibility for complete encoded clips; ElevenLabs live audio uses PCM above.
    _playNext() {
      if (this.blocked || this.active || this.nodes.size || !this.queue.length) return;
      const chunk = this.queue.shift();
      const audio = new Audio(URL.createObjectURL(new Blob([chunk.audio], { type: "audio/" + (chunk.format || "wav") })));
      this.active = audio;
      const finish = () => {
        if (this.active !== audio) return;
        URL.revokeObjectURL(audio.src); this.active = null;
        if (this.queue.length) this._drain(true);
        else if (!this.replyId) this._status("idle");
        this._settle();
      };
      audio.onended = finish;
      audio.onerror = () => { if (this.active === audio) this.fail(); };
      audio.play().then(() => { if (this.active === audio) this._status("speaking"); }).catch((error) => {
        if (this.active !== audio) return;
        URL.revokeObjectURL(audio.src); this.active = null;
        if (error?.name === "NotAllowedError") {
          this.blocked = true; this.queue.unshift(chunk); this._status("blocked");
        } else this.fail();
      });
    }
  }

  function floatToPcm16(samples) {
    const pcm = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i += 1) {
      const value = Math.max(-1, Math.min(1, samples[i]));
      pcm[i] = value < 0 ? value * 32768 : value * 32767;
    }
    return pcm.buffer;
  }

  function pcm16ToWav(pcmBuffer, sampleRate = 16000, channels = 1) {
    if (!pcmBuffer || typeof pcmBuffer.byteLength !== "number") throw new TypeError("pcm_buffer_required");
    if (pcmBuffer.byteLength % (2 * channels) !== 0) throw new Error("unaligned_pcm_frame");
    const output = new ArrayBuffer(44 + pcmBuffer.byteLength);
    const view = new DataView(output);
    const write = (offset, value) => {
      for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
    };
    write(0, "RIFF"); view.setUint32(4, 36 + pcmBuffer.byteLength, true); write(8, "WAVE");
    write(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, channels, true); view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channels * 2, true); view.setUint16(32, channels * 2, true);
    view.setUint16(34, 16, true); write(36, "data"); view.setUint32(40, pcmBuffer.byteLength, true);
    new Uint8Array(output, 44).set(new Uint8Array(pcmBuffer));
    return output;
  }

  function buildVoiceWebSocketUrl(baseUrl, shopDomain) {
    const url = new URL(baseUrl);
    if (!['ws:', 'wss:'].includes(url.protocol)) throw new Error('voice_url_protocol');
    if (url.protocol !== 'wss:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
      throw new Error('voice_url_requires_tls');
    }
    if (!url.pathname.includes('/voice/')) {
      url.pathname = url.pathname.replace(/\/$/, '') + '/voice/' + encodeURIComponent(shopDomain);
    }
    return url.toString();
  }

  if (typeof window !== "undefined") {
    window.IShopVoiceSession = {
      VoiceSessionClient,
      PcmCapture,
      VoiceActivityDetector,
      AudioPlayback,
      floatToPcm16,
      pcm16ToWav,
      buildVoiceWebSocketUrl,
    };
    const root = document.getElementById("ishop-drake-root");
    const bootstrapUrl = root && root.dataset.bootstrapScriptUrl;
    const widgetUrl = root && root.dataset.widgetScriptUrl;
    const loadBootstrap = () => {
      if (!bootstrapUrl) return;
      const script = document.createElement("script");
      script.src = bootstrapUrl;
      script.defer = true;
      document.head.appendChild(script);
    };
    const loadWidget = () => { if (widgetUrl) {
      const script = document.createElement("script");
      script.src = widgetUrl;
      script.onload = loadBootstrap;
      script.defer = true;
      document.head.appendChild(script);
    } else {
      loadBootstrap();
    } };
    const dependencies = [root?.dataset.chatVendorUrl, root?.dataset.chatScriptUrl].filter(Boolean);
    (async () => {
      for (const url of dependencies) await new Promise((resolve, reject) => {
        const script = document.createElement('script'); script.src = url;
        if (url === root.dataset.chatVendorUrl) script.type = 'module';
        script.onload = resolve; script.onerror = reject; document.head.appendChild(script);
      });
      loadWidget();
    })().catch(() => {
      root.dataset.bootstrapState = 'failed';
      root.hidden = false;
      root.textContent = 'Drake could not load its chat interface. Please refresh to retry.';
    });
  }
})();

const SIGNAL_VERSION = 1;
const MAX_SIGNAL_LENGTH = 65536;
const ICE_GATHER_TIMEOUT_MS = 15000;
const HOST_CONNECT_TIMEOUT_MS = 30000;
const GUEST_CONNECT_TIMEOUT_MS = 120000;
const DISCONNECT_GRACE_MS = 5000;
const PING_INTERVAL_MS = 2000;
const PING_RESPONSE_TIMEOUT_MS = 10000;
const MAX_DATA_MESSAGE_LENGTH = 4096;
const DISCONNECT_NOTICE_GRACE_MS = 100;

export const PEER_CONNECTION_CONFIG = Object.freeze({ iceServers: [] });

function createSessionId() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function serializeSignal(kind, sessionId, description) {
  if (!["offer", "answer"].includes(kind)) throw new Error("Signal種別が不正です。");
  if (!description || description.type !== kind || typeof description.sdp !== "string") {
    throw new Error("SessionDescriptionが不正です。");
  }

  return JSON.stringify({
    v: SIGNAL_VERSION,
    sid: sessionId,
    kind,
    created: Date.now(),
    description: {
      type: description.type,
      sdp: description.sdp,
    },
  });
}

export function parseSignal(rawValue, expectedKind, expectedSessionId = null) {
  const value = String(rawValue || "").trim();
  if (!value) throw new Error(`${expectedKind === "offer" ? "Offer" : "Answer"}を貼り付けてください。`);
  if (value.length > MAX_SIGNAL_LENGTH) throw new Error("接続文字列が大きすぎます。");

  let signal;
  try {
    signal = JSON.parse(value);
  } catch {
    throw new Error("接続文字列を読み取れません。全文をコピーしたか確認してください。");
  }

  if (!signal || signal.v !== SIGNAL_VERSION) throw new Error("接続文字列のバージョンが対応外です。");
  if (signal.kind !== expectedKind) throw new Error(`これは${expectedKind}の接続文字列ではありません。`);
  if (typeof signal.sid !== "string" || !/^[A-Za-z0-9_-]{16}$/.test(signal.sid)) {
    throw new Error("セッションIDが不正です。");
  }
  if (expectedSessionId && signal.sid !== expectedSessionId) {
    throw new Error("別の接続実験で作られたAnswerです。");
  }
  if (
    !signal.description
    || signal.description.type !== expectedKind
    || typeof signal.description.sdp !== "string"
    || !signal.description.sdp.startsWith("v=0")
  ) {
    throw new Error("SessionDescriptionが不正です。");
  }
  assertHasIceCandidates(signal.description);

  return signal;
}

export function waitForIceGatheringComplete(peerConnection, timeoutMs = ICE_GATHER_TIMEOUT_MS, signal = null) {
  if (peerConnection.iceGatheringState === "complete") return Promise.resolve();
  if (signal?.aborted) return Promise.reject(new Error("接続処理を中断しました。"));

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error("ICE Candidateの収集がタイムアウトしました。"));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timeoutId);
      peerConnection.removeEventListener("icegatheringstatechange", handleStateChange);
      signal?.removeEventListener("abort", handleAbort);
    }

    function handleStateChange() {
      if (peerConnection.iceGatheringState !== "complete") return;
      cleanup();
      resolve();
    }

    function handleAbort() {
      cleanup();
      reject(new Error("接続処理を中断しました。"));
    }

    peerConnection.addEventListener("icegatheringstatechange", handleStateChange);
    signal?.addEventListener("abort", handleAbort, { once: true });
    if (signal?.aborted) {
      handleAbort();
      return;
    }
    handleStateChange();
  });
}

function assertHasIceCandidates(description) {
  if (!description?.sdp.includes("a=candidate:")) {
    throw new Error("接続に使えるICE Candidateが見つかりませんでした。");
  }
}

function waitForCondition(check, timeoutMs, errorMessage) {
  if (check()) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const timerId = setInterval(() => {
      if (check()) {
        clearInterval(timerId);
        resolve();
      } else if (performance.now() - startedAt >= timeoutMs) {
        clearInterval(timerId);
        reject(new Error(errorMessage));
      }
    }, 20);
  });
}

function parseChannelMessage(rawMessage, sessionId) {
  if (typeof rawMessage !== "string" || rawMessage.length > MAX_DATA_MESSAGE_LENGTH) return null;

  let message;
  try {
    message = JSON.parse(rawMessage);
  } catch {
    return null;
  }

  if (
    message?.v !== SIGNAL_VERSION
    || message.sid !== sessionId
    || typeof message.type !== "string"
    || !Number.isSafeInteger(message.seq)
    || message.seq < 1
    || !Number.isFinite(message.ts)
  ) return null;

  return message;
}

export class WebRtcConnectionExperiment {
  constructor(onUpdate = () => {}) {
    this.onUpdate = onUpdate;
    this.peerConnection = null;
    this.controlChannel = null;
    this.realtimeChannel = null;
    this.role = null;
    this.sessionId = null;
    this.controlSequence = 0;
    this.realtimeSequence = 0;
    this.pendingPings = new Map();
    this.pingTimer = null;
    this.connectionTimer = null;
    this.disconnectTimer = null;
    this.operationController = null;
    this.connected = false;
    this.realtimeVerified = false;
    this.tearingDown = false;
  }

  emit(patch) {
    this.onUpdate({
      connectionState: this.peerConnection?.connectionState || "closed",
      iceState: this.peerConnection?.iceConnectionState || "closed",
      controlState: this.controlChannel?.readyState || "closed",
      realtimeState: this.realtimeChannel?.readyState || "closed",
      ...patch,
    });
  }

  createPeerConnection(role) {
    this.close(false);
    if (typeof RTCPeerConnection !== "function") {
      throw new Error("このブラウザはRTCPeerConnectionに対応していません。");
    }
    this.role = role;
    this.operationController = new AbortController();
    const peerConnection = new RTCPeerConnection(PEER_CONNECTION_CONFIG);
    this.peerConnection = peerConnection;

    peerConnection.addEventListener("connectionstatechange", () => {
      if (this.peerConnection !== peerConnection) return;
      const connectionState = peerConnection.connectionState;
      this.emit({ connectionState });

      if (connectionState === "connected") {
        this.clearDisconnectTimer();
        this.checkChannelsOpen();
      } else if (connectionState === "disconnected") {
        this.startDisconnectTimer();
      } else if (connectionState === "failed") {
        this.fail("接続に失敗しました。同じWi-Fiの端末間通信が許可されているか確認してください。");
      }
    });

    peerConnection.addEventListener("iceconnectionstatechange", () => {
      if (this.peerConnection !== peerConnection) return;
      this.emit({ iceState: peerConnection.iceConnectionState });
    });

    if (role === "host") {
      this.attachChannel(peerConnection.createDataChannel("control", { ordered: true }));
      this.attachChannel(peerConnection.createDataChannel("realtime", {
        ordered: false,
        maxRetransmits: 0,
      }));
    } else {
      peerConnection.addEventListener("datachannel", (event) => {
        if (this.peerConnection !== peerConnection) {
          event.channel.close();
          return;
        }
        this.attachChannel(event.channel);
      });
    }

    this.emit({ status: "PeerConnectionを作成しました。", error: false });
  }

  attachChannel(channel) {
    const validControl = channel.label === "control"
      && channel.ordered === true
      && channel.maxRetransmits === null;
    const validRealtime = channel.label === "realtime"
      && channel.ordered === false
      && channel.maxRetransmits === 0;

    if (validControl && !this.controlChannel) this.controlChannel = channel;
    else if (validRealtime && !this.realtimeChannel) this.realtimeChannel = channel;
    else {
      channel.close();
      this.fail("DataChannelの名前または通信設定が不正です。");
      return;
    }

    const isCurrentChannel = () => (
      (channel.label === "control" && this.controlChannel === channel)
      || (channel.label === "realtime" && this.realtimeChannel === channel)
    );

    channel.addEventListener("open", () => {
      if (!isCurrentChannel()) return;
      this.emit({ status: `${channel.label}チャンネルがopenになりました。` });
      this.checkChannelsOpen();
    });
    channel.addEventListener("close", () => {
      if (!isCurrentChannel()) return;
      this.emit({ status: `${channel.label}チャンネルが閉じました。` });
      if (this.connected) this.fail(`${channel.label}チャンネルが切断されました。`);
    });
    channel.addEventListener("error", () => {
      if (!isCurrentChannel()) return;
      this.fail(`${channel.label}チャンネルで通信エラーが発生しました。`);
    });
    channel.addEventListener("message", (event) => {
      if (!isCurrentChannel()) return;
      if (channel.label === "control") this.handleControlMessage(event.data);
      else this.handleRealtimeMessage(event.data);
    });

    this.emit({});
    this.checkChannelsOpen();
  }

  async createOfferSignal() {
    try {
      this.createPeerConnection("host");
      this.sessionId = createSessionId();
      this.emit({ status: "Offerを作成し、ICE Candidateを収集しています。" });

      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);
      await waitForIceGatheringComplete(
        this.peerConnection,
        ICE_GATHER_TIMEOUT_MS,
        this.operationController.signal,
      );

      if (!this.peerConnection?.localDescription) throw new Error("Offerを取得できませんでした。");
      assertHasIceCandidates(this.peerConnection.localDescription);
      this.emit({ status: "Offerを相手へ渡し、Answerを待ってください。" });
      return serializeSignal("offer", this.sessionId, this.peerConnection.localDescription);
    } catch (error) {
      if (this.peerConnection) this.fail(error.message);
      throw error;
    }
  }

  async createAnswerSignal(rawOffer) {
    try {
      const offerSignal = parseSignal(rawOffer, "offer");
      this.createPeerConnection("guest");
      this.sessionId = offerSignal.sid;
      this.emit({ status: "Offerを適用しています。" });

      await this.peerConnection.setRemoteDescription(offerSignal.description);
      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);
      this.emit({ status: "Answerを作成し、ICE Candidateを収集しています。" });
      await waitForIceGatheringComplete(
        this.peerConnection,
        ICE_GATHER_TIMEOUT_MS,
        this.operationController.signal,
      );

      if (!this.peerConnection?.localDescription) throw new Error("Answerを取得できませんでした。");
      assertHasIceCandidates(this.peerConnection.localDescription);
      this.startConnectionTimeout(GUEST_CONNECT_TIMEOUT_MS);
      this.emit({ status: "Answerを作成しました。相手へ渡してください。" });
      return serializeSignal("answer", this.sessionId, this.peerConnection.localDescription);
    } catch (error) {
      if (this.peerConnection) this.fail(error.message);
      throw error;
    }
  }

  async applyAnswerSignal(rawAnswer) {
    if (!this.peerConnection || this.role !== "host" || !this.sessionId) {
      throw new Error("先にOfferを作成してください。");
    }

    const answerSignal = parseSignal(rawAnswer, "answer", this.sessionId);
    this.emit({ status: "Answerを適用し、接続を待っています。", error: false });
    await this.peerConnection.setRemoteDescription(answerSignal.description);
    this.startConnectionTimeout(HOST_CONNECT_TIMEOUT_MS);
    this.checkChannelsOpen();
  }

  checkChannelsOpen() {
    if (
      this.connected
      || this.controlChannel?.readyState !== "open"
      || this.realtimeChannel?.readyState !== "open"
    ) return;

    this.connected = true;
    this.clearConnectionTimer();
    this.clearDisconnectTimer();
    this.emit({
      status: "両方のDataChannelがopenになりました。",
      error: false,
      connected: true,
    });
    this.sendRealtimeProbe();
    this.sendPing();
    this.pingTimer = setInterval(() => this.sendPing(), PING_INTERVAL_MS);
  }

  sendControl(message) {
    if (this.controlChannel?.readyState !== "open") return false;
    try {
      this.controlChannel.send(JSON.stringify({
        v: SIGNAL_VERSION,
        sid: this.sessionId,
        seq: ++this.controlSequence,
        ts: performance.now(),
        ...message,
      }));
      return true;
    } catch {
      this.fail("controlチャンネルで送信できませんでした。接続が切断されています。");
      return false;
    }
  }

  sendPing() {
    const sentAt = performance.now();
    if (this.controlChannel?.readyState !== "open") return;

    if ([...this.pendingPings.values()].some((startedAt) => (
      sentAt - startedAt > PING_RESPONSE_TIMEOUT_MS
    ))) {
      this.fail("ping/pongの応答がありません。相手との接続が切断されました。");
      return;
    }

    const pingId = ++this.controlSequence;
    this.pendingPings.set(pingId, sentAt);
    try {
      this.controlChannel.send(JSON.stringify({
        v: SIGNAL_VERSION,
        sid: this.sessionId,
        type: "ping",
        seq: pingId,
        ts: sentAt,
        pingId,
      }));
    } catch {
      this.pendingPings.delete(pingId);
      this.fail("pingを送信できませんでした。相手との接続が切断されています。");
    }
  }

  handleControlMessage(rawMessage) {
    const message = parseChannelMessage(rawMessage, this.sessionId);
    if (!message) return;

    if (message.type === "disconnect") {
      this.fail("相手が接続実験を終了し、切断されました。");
    } else if (message.type === "ping" && Number.isSafeInteger(message.pingId) && message.pingId > 0) {
      this.sendControl({
        type: "pong",
        pingId: message.pingId,
        echoTs: message.ts,
      });
    } else if (message.type === "pong" && Number.isSafeInteger(message.pingId) && message.pingId > 0) {
      const sentAt = this.pendingPings.get(message.pingId);
      if (sentAt === undefined) return;
      this.pendingPings.delete(message.pingId);
      const rtt = Math.max(0, performance.now() - sentAt);
      this.emit({ rtt, status: `ping/pong成功: RTT ${rtt.toFixed(1)} ms`, connected: true });
    }
  }

  sendRealtimeProbe() {
    this.sendRealtime({ type: "probe" });
  }

  sendRealtime(message) {
    if (this.realtimeChannel?.readyState !== "open") return false;
    try {
      this.realtimeChannel.send(JSON.stringify({
        v: SIGNAL_VERSION,
        sid: this.sessionId,
        seq: ++this.realtimeSequence,
        ts: performance.now(),
        ...message,
      }));
      return true;
    } catch {
      this.fail("realtimeチャンネルで送信できませんでした。接続が切断されています。");
      return false;
    }
  }

  handleRealtimeMessage(rawMessage) {
    const message = parseChannelMessage(rawMessage, this.sessionId);
    if (!message) return;

    if (message.type === "probe" && this.realtimeChannel?.readyState === "open") {
      this.sendRealtime({ type: "probe-ack" });
    } else if (message.type === "probe-ack") {
      this.realtimeVerified = true;
      this.emit({ realtimeVerified: true });
    }
  }

  startConnectionTimeout(timeoutMs) {
    this.clearConnectionTimer();
    this.connectionTimer = setTimeout(() => {
      if (!this.connected) this.fail("接続がタイムアウトしました。新しい接続実験を作り直してください。");
    }, timeoutMs);
  }

  startDisconnectTimer() {
    if (this.disconnectTimer) return;
    this.disconnectTimer = setTimeout(() => {
      if (this.peerConnection?.connectionState === "disconnected") {
        this.fail("相手との接続が切断されました。新しい接続実験を作り直してください。");
      }
    }, DISCONNECT_GRACE_MS);
  }

  clearConnectionTimer() {
    if (this.connectionTimer) clearTimeout(this.connectionTimer);
    this.connectionTimer = null;
  }

  clearDisconnectTimer() {
    if (this.disconnectTimer) clearTimeout(this.disconnectTimer);
    this.disconnectTimer = null;
  }

  fail(message) {
    if (this.tearingDown) return;
    this.teardown(false);
    this.emit({
      connectionState: "failed",
      iceState: "failed",
      controlState: "closed",
      realtimeState: "closed",
      status: message,
      error: true,
      connected: false,
    });
  }

  teardown(notifyPeer) {
    if (this.tearingDown) return;
    this.tearingDown = true;

    const control = this.controlChannel;
    const realtime = this.realtimeChannel;
    const peer = this.peerConnection;
    const shouldNotify = notifyPeer
      && this.connected
      && control?.readyState === "open"
      && this.sessionId;

    if (shouldNotify) {
      try {
        control.send(JSON.stringify({
          v: SIGNAL_VERSION,
          sid: this.sessionId,
          type: "disconnect",
          seq: ++this.controlSequence,
          ts: performance.now(),
        }));
      } catch {
        // すでに通信不能なら、そのままローカル資源を破棄する。
      }
    }

    this.operationController?.abort();
    this.operationController = null;
    this.clearConnectionTimer();
    this.clearDisconnectTimer();
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.pendingPings.clear();
    this.connected = false;
    this.realtimeVerified = false;
    this.controlSequence = 0;
    this.realtimeSequence = 0;
    this.controlChannel = null;
    this.realtimeChannel = null;
    this.peerConnection = null;
    this.role = null;
    this.sessionId = null;

    const closeResources = () => {
      control?.close();
      realtime?.close();
      peer?.close();
    };
    if (shouldNotify) setTimeout(closeResources, DISCONNECT_NOTICE_GRACE_MS);
    else closeResources();

    this.tearingDown = false;
  }

  close(emitUpdate = true) {
    this.teardown(true);

    if (emitUpdate) {
      this.emit({
        connectionState: "closed",
        iceState: "closed",
        controlState: "closed",
        realtimeState: "closed",
        status: "接続実験を終了しました。",
        error: false,
        connected: false,
        rtt: null,
      });
    }
  }
}

export async function runLoopbackConnectionTest(timeoutMs = 15000) {
  if (typeof RTCPeerConnection !== "function") {
    throw new Error("RTCPeerConnectionに対応していません。");
  }

  const host = new RTCPeerConnection(PEER_CONNECTION_CONFIG);
  const guest = new RTCPeerConnection(PEER_CONNECTION_CONFIG);
  const hostControl = host.createDataChannel("control", { ordered: true });
  const hostRealtime = host.createDataChannel("realtime", { ordered: false, maxRetransmits: 0 });
  let guestControl = null;
  let guestRealtime = null;

  guest.addEventListener("datachannel", (event) => {
    if (event.channel.label === "control") guestControl = event.channel;
    if (event.channel.label === "realtime") guestRealtime = event.channel;
  });

  try {
    await host.setLocalDescription(await host.createOffer());
    await waitForIceGatheringComplete(host, timeoutMs);
    await guest.setRemoteDescription(host.localDescription);
    await guest.setLocalDescription(await guest.createAnswer());
    await waitForIceGatheringComplete(guest, timeoutMs);
    await host.setRemoteDescription(guest.localDescription);

    try {
      await waitForCondition(
        () => [hostControl, hostRealtime, guestControl, guestRealtime]
          .every((channel) => channel?.readyState === "open"),
        timeoutMs,
        "2つのDataChannelがopenになりませんでした。",
      );
    } catch {
      throw new Error([
        "2つのDataChannelがopenになりませんでした。",
        `host=${host.connectionState}/${host.iceConnectionState}`,
        `guest=${guest.connectionState}/${guest.iceConnectionState}`,
        `signaling=${host.signalingState}/${guest.signalingState}`,
        `hostCandidate=${host.localDescription?.sdp.includes("a=candidate:") || false}`,
        `guestCandidate=${guest.localDescription?.sdp.includes("a=candidate:") || false}`,
        `hostCandidates=${JSON.stringify(host.localDescription?.sdp.match(/^a=candidate:.*$/gm) || [])}`,
        `guestCandidates=${JSON.stringify(guest.localDescription?.sdp.match(/^a=candidate:.*$/gm) || [])}`,
      ].join(" "));
    }

    const pongPromise = new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => reject(new Error("control ping/pongがタイムアウトしました。")), 3000);
      hostControl.addEventListener("message", (event) => {
        if (event.data !== "pong") return;
        clearTimeout(timeoutId);
        resolve();
      }, { once: true });
    });
    guestControl.addEventListener("message", (event) => {
      if (event.data === "ping") guestControl.send("pong");
    }, { once: true });
    hostControl.send("ping");
    await pongPromise;

    const realtimePromise = new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => reject(new Error("realtime通信がタイムアウトしました。")), 3000);
      guestRealtime.addEventListener("message", (event) => {
        if (event.data !== "probe") return;
        clearTimeout(timeoutId);
        resolve();
      }, { once: true });
    });
    hostRealtime.send("probe");
    await realtimePromise;

    return {
      control: hostControl.readyState,
      controlOrdered: hostControl.ordered,
      realtime: hostRealtime.readyState,
      realtimeOrdered: hostRealtime.ordered,
      realtimeMaxRetransmits: hostRealtime.maxRetransmits,
      pingPong: true,
      realtimeMessage: true,
    };
  } finally {
    hostControl.close();
    hostRealtime.close();
    guestControl?.close();
    guestRealtime?.close();
    host.close();
    guest.close();
  }
}

async function copyText(textarea) {
  if (!textarea.value) throw new Error("コピーする接続文字列がありません。");

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(textarea.value);
      return;
    } catch {
      // 選択コピーへフォールバックする。
    }
  }

  textarea.focus();
  textarea.select();
  if (!document.execCommand("copy")) throw new Error("コピーできませんでした。文字列を手動で選択してください。");
}

function initializeConnectionExperimentUi() {
  const elements = {
    overlay: document.getElementById("connectionExperiment"),
    createButton: document.getElementById("createConnectionButton"),
    joinButton: document.getElementById("joinConnectionButton"),
    closeButton: document.getElementById("closeConnectionButton"),
    endButton: document.getElementById("endConnectionButton"),
    title: document.getElementById("connectionTitle"),
    message: document.getElementById("connectionMessage"),
    peerState: document.getElementById("peerConnectionState"),
    iceState: document.getElementById("iceConnectionState"),
    controlState: document.getElementById("controlChannelState"),
    realtimeState: document.getElementById("realtimeChannelState"),
    rtt: document.getElementById("connectionRtt"),
    hostSection: document.getElementById("hostConnectionSection"),
    guestSection: document.getElementById("guestConnectionSection"),
    offerOutput: document.getElementById("offerOutput"),
    answerInput: document.getElementById("answerInput"),
    offerInput: document.getElementById("offerInput"),
    answerOutput: document.getElementById("answerOutput"),
    copyOfferButton: document.getElementById("copyOfferButton"),
    applyAnswerButton: document.getElementById("applyAnswerButton"),
    createAnswerButton: document.getElementById("createAnswerButton"),
    copyAnswerButton: document.getElementById("copyAnswerButton"),
    sendPingButton: document.getElementById("sendPingButton"),
  };

  if (Object.values(elements).some((element) => !element)) return;

  let currentExperiment = null;
  let uiGeneration = 0;

  function updateUi(update) {
    if (update.connectionState) elements.peerState.textContent = update.connectionState;
    if (update.iceState) elements.iceState.textContent = update.iceState;
    if (update.controlState) elements.controlState.textContent = update.controlState;
    if (update.realtimeState) elements.realtimeState.textContent = update.realtimeState;
    if (Object.hasOwn(update, "rtt")) {
      elements.rtt.textContent = update.rtt === null || update.rtt === undefined
        ? "—"
        : `${update.rtt.toFixed(1)} ms`;
    }
    if (update.status) elements.message.textContent = update.status;
    if (Object.hasOwn(update, "error")) {
      elements.message.classList.toggle("error", Boolean(update.error));
    }
    if (Object.hasOwn(update, "connected")) {
      elements.message.classList.toggle("connected", Boolean(update.connected));
      elements.sendPingButton.classList.toggle("hidden", !update.connected);
    }
  }

  function resetFields() {
    elements.offerOutput.value = "";
    elements.answerInput.value = "";
    elements.offerInput.value = "";
    elements.answerOutput.value = "";
    elements.copyOfferButton.disabled = true;
    elements.copyAnswerButton.disabled = true;
    elements.createAnswerButton.disabled = false;
    elements.applyAnswerButton.disabled = false;
    updateUi({
      connectionState: "new",
      iceState: "new",
      controlState: "closed",
      realtimeState: "closed",
      rtt: null,
      status: "接続方法を準備しています。",
      error: false,
      connected: false,
    });
  }

  function openOverlay(role) {
    currentExperiment?.close(false);
    uiGeneration += 1;
    const generation = uiGeneration;
    currentExperiment = new WebRtcConnectionExperiment((update) => {
      if (generation === uiGeneration) updateUi(update);
    });
    resetFields();
    elements.overlay.classList.remove("hidden");
    elements.hostSection.classList.toggle("hidden", role !== "host");
    elements.guestSection.classList.toggle("hidden", role !== "guest");
    elements.title.textContent = role === "host" ? "接続実験を作る" : "接続実験に参加する";
    return uiGeneration;
  }

  function closeOverlay() {
    uiGeneration += 1;
    currentExperiment?.close(false);
    currentExperiment = null;
    elements.overlay.classList.add("hidden");
  }

  elements.createButton.addEventListener("click", async () => {
    const generation = openOverlay("host");
    try {
      const offerSignal = await currentExperiment.createOfferSignal();
      if (generation !== uiGeneration) return;
      elements.offerOutput.value = offerSignal;
      elements.copyOfferButton.disabled = false;
    } catch (error) {
      if (generation === uiGeneration) updateUi({ status: error.message, error: true });
    }
  });

  elements.joinButton.addEventListener("click", () => {
    openOverlay("guest");
    updateUi({ status: "相手から受け取ったOfferを貼り付けてください。" });
  });

  elements.createAnswerButton.addEventListener("click", async () => {
    const generation = uiGeneration;
    elements.createAnswerButton.disabled = true;
    try {
      const answerSignal = await currentExperiment.createAnswerSignal(elements.offerInput.value);
      if (generation !== uiGeneration) return;
      elements.answerOutput.value = answerSignal;
      elements.copyAnswerButton.disabled = false;
    } catch (error) {
      if (generation === uiGeneration) updateUi({ status: error.message, error: true });
    } finally {
      if (generation === uiGeneration) elements.createAnswerButton.disabled = false;
    }
  });

  elements.applyAnswerButton.addEventListener("click", async () => {
    const generation = uiGeneration;
    const experiment = currentExperiment;
    elements.applyAnswerButton.disabled = true;
    try {
      await experiment.applyAnswerSignal(elements.answerInput.value);
    } catch (error) {
      if (generation === uiGeneration) updateUi({ status: error.message, error: true });
    } finally {
      if (generation === uiGeneration) elements.applyAnswerButton.disabled = false;
    }
  });

  elements.copyOfferButton.addEventListener("click", async () => {
    const generation = uiGeneration;
    try {
      await copyText(elements.offerOutput);
      if (generation === uiGeneration) updateUi({ status: "Offerをコピーしました。", error: false });
    } catch (error) {
      if (generation === uiGeneration) updateUi({ status: error.message, error: true });
    }
  });

  elements.copyAnswerButton.addEventListener("click", async () => {
    const generation = uiGeneration;
    try {
      await copyText(elements.answerOutput);
      if (generation === uiGeneration) {
        updateUi({ status: "Answerをコピーしました。相手へ渡してください。", error: false });
      }
    } catch (error) {
      if (generation === uiGeneration) updateUi({ status: error.message, error: true });
    }
  });

  elements.sendPingButton.addEventListener("click", () => currentExperiment?.sendPing());
  elements.closeButton.addEventListener("click", closeOverlay);
  elements.endButton.addEventListener("click", closeOverlay);
}

if (typeof document !== "undefined") initializeConnectionExperimentUi();

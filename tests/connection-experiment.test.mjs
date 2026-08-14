import test from "node:test";
import assert from "node:assert/strict";

import {
  PEER_CONNECTION_CONFIG,
  WebRtcConnectionExperiment,
  parseSignal,
  serializeSignal,
  waitForIceGatheringComplete,
} from "../connection-experiment.mjs";

const SESSION_ID = "abcdefghijklmnop";
const OFFER = {
  type: "offer",
  sdp: "v=0\r\na=candidate:1 1 UDP 1 192.168.1.2 5000 typ host\r\n",
};

test("WebRTC設定はICE serverを使用しない", () => {
  assert.deepEqual(PEER_CONNECTION_CONFIG, { iceServers: [] });
});

test("Offerを直列化して復元できる", () => {
  const serialized = serializeSignal("offer", SESSION_ID, OFFER);
  const parsed = parseSignal(serialized, "offer");

  assert.equal(parsed.v, 1);
  assert.equal(parsed.sid, SESSION_ID);
  assert.deepEqual(parsed.description, OFFER);
});

test("別セッションのAnswerを拒否する", () => {
  const serialized = serializeSignal("answer", SESSION_ID, {
    type: "answer",
    sdp: "v=0\r\na=candidate:2 1 UDP 1 192.168.1.3 5001 typ host\r\n",
  });

  assert.throws(
    () => parseSignal(serialized, "answer", "ponmlkjihgfedcba"),
    /別の接続実験/,
  );
});

test("種類違い・壊れたJSON・未知versionを拒否する", () => {
  const serialized = serializeSignal("offer", SESSION_ID, OFFER);
  assert.throws(() => parseSignal(serialized, "answer"), /answer/);
  assert.throws(() => parseSignal("not-json", "offer"), /読み取れません/);
  assert.throws(
    () => parseSignal(JSON.stringify({
      v: 99,
      sid: SESSION_ID,
      kind: "offer",
      description: OFFER,
    }), "offer"),
    /バージョン/,
  );
});

test("ICE Candidateを含まない接続文字列を拒否する", () => {
  const serialized = serializeSignal("offer", SESSION_ID, {
    type: "offer",
    sdp: "v=0\r\n",
  });
  assert.throws(() => parseSignal(serialized, "offer"), /ICE Candidate/);
});

test("ICE gatheringがすでにcompleteなら直ちに完了する", async () => {
  const peerConnection = new EventTarget();
  peerConnection.iceGatheringState = "complete";
  await waitForIceGatheringComplete(peerConnection, 20);
});

test("ICE gatheringのcompleteイベントを待てる", async () => {
  const peerConnection = new EventTarget();
  peerConnection.iceGatheringState = "gathering";
  const completion = waitForIceGatheringComplete(peerConnection, 100);
  peerConnection.iceGatheringState = "complete";
  peerConnection.dispatchEvent(new Event("icegatheringstatechange"));
  await completion;
});

test("開始前に中断済みなら直ちに拒否する", async () => {
  const peerConnection = new EventTarget();
  peerConnection.iceGatheringState = "gathering";
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    waitForIceGatheringComplete(peerConnection, 100, controller.signal),
    /中断/,
  );
});

test("ICE gatheringが完了しなければタイムアウトする", async () => {
  const peerConnection = new EventTarget();
  peerConnection.iceGatheringState = "gathering";
  await assert.rejects(
    waitForIceGatheringComplete(peerConnection, 20),
    /タイムアウト/,
  );
});

test("失敗時にPeerConnectionと両DataChannelを破棄する", () => {
  const updates = [];
  const experiment = new WebRtcConnectionExperiment((update) => updates.push(update));
  const closed = { peer: false, control: false, realtime: false };
  experiment.peerConnection = {
    connectionState: "failed",
    iceConnectionState: "failed",
    close() { closed.peer = true; },
  };
  experiment.controlChannel = {
    readyState: "open",
    close() { closed.control = true; },
  };
  experiment.realtimeChannel = {
    readyState: "open",
    close() { closed.realtime = true; },
  };
  experiment.connected = true;

  experiment.fail("テスト失敗");

  assert.deepEqual(closed, { peer: true, control: true, realtime: true });
  assert.equal(experiment.peerConnection, null);
  assert.equal(experiment.controlChannel, null);
  assert.equal(experiment.realtimeChannel, null);
  assert.equal(updates.at(-1).error, true);
  assert.equal(updates.at(-1).status, "テスト失敗");
});

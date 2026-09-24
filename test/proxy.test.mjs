// test/proxy.test.mjs — CONNECT 隧道代理通道:本地假代理 + 假目标,离线端到端
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { askTypeSafe, proxyPost, AgentGuardError, createPost } from "../lib/typesafe.mjs";
import { DEFAULTS } from "../lib/config.mjs";

const listen = (server) => new Promise((res) => server.listen(0, "127.0.0.1", () => res(server.address().port)));
const close = (s) => new Promise((r) => s.close(() => r()));

// 标准 HTTP 代理:CONNECT 到任意 host:port 后双向透传
function startTunnelProxy() {
  const proxy = http.createServer();
  proxy.on("connect", (rq, sock, head) => {
    assert.equal(rq.method, "CONNECT");
    const i = rq.url.lastIndexOf(":");
    const up = net.connect(Number(rq.url.slice(i + 1)), rq.url.slice(0, i), () => {
      sock.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) up.write(head);
      sock.pipe(up); up.pipe(sock);
    });
    up.on("error", () => sock.destroy());
    sock.on("error", () => up.destroy());
  });
  return proxy;
}

test("proxyPost:CONNECT 隧道完整链路,请求头/路径/请求体穿透", async () => {
  let sawBody = null;
  const target = http.createServer((rq, rs) => {
    assert.equal(rq.method, "POST");
    assert.equal(rq.url, "/v1/systemone");
    assert.equal(rq.headers.authorization, "Bearer k");
    let n = "";
    rq.on("data", (c) => (n += c));
    rq.on("end", () => {
      sawBody = JSON.parse(n);
      rs.end(JSON.stringify({ answers: { ok: 1 } }));
    });
  });
  const proxy = startTunnelProxy();
  const tp = await listen(target), pp = await listen(proxy);
  try {
    const res = await proxyPost(`http://127.0.0.1:${tp}/v1/systemone`, JSON.stringify({ model: "jev-latest" }),
      "k", 3000, { enabled: true, host: "127.0.0.1", port: pp });
    assert.deepEqual(res, { answers: { ok: 1 } });
    assert.equal(sawBody.model, "jev-latest");
  } finally { await close(proxy); await close(target); }
});

test("proxyPost:目标非 2xx → e.status 保留(分类为 service)", async () => {
  const target = http.createServer((rq, rs) => { rs.statusCode = 500; rs.end("boom"); });
  const proxy = startTunnelProxy();
  const tp = await listen(target), pp = await listen(proxy);
  try {
    await assert.rejects(proxyPost(`http://127.0.0.1:${tp}/x`, "{}", "k", 3000, { host: "127.0.0.1", port: pp }),
      (e) => e.status === 500);
  } finally { await close(proxy); await close(target); }
});

test("proxyPost:代理拒绝 CONNECT → 错误含状态行", async () => {
  const proxy = net.createServer((sock) => {
    sock.once("data", () => sock.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n"));
  });
  const pp = await listen(proxy);
  try {
    await assert.rejects(proxyPost("https://api.typesafe.ai/v1/systemone", "{}", "k", 3000, { host: "127.0.0.1", port: pp }),
      (e) => /代理拒绝 CONNECT.*403/.test(e.message));
  } finally { await close(proxy); }
});

test("proxyPost:隧道建立后对端不回包 → AbortError 超时", async () => {
  const proxy = net.createServer((sock) => {
    sock.on("data", (d) => {
      if (d.toString().startsWith("CONNECT")) sock.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    }); // 其后吞包不回,模拟黑洞
  });
  const pp = await listen(proxy);
  try {
    await assert.rejects(proxyPost("http://127.0.0.1:1/x", "{}", "k", 300, { host: "127.0.0.1", port: pp }),
      (e) => e.name === "AbortError" && /超时/.test(e.message));
  } finally { await close(proxy); }
});

test("askTypeSafe:代理连不上 → network;开关开但配置无效 → proxy_config", async () => {
  // 借用刚释放的端口保证 ECONNREFUSED,而不是赌某端口一定没人听
  const occupy = net.createServer();
  const deadPort = await listen(occupy);
  await close(occupy);
  await assert.rejects(
    askTypeSafe({}, { model: "m", proxy: { enabled: true, host: "127.0.0.1", port: deadPort } }, { apiKey: "k" }),
    (e) => e instanceof AgentGuardError && e.type === "network" && /连接代理/.test(e.message));
  await assert.rejects(
    askTypeSafe({}, { model: "m", proxy: { enabled: true, host: "", port: 0 } }, { apiKey: "k" }),
    (e) => e instanceof AgentGuardError && e.type === "proxy_config");
});

test("createPost:开关关闭时走直连 fetch,开启时走隧道", async () => {
  assert.equal(createPost(undefined), createPost({ enabled: false }));
  const tunneled = createPost({ enabled: true, host: "127.0.0.1", port: 1 });
  assert.notEqual(tunneled, createPost(undefined));
  await assert.rejects(tunneled("https://api.typesafe.ai/x", "{}", "k", 2000), (e) => /连接代理/.test(e.message));
});

test("DEFAULTS 含 proxy 且默认关闭", () => {
  assert.deepEqual(DEFAULTS.proxy, { enabled: false, host: "", port: 0 });
});

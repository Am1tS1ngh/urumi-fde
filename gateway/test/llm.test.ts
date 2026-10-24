import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { complete, LlmError } from '../src/chat/llm.js';

/** A fake provider that answers each request with the next queued response. */
async function provider(t: test.TestContext, replies: ((res: ServerResponse) => void)[]) {
  let calls = 0;
  const server = createServer((req, res) => {
    req.resume();
    replies[Math.min(calls++, replies.length - 1)]!(res);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const llm = { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, model: 'test', apiKey: 'key' };
  return { llm, calls: () => calls };
}

const limited = (retryAfter: string) => (res: ServerResponse) => res.writeHead(429, { 'retry-after': retryAfter }).end('{"error":"slow down"}');
const answer = (res: ServerResponse) => res.writeHead(200, { 'Content-Type': 'application/json' })
  .end(JSON.stringify({ choices: [{ message: { content: 'hello' } }] }));

test('waits and retries when the provider is rate limited', async t => {
  const { llm, calls } = await provider(t, [limited('0'), answer]);
  const reply = await complete(llm, [{ role: 'user', content: 'hi' }], []);
  assert.equal(reply.content, 'hello');
  assert.equal(calls(), 2);
});

test('gives up on a rate limit that asks for too long a wait, or keeps repeating', async t => {
  const long = await provider(t, [limited('120'), answer]);
  await assert.rejects(complete(long.llm, [{ role: 'user', content: 'hi' }], []), LlmError);
  assert.equal(long.calls(), 1);

  const repeating = await provider(t, [limited('0')]);
  await assert.rejects(complete(repeating.llm, [{ role: 'user', content: 'hi' }], []), /429/);
  assert.equal(repeating.calls(), 3);
});

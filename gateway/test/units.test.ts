import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { decryptSecret, encryptSecret, hashPassword, randomToken, sha256, verifyPassword } from '../src/common/crypto.js';
import { exposedName, isExposable, parseExposedName } from '../src/upstreams/tool-names.js';
import { assertSafeUpstreamUrl, isBlockedAddress } from '../src/upstreams/ssrf.js';
import { localNow } from '../src/chat/chat.service.js';

test('passwords verify only with the right password, and hashes are salted', async () => {
  const stored = await hashPassword('correct horse battery');
  assert.equal(await verifyPassword('correct horse battery', stored), true);
  assert.equal(await verifyPassword('wrong password', stored), false);
  assert.notEqual(await hashPassword('same'), await hashPassword('same'));
});

test('tokens are prefixed and unique, and their hashes are stable', () => {
  const token = randomToken('mcpk_');
  assert.match(token, /^mcpk_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(token, randomToken('mcpk_'));
  assert.equal(sha256(token), sha256(token));
});

test('encrypted secrets round-trip and reject tampering or the wrong key', () => {
  const key = randomBytes(32);
  const blob = encryptSecret('upstream-token', key);
  assert.equal(decryptSecret(blob, key), 'upstream-token');
  assert.notEqual(encryptSecret('upstream-token', key), blob);
  const parts = blob.split(':');
  const data = Buffer.from(parts[3]!, 'base64');
  data[0] = data[0]! ^ 0xff;
  parts[3] = data.toString('base64');
  assert.throws(() => decryptSecret(parts.join(':'), key));
  assert.throws(() => decryptSecret(blob, randomBytes(32)));
});

test('tool names are namespaced by server slug and split at the first separator', () => {
  assert.equal(exposedName('woo', 'list_orders'), 'woo__list_orders');
  assert.deepEqual(parseExposedName('woo__list_orders'), { slug: 'woo', tool: 'list_orders' });
  assert.deepEqual(parseExposedName('utils__a__b'), { slug: 'utils', tool: 'a__b' });
  for (const bad of ['list_orders', '__x', 'Woo__x', 'w__x', 'woo__']) assert.equal(parseExposedName(bad), null, bad);
  assert.equal(isExposable('get_order'), true);
  assert.equal(isExposable('has.dot'), false);
  assert.equal(isExposable('x'.repeat(41)), false);
});

test('private, loopback and metadata addresses are blocked', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fd00::1']) {
    assert.equal(isBlockedAddress(ip), true, ip);
  }
  assert.equal(isBlockedAddress('8.8.8.8'), false);
});

test('upstream URLs must be public unless the host is allowlisted', async () => {
  const policy = { allowPrivateUpstreams: false, upstreamAllowHosts: ['utils-mcp.urumi-platform.svc.cluster.local'] };
  for (const url of [
    'http://169.254.169.254/latest/meta-data', 'http://localhost:3000/mcp', 'http://gateway-postgres:5432',
    'http://gateway-postgres.urumi-platform.svc.cluster.local:5432', 'ftp://example.com/mcp', 'http://user:pw@example.com/mcp',
  ]) await assert.rejects(assertSafeUpstreamUrl(url, policy), url);
  assert.ok(await assertSafeUpstreamUrl('http://utils-mcp.urumi-platform.svc.cluster.local:3002/mcp', policy));
  assert.ok(await assertSafeUpstreamUrl('http://127.0.0.1:3002/mcp', { ...policy, allowPrivateUpstreams: true }));
});

test('local time uses the zone offset, so "today" in IST starts at 18:30 UTC', () => {
  assert.deepEqual(localNow('Asia/Kolkata', new Date('2026-10-23T18:29:00Z')).date, '2026-10-23');
  const after = localNow('Asia/Kolkata', new Date('2026-10-23T18:31:00Z'));
  assert.equal(after.date, '2026-10-24');
  assert.equal(after.time, '00:01');
  assert.equal(after.offset, '+05:30');
  assert.equal(localNow('UTC').offset, '+00:00');
});

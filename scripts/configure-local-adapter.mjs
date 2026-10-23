import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

try {
  const path = fileURLToPath(new URL('../.env', import.meta.url));
  let text = readFileSync(path, 'utf8');
  const env = parseEnv(text);
  if (!/^ck_[a-f0-9]{40}$/.test(env.WOOCOMMERCE_CONSUMER_KEY ?? '') ||
      !/^cs_[a-f0-9]{40}$/.test(env.WOOCOMMERCE_CONSUMER_SECRET ?? '')) {
    throw new Error('Save the generated WooCommerce consumer key and secret in .env first. Values were not displayed or changed.');
  }
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0' || process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    throw new Error('Remove NODE_TLS_REJECT_UNAUTHORIZED=0; certificate verification must remain enabled.');
  }
  const existingToken = env.MCP_UPSTREAM_TOKEN ?? '';
  const token = existingToken.length >= 32 && !/\s|replace|your-token/i.test(existingToken)
    ? existingToken : randomBytes(32).toString('hex');
  const settings = {
    WOOCOMMERCE_URL: 'https://localhost:8443',
    WOOCOMMERCE_ALLOW_HTTP: 'false',
    MCP_UPSTREAM_TOKEN: token,
  };
  for (const [name, value] of Object.entries(settings)) {
    const line = new RegExp(`^[ \\t]*${name}[ \\t]*=.*$`, 'gm');
    if (line.test(text)) text = text.replace(line, `${name}=${value}`);
    else text = `${text.trimEnd()}\n${name}=${value}\n`;
  }
  writeFileSync(path, text, { mode: 0o600 });
  console.log('Configured local HTTPS URL and adapter token. WooCommerce credentials were preserved and not displayed.');
} catch (error) {
  console.error(error instanceof Error && error.message.startsWith('ENOENT')
    ? 'Missing .env: save your WooCommerce credentials in the project root first.'
    : error instanceof Error ? error.message : 'Local adapter configuration failed.');
  process.exitCode = 1;
}

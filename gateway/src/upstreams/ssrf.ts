import { BadRequestException } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

export interface UrlPolicy {
  allowPrivateUpstreams: boolean;
  upstreamAllowHosts: string[];
}

const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.168.0.0', 16], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]] as const) {
  blocked.addSubnet(network, prefix, 'ipv6');
}

const INTERNAL_SUFFIXES = ['.localhost', '.local', '.internal', '.svc', '.cluster.local'];

export function isBlockedAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  if (mapped) return blocked.check(mapped, 'ipv4');
  const family = isIP(address);
  if (family === 4) return blocked.check(address, 'ipv4');
  if (family === 6) return blocked.check(address, 'ipv6');
  return true;
}

/**
 * Upstream URLs are typed in by admins, so they must not point the gateway at
 * internal services (the database, cloud metadata) unless explicitly allowed.
 */
export async function assertSafeUpstreamUrl(raw: string, policy: UrlPolicy): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BadRequestException('The upstream URL is not valid.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new BadRequestException('Only http and https upstream URLs are allowed.');
  if (url.username || url.password) throw new BadRequestException('Put credentials in the credential field, not in the URL.');

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (policy.allowPrivateUpstreams || policy.upstreamAllowHosts.includes(host)) return url;

  const internalName = host === 'localhost' || INTERNAL_SUFFIXES.some(suffix => host.endsWith(suffix)) || (!host.includes('.') && !isIP(host));
  if (internalName) throw new BadRequestException(`"${host}" is an internal host name and is not on the allowlist.`);

  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : (await lookup(host, { all: true, verbatim: true })).map(entry => entry.address);
  } catch {
    throw new BadRequestException(`Could not resolve "${host}".`);
  }
  if (addresses.length === 0 || addresses.some(isBlockedAddress)) {
    throw new BadRequestException(`"${host}" resolves to a private address, which is not allowed.`);
  }
  return url;
}

'use strict';
const dns = require('node:dns').promises;
const net = require('node:net');

function normalizeHttpUrl(raw) {
  let url;
  try { url = new URL(String(raw)); } catch { throw new Error('Invalid URL.'); }
  if (!['http:','https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS URLs are accepted.');
  if (url.username || url.password) throw new Error('URLs with embedded credentials are not accepted.');
  url.hash = '';
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) url.port = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_.+|fbclid|gclid|mc_cid|mc_eid)$/i.test(key)) url.searchParams.delete(key);
  }
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
  return url.href;
}

function isPublicIPv4(ip) {
  const octets = ip.split('.').map(Number);
  if (octets.length !== 4 || octets.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a,b,c] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}
function isPublicIPv6(ip) {
  const lower = ip.toLowerCase().split('%')[0];
  if (lower === '::' || lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb') || lower.startsWith('ff')) return false;
  const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPublicIPv4(mapped[1]);
  // Only globally scoped IPv6 unicast addresses are allowed; common global prefix is 2000::/3.
  const first = parseInt(lower.split(':')[0] || '0', 16);
  return first >= 0x2000 && first <= 0x3fff;
}
function isPublicIp(ip) {
  const version = net.isIP(ip);
  return version === 4 ? isPublicIPv4(ip) : version === 6 ? isPublicIPv6(ip) : false;
}
function normalizeHostname(hostname) {
  return String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}
async function resolvePublicHost(hostname) {
  const host = normalizeHostname(hostname);
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.test') || host.endsWith('.invalid') || host === 'metadata.google.internal') {
    throw new Error('Local and reserved hostnames are not allowed.');
  }
  const literal = net.isIP(host);
  const addresses = literal ? [{address:host,family:literal}] : await dns.lookup(host, {all:true,verbatim:true});
  if (!addresses.length || addresses.some(item => !isPublicIp(item.address))) {
    throw new Error('The URL resolves to a private, local or reserved IP address.');
  }
  return addresses;
}
async function validatePublicHttpUrl(raw) {
  const parsed = new URL(String(raw));
  if (!['http:','https:'].includes(parsed.protocol)) throw new Error('Only HTTP and HTTPS URLs can be fetched.');
  if (parsed.username || parsed.password) throw new Error('URLs with credentials are not allowed.');
  if (parsed.port && !/^\d+$/.test(parsed.port)) throw new Error('Invalid port.');
  const port = parsed.port ? Number(parsed.port) : (parsed.protocol === 'https:' ? 443 : 80);
  if (port < 1 || port > 65535) throw new Error('Invalid port.');
  const hostname = normalizeHostname(parsed.hostname);
  const addresses = await resolvePublicHost(hostname);
  return {url:parsed,hostname,port,addresses};
}
module.exports = { normalizeHttpUrl, normalizeHostname, isPublicIPv4, isPublicIPv6, isPublicIp, resolvePublicHost, validatePublicHttpUrl };

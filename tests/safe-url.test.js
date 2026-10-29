'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {normalizeHttpUrl,isPublicIp,validatePublicHttpUrl}=require('../lib/safe-url');

test('normalizes equivalent feed URLs',()=>{
  const a=normalizeHttpUrl('https://www.SmashingMagazine.com/feed/?utm_source=demo#section');
  const b=normalizeHttpUrl('https://smashingmagazine.com/feed');
  assert.equal(a,b);
});
test('rejects non HTTP schemes and embedded credentials',()=>{
  assert.throws(()=>normalizeHttpUrl('file:///etc/passwd'),/HTTP and HTTPS/);
  assert.throws(()=>normalizeHttpUrl('https://user:pass@example.com/feed'),/credentials/);
});
test('private and reserved IPv4/IPv6 ranges are denied',()=>{
  for(const ip of ['127.0.0.1','10.1.2.3','172.16.0.1','192.168.1.1','169.254.169.254','100.64.0.1','224.0.0.1','::1','fc00::1','fe80::1','::ffff:127.0.0.1'])assert.equal(isPublicIp(ip),false,ip);
  assert.equal(isPublicIp('8.8.8.8'),true);
  assert.equal(isPublicIp('2606:4700:4700::1111'),true);
});
test('proxy validator rejects localhost and loopback before network access',async()=>{
  await assert.rejects(()=>validatePublicHttpUrl('http://127.0.0.1/admin'),/private|reserved/i);
  await assert.rejects(()=>validatePublicHttpUrl('http://localhost/'),/localhost|reserved/i);
});

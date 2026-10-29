'use strict';
const crypto=require('node:crypto');
const {fetchPublicRaw}=require('../lib/raw-proxy');

// Best-effort per-warm-instance proxy throttling; only ephemeral hashes are kept in memory.
const proxySalt=crypto.randomBytes(32);
const proxyBuckets=new Map();
function proxyAllowed(req){
  const raw=String(req.headers?.['x-vercel-forwarded-for']||req.headers?.['x-real-ip']||String(req.headers?.['x-forwarded-for']||'').split(',')[0]||req.socket?.remoteAddress||'unknown').trim().slice(0,128);
  const key=crypto.createHash('sha256').update(proxySalt).update(raw).digest('hex');
  const now=Date.now();let bucket=proxyBuckets.get(key);
  if(!bucket||now-bucket.start>=60000)bucket={start:now,count:0};
  bucket.count++;proxyBuckets.set(key,bucket);
  if(proxyBuckets.size>5000){for(const [k,v] of proxyBuckets)if(now-v.start>60000)proxyBuckets.delete(k);}
  return bucket.count<=90;
}

module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  if(req.method==='OPTIONS'){res.statusCode=204;res.setHeader('Allow','GET, OPTIONS');res.end();return;}
  if(req.method!=='GET'){res.statusCode=405;res.setHeader('Allow','GET');res.end('Method not allowed');return;}
  if(!proxyAllowed(req)){res.statusCode=429;res.setHeader('Content-Type','text/plain; charset=utf-8');res.end('Proxy rate limit reached. Try again shortly.');return;}
  let target;
  try{const requestUrl=new URL(req.url,'http://local.invalid');target=requestUrl.searchParams.get('url');if(!target)throw new Error('The url query parameter is required.');}
  catch(error){res.statusCode=400;res.setHeader('Content-Type','text/plain; charset=utf-8');res.end(error.message||'Invalid URL.');return;}
  try{
    const headers={};
    const etag=req.headers?.['if-none-match'];const modified=req.headers?.['if-modified-since'];
    if(etag)headers['If-None-Match']=String(etag).slice(0,512);
    if(modified)headers['If-Modified-Since']=String(modified).slice(0,128);
    const result=await fetchPublicRaw(target,headers);
    const contentType=String(result.headers['content-type']||'application/octet-stream').slice(0,180);
    res.statusCode=result.status;
    res.setHeader('Content-Type',contentType);
    for(const name of ['etag','last-modified','cache-control','expires'])if(result.headers[name])res.setHeader(name,result.headers[name]);
    // Fetch clients still receive the original bytes and content-type. Direct navigation to an untrusted HTML
    // response downloads it instead of executing it inside the reader's own origin.
    if(/text\/html|application\/xhtml\+xml|application\/(?:rss|atom)\+xml|(?:text|application)\/xml/i.test(contentType)){
      res.setHeader('Content-Disposition','attachment; filename="proxied-response.txt"');
      res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox; base-uri 'none'; form-action 'none'");
    }
    if(result.status!==304)res.end(result.body);else res.end();
  }catch(error){
    const status=/private|local and reserved|credentials|only http|invalid url|invalid port|too many redirects/i.test(error.message)?400:/timed out/i.test(error.message)?504:/exceeded the 5 MB limit/i.test(error.message)?413:502;
    res.statusCode=status;res.setHeader('Content-Type','text/plain; charset=utf-8');res.end(error.message||'The upstream request failed.');
  }
};

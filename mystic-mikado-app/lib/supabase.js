'use strict';

function getConfig() {
  const url=String(process.env.SUPABASE_URL||'').replace(/\/$/,'');
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
  if(!url||!key) return null;
  return {url,key};
}
function isConfigured(){return Boolean(getConfig());}
async function supabaseRequest(path, options={}) {
  const config=getConfig();
  if(!config) throw new Error('Discovery database is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  const response=await fetch(`${config.url}/rest/v1/${path}`,{
    method:options.method||'GET',
    headers:{apikey:config.key,Authorization:`Bearer ${config.key}`,'Content-Type':'application/json',Accept:'application/json',...(options.headers||{})},
    body:options.body===undefined?undefined:JSON.stringify(options.body),
    signal:AbortSignal.timeout(9000)
  });
  const text=await response.text();
  let payload=null;try{payload=text?JSON.parse(text):null;}catch{payload=text;}
  if(!response.ok){const message=payload&&typeof payload==='object'?(payload.message||payload.error||payload.hint):payload;throw new Error(`Discovery database error (${response.status}): ${message||'request failed'}`);}
  return {data:payload,response};
}
function json(res,status,payload,headers={}) {
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  Object.entries(headers).forEach(([k,v])=>res.setHeader(k,v));
  res.end(JSON.stringify(payload));
}
function getClientIp(req) {
  // Vercel supplies the connecting IP in x-real-ip; use only the first forwarding hop as a fallback.
  const raw=req.headers?.['x-vercel-forwarded-for']||req.headers?.['x-real-ip']||String(req.headers?.['x-forwarded-for']||'').split(',')[0]||'unknown';
  return String(raw).trim().slice(0,128)||'unknown';
}
const crypto=require('node:crypto');
function hashIp(ip) {
  const salt=process.env.IP_HASH_SALT;
  if(!salt) throw new Error('IP_HASH_SALT is required for abuse protection.');
  return crypto.createHash('sha256').update(`${salt}:${ip}`).digest('hex');
}
function secret() {
  const value=process.env.DISCOVERY_TOKEN_SECRET;
  if(!value||value.length<32) throw new Error('DISCOVERY_TOKEN_SECRET must be configured with at least 32 characters.');
  return value;
}
async function rateLimit(req, maxCount=20, windowSeconds=3600) {
  const hash=hashIp(getClientIp(req));
  const result=await supabaseRequest('rpc/try_consume_rate_limit',{method:'POST',body:{p_ip_hash:hash,p_limit:maxCount,p_window_seconds:windowSeconds}});
  return result.data===true;
}
function parseRequestBody(req,maxBytes=20000) {
  return new Promise((resolve,reject)=>{
    if(req.body && typeof req.body==='object') {resolve(req.body);return;}
    if(typeof req.body==='string') {try{resolve(req.body?JSON.parse(req.body):{});}catch{reject(new Error('Request body must be valid JSON.'));}return;}
    let data='';
    req.on('data',chunk=>{data+=chunk;if(data.length>maxBytes){reject(new Error('Request body too large.'));req.destroy();}});
    req.on('end',()=>{try{resolve(data?JSON.parse(data):{});}catch{reject(new Error('Request body must be valid JSON.'));}});
    req.on('error',reject);
  });
}
module.exports={getConfig,isConfigured,supabaseRequest,json,getClientIp,hashIp,secret,rateLimit,parseRequestBody};

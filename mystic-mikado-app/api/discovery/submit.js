'use strict';
const crypto=require('node:crypto');
const {normalizeHttpUrl,resolvePublicHost,normalizeHostname}=require('../../lib/safe-url');
const {supabaseRequest,json,secret,rateLimit,parseRequestBody}=require('../../lib/supabase');

function checkSignature(token){
  if(typeof token!=='string')throw new Error('A one-time discovery token is required.');
  const parts=token.split('.');if(parts.length!==3)throw new Error('Invalid discovery token.');
  const [nonce,expiresRaw,signature]=parts;const expires=Number(expiresRaw);
  if(!nonce||!Number.isInteger(expires)||expires*1000<Date.now())throw new Error('The discovery token expired. Request a new one.');
  const expected=crypto.createHmac('sha256',secret()).update(`${nonce}.${expires}`).digest();
  let actual;try{actual=Buffer.from(signature,'base64url');}catch{throw new Error('Invalid discovery token signature.');}
  if(actual.length!==expected.length||!crypto.timingSafeEqual(actual,expected))throw new Error('Invalid discovery token signature.');
  return {nonce,expires};
}
async function validateFeedUrls(rawFeeds){
  if(!Array.isArray(rawFeeds)||rawFeeds.length<1||rawFeeds.length>100)throw new Error('Submit between 1 and 100 feed URLs per batch.');
  const normalized=[...new Set(rawFeeds.map(normalizeHttpUrl))];
  if(normalized.length>100)throw new Error('Batch too large.');
  for(const raw of normalized){
    const parsed=new URL(raw);
    if([...parsed.searchParams.keys()].some(key=>/(?:token|secret|password|passwd|session|auth|api[-_]?key|access[-_]?token)/i.test(key)))
      throw new Error('A feed URL appears to contain a secret query parameter and cannot be shared.');
  }
  const hosts=[...new Set(normalized.map(url=>normalizeHostname(new URL(url).hostname)))];
  // Resolve each unique host once and reject every private/reserved result before aggregation.
  for(let i=0;i<hosts.length;i+=10){
    const group=hosts.slice(i,i+10);
    await Promise.all(group.map(host=>resolvePublicHost(host)));
  }
  return normalized;
}
module.exports=async function handler(req,res){
  if(req.method!=='POST'){json(res,405,{error:'Use POST to share an anonymous batch.'},{Allow:'POST'});return;}
  try{
    const body=await parseRequestBody(req,25000);
    const feeds=await validateFeedUrls(body.feeds);
    const {nonce}=checkSignature(body.token);
    if(!(await rateLimit(req,20,3600))){json(res,429,{error:'Submission rate limit reached. Try again later.'});return;}
    const nonceHash=crypto.createHash('sha256').update(nonce).digest('hex');
    const now=new Date().toISOString();
    const filters=new URLSearchParams({nonce_hash:`eq.${nonceHash}`,used_at:'is.null',expires_at:`gt.${now}`,select:'nonce_hash'}).toString();
    const consumed=await supabaseRequest(`submission_tokens?${filters}`,{method:'PATCH',body:{used_at:now},headers:{Prefer:'return=representation'}});
    if(!Array.isArray(consumed.data)||consumed.data.length!==1){json(res,409,{error:'This token was already used or expired. Request a fresh token.'});return;}
    await supabaseRequest('rpc/submit_anonymous_batch',{method:'POST',body:{p_urls:feeds}});
    json(res,200,{accepted:feeds.length,uniqueNormalized:feeds.length,message:'Anonymous aggregate updated. No batch history or reader ID was stored.'});
  }catch(error){
    const message=error.message||'Submission failed.';
    const status=/token|expired|signature/i.test(message)?400:/between 1 and 100|batch too large|only HTTP|Invalid URL|credentials|secret query|private|reserved|localhost|local and reserved|resolves to/i.test(message)?400:/rate limit/i.test(message)?429:/not configured|required|must be configured/i.test(message)?503:/request body|valid JSON/i.test(message)?400:500;
    json(res,status,{error:status===500?'Anonymous sharing could not be saved. Please try again later.':message});
  }
};

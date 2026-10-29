'use strict';
const crypto=require('node:crypto');
const {supabaseRequest,json,secret,rateLimit}=require('../../lib/supabase');

module.exports=async function handler(req,res){
  if(req.method!=='POST'){json(res,405,{error:'Use POST to request a one-time discovery token.'},{Allow:'POST'});return;}
  try{
    // The IP itself is never written to the database: only a salted SHA-256 hash is stored.
    const allowed=await rateLimit(req,20,3600);
    if(!allowed){json(res,429,{error:'Too many discovery token requests. Try again later.'});return;}
    // Clean expired pseudonymous safety records after checking the request budget.
    const cleanupAt=encodeURIComponent(new Date().toISOString());
    await supabaseRequest(`ip_rate_limits?expires_at=lt.${cleanupAt}`,{method:'DELETE',headers:{Prefer:'return=minimal'}}).catch(()=>{});
    await supabaseRequest(`submission_tokens?expires_at=lt.${cleanupAt}`,{method:'DELETE',headers:{Prefer:'return=minimal'}}).catch(()=>{});
    const nonce=crypto.randomBytes(24).toString('base64url');
    const expiresAt=Math.floor(Date.now()/1000)+90;
    const signed=`${nonce}.${expiresAt}`;
    const signature=crypto.createHmac('sha256',secret()).update(signed).digest('base64url');
    const nonceHash=crypto.createHash('sha256').update(nonce).digest('hex');
    await supabaseRequest('submission_tokens',{method:'POST',body:{nonce_hash:nonceHash,expires_at:new Date(expiresAt*1000).toISOString(),used_at:null},headers:{Prefer:'return=minimal'}});
    json(res,200,{token:`${nonce}.${expiresAt}.${signature}`,expiresInSeconds:90});
  }catch(error){
    const status=/not configured|required|must be configured/i.test(error.message)?503:500;
    json(res,status,{error:status===503?'Anonymous discovery is not configured yet. Follow feeds locally, or configure Supabase for opt-in sharing.':'Could not issue a one-time discovery token.'});
  }
};

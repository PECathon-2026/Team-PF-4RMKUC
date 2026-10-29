'use strict';
const {normalizeHttpUrl}=require('../../lib/safe-url');
const {supabaseRequest,json,parseRequestBody}=require('../../lib/supabase');
module.exports=async function handler(req,res){
  if(req.method!=='POST'){json(res,405,{error:'Use POST and provide the feed URLs you already follow.'},{Allow:'POST'});return;}
  try{
    const body=await parseRequestBody(req,25000);
    if(!Array.isArray(body.feeds)||body.feeds.length>100)throw new Error('Provide at most 100 followed feed URLs.');
    const feeds=[...new Set(body.feeds.map(normalizeHttpUrl))];
    const limit=Math.max(1,Math.min(20,Number(body.limit)||10));
    const result=await supabaseRequest('rpc/get_recommendations',{method:'POST',body:{p_urls:feeds,p_limit:limit}});
    json(res,200,{recommendations:Array.isArray(result.data)?result.data:[]});
  }catch(error){const status=/not configured|required|must be configured/i.test(error.message)?503:/Provide at most|Only HTTP|Invalid URL|credentials/i.test(error.message)?400:500;json(res,status,{error:status===500?'Recommendations could not be loaded.':error.message});}
};

'use strict';
const {supabaseRequest,json}=require('../../lib/supabase');
module.exports=async function handler(req,res){
  if(req.method!=='GET'){json(res,405,{error:'Use GET to read popular feeds.'},{Allow:'GET'});return;}
  try{
    const url=new URL(req.url,'http://local.invalid');
    const requested=Number(url.searchParams.get('limit')||12);const limit=Math.max(1,Math.min(30,Number.isFinite(requested)?requested:12));
    const result=await supabaseRequest('rpc/get_popular_feeds',{method:'POST',body:{p_limit:limit}});
    json(res,200,{feeds:Array.isArray(result.data)?result.data:[]});
  }catch(error){const status=/not configured|required|must be configured/i.test(error.message)?503:500;json(res,status,{error:status===500?'Popular feeds could not be loaded.':error.message});}
};

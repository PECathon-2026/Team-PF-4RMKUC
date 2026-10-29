'use strict';
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const { validatePublicHttpUrl } = require('./safe-url');

const MAX_BYTES=5*1024*1024;
const MAX_REDIRECTS=4;
const TIMEOUT_MS=11500;

function requestOnce(validated,headers={}) {
  const {url,hostname,port,addresses}=validated;
  const protocol=url.protocol;
  const chosen=addresses[0];
  const lookup=(host,options,callback)=>{
    if(options&&options.all) callback(null,addresses.map(item=>({address:item.address,family:item.family})));
    else callback(null,chosen.address,chosen.family);
  };
  const agent=protocol==='https:'?new https.Agent({keepAlive:false,lookup}):new http.Agent({keepAlive:false,lookup});
  return new Promise((resolve,reject)=>{
    let settled=false;
    const done=(err,value)=>{if(settled)return;settled=true;agent.destroy();err?reject(err):resolve(value);};
    const request=(protocol==='https:'?https:http).request({
      protocol,hostname,port,path:`${url.pathname||'/'}${url.search||''}`,method:'GET',agent,lookup,
      servername:net.isIP(hostname)?undefined:hostname,
      headers:{'User-Agent':'MysticMikadoFeedReader/1.0','Accept':'application/atom+xml, application/rss+xml, application/xml, text/xml, text/html, text/plain, image/*, */*;q=0.7','Accept-Encoding':'identity',...headers}
    },response=>{
      const status=response.statusCode||502;
      const responseHeaders=response.headers;
      if([301,302,303,307,308].includes(status)&&responseHeaders.location){response.resume();done(null,{status,headers:responseHeaders,body:Buffer.alloc(0),redirect:responseHeaders.location});return;}
      if(status===304){response.resume();done(null,{status,headers:responseHeaders,body:Buffer.alloc(0)});return;}
      const chunks=[];let size=0;
      response.on('data',chunk=>{
        size+=chunk.length;
        if(size>MAX_BYTES){request.destroy(new Error('The upstream response exceeded the 5 MB limit.'));response.destroy();done(new Error('The upstream response exceeded the 5 MB limit.'));return;}
        chunks.push(chunk);
      });
      response.on('end',()=>done(null,{status,headers:responseHeaders,body:Buffer.concat(chunks,size)}));
      response.on('error',err=>done(err));
    });
    request.setTimeout(TIMEOUT_MS,()=>request.destroy(new Error('The upstream server timed out.')));
    request.on('error',err=>done(err));
    request.end();
  });
}
async function fetchPublicRaw(rawUrl,conditionalHeaders={}) {
  let current=String(rawUrl||'');
  for(let redirects=0;redirects<=MAX_REDIRECTS;redirects++){
    const validated=await validatePublicHttpUrl(current);
    const result=await requestOnce(validated,conditionalHeaders);
    if(!result.redirect)return result;
    if(redirects===MAX_REDIRECTS)throw new Error('Too many redirects.');
    current=new URL(result.redirect,validated.url).href;
  }
  throw new Error('Could not fetch this URL.');
}
module.exports={fetchPublicRaw,MAX_BYTES,MAX_REDIRECTS};

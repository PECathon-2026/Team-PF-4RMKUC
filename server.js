'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {URL}=require('node:url');

// Tiny local runner; production on Vercel uses the same handlers as serverless functions.
function loadDotEnv(){
  const file=path.join(__dirname,'.env');if(!fs.existsSync(file))return;
  for(const line of fs.readFileSync(file,'utf8').split(/\r?\n/)){
    const match=line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);if(!match||match[1] in process.env)continue;
    process.env[match[1]]=match[2].replace(/^['"]|['"]$/g,'');
  }
}
loadDotEnv();
const staticRoot=fs.existsSync(path.join(__dirname,'dist','index.html'))?path.join(__dirname,'dist'):__dirname;
const routes={
  '/api/fetch':require('./api/fetch'),
  '/api/discovery/token':require('./api/discovery/token'),
  '/api/discovery/submit':require('./api/discovery/submit'),
  '/api/discovery/recommendations':require('./api/discovery/recommendations'),
  '/api/discovery/popular':require('./api/discovery/popular')
};
const assets={
  '/':'index.html','/index.html':'index.html','/app.js':'app.js','/style.css':'style.css',
  '/dragon-art.webp':'dragon-art.webp','/sw.js':'sw.js','/manifest.webmanifest':'manifest.webmanifest'
};
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webp':'image/webp','.webmanifest':'application/manifest+json; charset=utf-8'};
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  const route=routes[url.pathname];
  if(route){try{await route(req,res);}catch(error){if(!res.headersSent){res.statusCode=500;res.setHeader('Content-Type','text/plain; charset=utf-8');res.end('Internal server error.');}}return;}
  const name=assets[url.pathname];
  if(!name){res.statusCode=404;res.setHeader('Content-Type','text/plain; charset=utf-8');res.end('Not found');return;}
  const file=path.join(staticRoot,name);
  fs.readFile(file,(error,buffer)=>{
    if(error){res.statusCode=404;res.end('Not found');return;}
    res.statusCode=200;res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
    if(name==='sw.js')res.setHeader('Cache-Control','no-cache');
    else res.setHeader('Cache-Control','public, max-age=300');
    res.end(buffer);
  });
});
const port=Number(process.env.PORT||3000);
server.listen(port,()=>process.stdout.write(`Mystic Mikado running at http://localhost:${port}\n`));

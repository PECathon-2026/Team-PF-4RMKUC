'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');const output=path.join(root,'dist');
fs.rmSync(output,{recursive:true,force:true});fs.mkdirSync(output,{recursive:true});
for(const file of ['index.html','app.js','style.css','dragon-art.webp','sw.js','manifest.webmanifest'])fs.copyFileSync(path.join(root,file),path.join(output,file));
process.stdout.write(`Copied ${6} static assets to dist/.\n`);

/* Mystic Mikado — offline-first RSS/Atom reader. No analytics, accounts or third-party runtime scripts. */
'use strict';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const APP_DB = 'mystic-mikado-reader';
const APP_DB_VERSION = 1;
const MAX_POSTS_PER_FEED = 160;
const FETCH_TIMEOUT_MS = 12000;
let dbPromise;
let state = {
  subscriptions: [], posts: [], selectedFeed: '', filter: 'all', query: '', oldestFirst: false,
  currentPostId: null, fontSize: 1.05, currentView: 'timeline', refreshBusy: false,
  refreshStarted: 0, demo: false
};
let readerRequestSequence = 0;
const cached = new Set();

const SEED_FEEDS = [
  {url:'https://www.nasa.gov/rss/dyn/breaking_news.rss', title:'NASA Breaking News', description:'Spaceflight, missions and discoveries from NASA.', category:'Science'},
  {url:'https://feeds.arstechnica.com/arstechnica/index', title:'Ars Technica', description:'Technology, science, policy and computing.', category:'Technology'},
  {url:'https://www.theverge.com/rss/index.xml', title:'The Verge', description:'Technology, culture and the future.', category:'Technology'},
  {url:'https://hnrss.org/frontpage', title:'Hacker News — Front Page', description:'Technology and startup stories shared by the community.', category:'Technology'},
  {url:'https://xkcd.com/atom.xml', title:'xkcd', description:'A webcomic of romance, sarcasm, math and language.', category:'Comics'},
  {url:'https://www.smashingmagazine.com/feed/', title:'Smashing Magazine', description:'Practical articles for designers and developers.', category:'Design'},
  {url:'https://smashingmagazine.com/feed', title:'Smashing Magazine · alias test', description:'An intentional duplicate URL variant; normalization collapses it.', category:'Design'},
  {url:'https://hacks.mozilla.org/feed/', title:'Mozilla Hacks', description:'Web platform news and developer ideas.', category:'Development'},
  {url:'https://blog.cloudflare.com/rss/', title:'The Cloudflare Blog', description:'Internet infrastructure, security and performance.', category:'Technology'},
  {url:'https://github.blog/feed/', title:'The GitHub Blog', description:'Software, open source and developer workflows.', category:'Development'},
  {url:'https://css-tricks.com/feed/', title:'CSS-Tricks', description:'CSS, frontend engineering and web craft.', category:'Development'},
  {url:'https://feeds.bbci.co.uk/news/rss.xml', title:'BBC News', description:'World reporting and current affairs.', category:'News'},
  {url:'https://feeds.npr.org/1001/rss.xml', title:'NPR News', description:'News and public-interest reporting.', category:'News'},
  {url:'https://www.reddit.com/r/programming/.rss', title:'Reddit · r/programming', description:'Community-shared programming discussions.', category:'Community'},
  {url:'https://www.quantamagazine.org/feed/', title:'Quanta Magazine', description:'Mathematics, physics, computer science and life sciences.', category:'Science'}
];

const DEMO_FEED = {
  url: 'demo://mystic-dispatch', title: 'Mystic Dispatch · sample', homeUrl: '', siteUrl: '',
  addedAt: 0, demo: true, error: '', lastFetch: 0
};
const demoPosts = [
  ['Why I keep a paper calendar',1,'A calendar on the wall shows the whole month at once, and nothing on it can send a notification. Every plan is visible, so every promise has weight.','Try it for one season. You will notice which commitments you would quietly have deleted.'],
  ['The slow web, one blog at a time',4,'Following a blog directly means no ranking, no ads and no tracking. You choose who speaks, and they speak when they have something to say.','Discovery is the hard part, which is why overlap between readers is such a gentle way to find new voices.'],
  ['Notes on writing in the margins',12,'Marginalia turns a book into a conversation. The best notes are short, disagreeable and dated.','Years later they read like letters from a stranger who happens to be you.'],
  ['Mending a bowl, mending a habit',2,'Kintsugi joins broken pottery with lacquer and gold, so the repair becomes part of the story.','A broken streak works the same way: resume without hiding the gap, and the habit grows stronger at the seam.'],
  ['Gold in the cracks: a field guide',8,'Look for repairs in old tea bowls. Thick seams mean a hard fall, and thin ones mean patient hands.','Value the object more for its history, not less.'],
  ['What repair teaches about software',20,'The best codebases are mended, not rewritten. Each fix is a visible seam that records what went wrong.','Hide your scars and you will meet the same bug twice.'],
  ['A morning with a single matcha',5,'Whisk in a zigzag until the surface foams, then drink it while it is still bright. Nothing else is needed.','Ten quiet minutes can reorder an entire day.'],
  ['Tide tables for people who hate alarms',15,'The sea keeps better time than a phone. Plan walks around the tide and the hours begin to breathe.','Low water uncovers things you did not know were there.'],
  ['Small rituals that survive busy weeks',30,'Choose a ritual so small it cannot be skipped: one cup, one page, one breath at the window.','Big routines collapse under pressure, while small ones simply continue.'],
  ['Building a reading lamp from scrap',3,'Paper, a bamboo frame and a warm bulb are enough for a lamp that makes any corner feel like a library.','Diffuse light is kinder to tired eyes than a bright, bare bulb.'],
  ['The case for offline-first apps',10,'An app that works without a connection respects your time on trains, in basements and in the mountains.','Cache what you read, sync when you can, and never show a spinner for something you already have.'],
  ['Seasons of a blog: spring to winter',40,'Blogs bloom, go quiet and return. A silent month is not a death but a winter.','Subscribe anyway. The good ones come back.']
].map((p,i) => ({
  id:`demo:${i+1}`, feedUrl:DEMO_FEED.url, feedTitle:DEMO_FEED.title, title:p[0], link:'',
  published:Date.now()-p[1]*86400000, summary:`<p>${p[2]}</p><p>${p[3]}</p>`, author:'Mystic Mikado',
  read:0, star:0, demo:true, articleHtml:`<p>${escapeHtml(p[2])}</p><p>${escapeHtml(p[3])}</p>`,
  articleText:`${p[2]} ${p[3]}`
}));

/* ---------- Local persistence: IndexedDB stores subscriptions, posts, articles and small metadata. ---------- */
function openDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('IndexedDB is unavailable in this browser.')); return; }
    const request = indexedDB.open(APP_DB, APP_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('subscriptions')) db.createObjectStore('subscriptions', {keyPath:'url'});
      if (!db.objectStoreNames.contains('posts')) {
        const store = db.createObjectStore('posts', {keyPath:'id'});
        store.createIndex('feedUrl','feedUrl',{unique:false});
        store.createIndex('published','published',{unique:false});
      }
      if (!db.objectStoreNames.contains('articles')) db.createObjectStore('articles', {keyPath:'url'});
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', {keyPath:'key'});
    };
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onerror = () => reject(request.error || new Error('Could not open local storage.'));
  });
  return dbPromise;
}
async function idbGetAll(storeName) {
  const db = await openDatabase();
  return new Promise((resolve,reject) => {
    const req = db.transaction(storeName,'readonly').objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []); req.onerror = () => reject(req.error);
  });
}
async function idbGet(storeName,key) {
  const db = await openDatabase();
  return new Promise((resolve,reject) => {
    const req = db.transaction(storeName,'readonly').objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result || null); req.onerror = () => reject(req.error);
  });
}
async function idbPut(storeName,value) {
  const db = await openDatabase();
  return new Promise((resolve,reject) => {
    const tx = db.transaction(storeName,'readwrite'); tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve(true); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('Save aborted'));
  });
}
async function idbBulkPut(storeName,values) {
  if (!values.length) return;
  const db = await openDatabase();
  return new Promise((resolve,reject) => {
    const tx = db.transaction(storeName,'readwrite'), store = tx.objectStore(storeName);
    values.forEach(value => store.put(value));
    tx.oncomplete = () => resolve(true); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('Save aborted'));
  });
}
async function idbDelete(storeName,key) {
  const db = await openDatabase();
  return new Promise((resolve,reject) => {
    const tx=db.transaction(storeName,'readwrite');tx.objectStore(storeName).delete(key);
    tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error);
  });
}
async function metaSet(key,value) { await idbPut('meta',{key,value}); }
async function metaGet(key, fallback=null) { const row=await idbGet('meta',key);return row?row.value:fallback; }

/* ---------- Safe URL helpers and same-origin raw-response proxy. ---------- */
function normalizeUrl(raw) {
  const url = new URL(String(raw).trim());
  if (!['http:','https:'].includes(url.protocol)) throw new Error('Only http:// and https:// blog URLs are supported.');
  if (url.username || url.password) throw new Error('URLs containing usernames or passwords are not supported.');
  url.hash = '';
  url.hostname = url.hostname.toLowerCase().replace(/^www\./,'');
  if ((url.protocol==='https:'&&url.port==='443')||(url.protocol==='http:'&&url.port==='80')) url.port='';
  for (const k of [...url.searchParams.keys()]) if (/^(utm_.+|fbclid|gclid|mc_cid|mc_eid)$/i.test(k)) url.searchParams.delete(k);
  if (url.pathname.length>1) url.pathname=url.pathname.replace(/\/+$/,'');
  return url.href;
}
function safeSiteUrl(raw) {
  const url = new URL(String(raw).trim());
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw new Error('Enter a valid public website URL beginning with http:// or https://.');
  return url.href;
}
async function proxyFetch(rawUrl, options={}) {
  const url = safeSiteUrl(rawUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout || FETCH_TIMEOUT_MS);
  const headers = {};
  if (options.etag) headers['If-None-Match'] = options.etag;
  if (options.lastModified) headers['If-Modified-Since'] = options.lastModified;
  try {
    return await fetch(`/api/fetch?url=${encodeURIComponent(url)}`, {method:'GET',headers,signal:controller.signal,cache:'no-store'});
  } finally { clearTimeout(timer); }
}
function parseXml(text) {
  const doc = new DOMParser().parseFromString(text,'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('This feed contains malformed XML.');
  return doc;
}
function localName(node) { return (node && (node.localName || node.nodeName || '')).toLowerCase().split(':').pop(); }
function directChild(parent,names) {
  const set = new Set(Array.isArray(names)?names:[names]);
  return [...(parent?.children||[])].find(child => set.has(localName(child))) || null;
}
function descendants(parent,name) { return [...(parent?.getElementsByTagName('*')||[])].filter(el => localName(el)===name); }
function childText(parent,names) {
  const node = directChild(parent,Array.isArray(names)?names:[names]);
  return node ? (node.textContent||'').trim() : '';
}
function xmlNodeHtml(parent, names) {
  const preferred = Array.isArray(names)?names:[names];
  const node = preferred.map(name => directChild(parent,name)).find(Boolean) || null;
  if (!node) return '';
  if (localName(node)==='content' && node.getAttribute('type')==='xhtml') return [...node.childNodes].map(n=>new XMLSerializer().serializeToString(n)).join('');
  return (node.textContent||'').trim();
}
function stripMarkup(value) {
  if (!value) return '';
  try { const doc = new DOMParser().parseFromString(`<body>${String(value)}</body>`,'text/html'); return (doc.body.textContent||'').replace(/\s+/g,' ').trim(); }
  catch { return String(value).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim(); }
}
function pickAtomLink(entry, baseUrl) {
  const links = [...entry.children].filter(x => localName(x)==='link');
  const candidate = links.find(x => !x.getAttribute('rel') || x.getAttribute('rel')==='alternate') || links[0];
  const raw = candidate?.getAttribute('href') || candidate?.textContent || '';
  if (!raw) return '';
  try { const u = new URL(raw,baseUrl); return ['http:','https:'].includes(u.protocol)?u.href:''; } catch { return ''; }
}
function parseFeed(xml, feedUrl) {
  const doc = parseXml(xml);
  const root = doc.documentElement;
  const rootName = localName(root);
  let entries=[], title='';
  if (rootName==='rss' || rootName==='rdf') {
    const channel = descendants(root,'channel')[0] || root;
    title = childText(channel,'title') || new URL(feedUrl).hostname;
    entries = descendants(root,'item');
  } else if (rootName==='feed') {
    title = childText(root,'title') || new URL(feedUrl).hostname;
    entries = descendants(root,'entry');
  } else if (descendants(root,'item').length) {
    title = childText(descendants(root,'channel')[0]||root,'title') || new URL(feedUrl).hostname;
    entries = descendants(root,'item');
  } else if (descendants(root,'entry').length) {
    title = childText(root,'title') || new URL(feedUrl).hostname;
    entries = descendants(root,'entry');
  } else {
    throw new Error('The response is not a recognizable RSS or Atom feed.');
  }
  const parsed=[];
  for (const entry of entries.slice(0,MAX_POSTS_PER_FEED)) {
    const entryTitle = childText(entry,'title') || 'Untitled article';
    const guid = childText(entry,['guid','id']);
    const rawLink = childText(entry,'link');
    const link = rootName==='feed' || directChild(entry,'link')?.getAttribute('href') ? pickAtomLink(entry,feedUrl) : safeLink(rawLink || guid,feedUrl);
    const dateRaw = childText(entry,['pubdate','published','updated','date','issued','modified']);
    const published = dateRaw && Number.isFinite(Date.parse(dateRaw)) ? Date.parse(dateRaw) : Date.now();
    let summary = xmlNodeHtml(entry,['encoded','content','description','summary']);
    if (!summary) summary = `<p>${escapeHtml(entryTitle)}</p>`;
    const authorNode = directChild(entry,'author');
    const author = authorNode ? (childText(authorNode,'name') || authorNode.textContent || '').trim() : (childText(entry,'creator') || '');
    const stable = guid || link || `${entryTitle}|${published}`;
    parsed.push({id:`${feedUrl}::${stable}`,feedUrl,feedTitle:title,title:stripMarkup(entryTitle),link,published,summary,author,read:0,star:0,demo:false});
  }
  return {title:stripMarkup(title)||new URL(feedUrl).hostname,posts:parsed,feedType:rootName==='feed'?'Atom':'RSS'};
}
function safeLink(raw, base) {
  try { const u=new URL(raw,base);return ['http:','https:'].includes(u.protocol)?u.href:''; } catch { return ''; }
}
function isFeedText(text) {
  const start=String(text).trimStart().slice(0,600).toLowerCase();
  return start.startsWith('<?xml') || /<(rss|feed|rdf:rdf)(\s|>)/i.test(start);
}
async function readResponseText(response) {
  const text = await response.text();
  if (text.length > 5_000_000) throw new Error('This response is too large to process (5 MB limit).');
  return text;
}
async function probeFeed(url) {
  const response = await proxyFetch(url);
  if (response.status===304) return {url,unchanged:true,title:new URL(url).hostname,posts:[]};
  if (!response.ok) throw new Error(`The feed server returned HTTP ${response.status}.`);
  const text=await readResponseText(response);
  if (!isFeedText(text) && !/xml|rss|atom/i.test(response.headers.get('content-type')||'')) throw new Error('This URL is a webpage, not a feed.');
  const parsed=parseFeed(text,url);
  return {url,...parsed,etag:response.headers.get('etag')||'',lastModified:response.headers.get('last-modified')||'',homeUrl:url};
}
function discoverAlternateLinks(html, siteUrl) {
  const doc=new DOMParser().parseFromString(html,'text/html');
  const result=[];
  for(const link of doc.querySelectorAll('link[rel~="alternate"][href]')) {
    const type=(link.getAttribute('type')||'').toLowerCase();
    const title=(link.getAttribute('title')||'').trim();
    if(type && !/(rss|atom|xml|rdf)/.test(type)) continue;
    try { const u=new URL(link.getAttribute('href'),siteUrl);if(['http:','https:'].includes(u.protocol))result.push({url:normalizeUrl(u.href),title}); } catch {}
  }
  return [...new Map(result.map(x=>[x.url,x])).values()];
}
async function autodiscover(input) {
  const normalized=safeSiteUrl(input);
  const firstUrl=normalizeUrl(normalized);
  let firstError=null;
  try { return await probeFeed(firstUrl); } catch(e) { firstError=e; }
  let pageHtml='';
  try {
    const response=await proxyFetch(normalized);
    if(response.ok && /html|text\/plain/i.test(response.headers.get('content-type')||'')) pageHtml=await readResponseText(response);
    else if(response.ok) {
      const text=await readResponseText(response);
      if(isFeedText(text)) return {url:firstUrl,...parseFeed(text,firstUrl),etag:response.headers.get('etag')||'',lastModified:response.headers.get('last-modified')||'',homeUrl:normalized};
    }
  } catch(e) { if(!firstError) firstError=e; }
  const alternates=pageHtml?discoverAlternateLinks(pageHtml,normalized):[];
  const root=new URL(normalized);root.pathname='/';root.search='';root.hash='';
  const common=['/feed','/feed/','/rss.xml','/atom.xml','/feed.xml','/index.xml','/rss','/blog/feed.xml','/feeds/posts/default'];
  const candidates=[...alternates.map(x=>x.url),...common.map(path=>new URL(path,root).href)];
  for(const candidate of [...new Set(candidates)].slice(0,12)) {
    try { return {...await probeFeed(candidate),homeUrl:normalized}; } catch {}
  }
  throw new Error(firstError?.message || 'Could not discover a valid RSS or Atom feed on this site.');
}

/* ---------- Feed cache + resilient refresh ---------- */
function mergePostFlags(incoming) {
  const oldMap=new Map(state.posts.map(p=>[p.id,p]));
  return incoming.map(p=>{
    const old=oldMap.get(p.id);
    return {...p,read:old?old.read:0,star:old?old.star:0};
  });
}
async function loadLocalState() {
  const [subs,posts]=await Promise.all([idbGetAll('subscriptions'),idbGetAll('posts')]);
  state.subscriptions=subs.sort((a,b)=>(a.addedAt||0)-(b.addedAt||0));
  state.posts=posts;
  const initialized=await metaGet('localInitialized',false);
  if (!state.subscriptions.length && !state.posts.length && !initialized) {
    state.subscriptions=[{...DEMO_FEED}];state.posts=demoPosts.map(p=>({...p}));
    await idbBulkPut('subscriptions',state.subscriptions);
    await idbBulkPut('posts',state.posts);
    state.demo=true;
  }
  await metaSet('localInitialized',true);
  cached.clear();
  const articles=await idbGetAll('articles');articles.forEach(a=>cached.add(a.url));
  renderEverything();
}
async function refreshFeed(subscription, opts={}) {
  if(subscription.demo)return {ok:true,demo:true};
  const response=await proxyFetch(subscription.url,{etag:opts.force?undefined:subscription.etag,lastModified:opts.force?undefined:subscription.lastModified});
  if(response.status===304) {
    const updated={...subscription,lastFetch:Date.now(),error:''};
    await idbPut('subscriptions',updated);replaceSubscription(updated);return {ok:true,unchanged:true};
  }
  if(!response.ok) throw new Error(`HTTP ${response.status}`);
  const raw=await readResponseText(response);
  const parsed=parseFeed(raw,subscription.url);
  const incoming=parsed.posts.map(p=>({...p,feedTitle:parsed.title}));
  const mergedNew=mergePostFlags(incoming);
  const existing=state.posts.filter(p=>p.feedUrl===subscription.url);
  const byId=new Map(existing.map(p=>[p.id,p]));
  mergedNew.forEach(p=>byId.set(p.id,p));
  const allForFeed=[...byId.values()].sort((a,b)=>(b.published||0)-(a.published||0)).slice(0,MAX_POSTS_PER_FEED);
  const nextAll=[...state.posts.filter(p=>p.feedUrl!==subscription.url),...allForFeed];
  state.posts=nextAll;
  await idbBulkPut('posts',allForFeed);
  const updated={...subscription,title:parsed.title||subscription.title,feedType:parsed.feedType,
    homeUrl:subscription.homeUrl||subscription.siteUrl||subscription.url,etag:response.headers.get('etag')||subscription.etag||'',
    lastModified:response.headers.get('last-modified')||subscription.lastModified||'',lastFetch:Date.now(),error:''};
  await idbPut('subscriptions',updated);replaceSubscription(updated);
  return {ok:true,count:incoming.length};
}
function replaceSubscription(sub) {
  const i=state.subscriptions.findIndex(s=>s.url===sub.url);
  if(i>=0)state.subscriptions[i]=sub;else state.subscriptions.push(sub);
}
async function refreshAllFeeds(force=false) {
  if(state.refreshBusy)return;
  const actual=state.subscriptions.filter(s=>!s.demo);
  if(!actual.length){toast('Follow a blog first to refresh real feeds.');return;}
  if(!navigator.onLine){setConnection('offline','Offline · showing cached articles');toast('Offline: cached timeline stays available.');return;}
  state.refreshBusy=true;state.refreshStarted=Date.now();$('#refreshAll').textContent='↻ Refreshing…';
  const outcomes=[];let cursor=0;
  const workers=Array.from({length:Math.min(4,actual.length)},async()=>{
    while(cursor<actual.length){const i=cursor++,sub=actual[i];
      try{outcomes[i]=await refreshFeed(sub,{force});}
      catch(error){outcomes[i]={ok:false,error:error.message};const latest={...sub,error:error.message};await idbPut('subscriptions',latest).catch(()=>{});replaceSubscription(latest);}
    }
  });
  await Promise.all(workers);
  state.refreshBusy=false;$('#refreshAll').textContent='↻ Refresh feeds';
  const ok=outcomes.filter(x=>x?.ok).length, failed=outcomes.filter(x=>x&&!x.ok).length;
  await metaSet('lastRefresh',Date.now()).catch(()=>{});
  renderEverything();
  $('#lastRefresh').textContent=`Updated ${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`;
  if(failed)toast(`${ok} feed(s) refreshed; ${failed} kept their cached copy due to errors.`);
  else toast(`${ok} feed(s) refreshed. The scrolls are current.`);
}
async function addFeed(raw) {
  const input=String(raw||'').trim();if(!input)throw new Error('Enter a blog or feed URL first.');
  let initial=safeSiteUrl(input);const normalized=normalizeUrl(initial);
  const existing=state.subscriptions.find(s=>!s.demo&&normalizeUrl(s.url)===normalized);
  if(existing){state.selectedFeed=existing.url;toast('That feed is already in your subscriptions.');renderEverything();return existing;}
  setMessage('Finding the feed…');
  const discovered=await autodiscover(initial);
  const url=normalizeUrl(discovered.url);
  const duplicate=state.subscriptions.find(s=>!s.demo&&normalizeUrl(s.url)===url);
  if(duplicate){setMessage('This blog is already followed.');toast('Duplicate URL normalized to the existing subscription.');return duplicate;}
  const sub={url,title:discovered.title||new URL(url).hostname,homeUrl:discovered.homeUrl||initial,siteUrl:initial,
    addedAt:Date.now(),etag:discovered.etag||'',lastModified:discovered.lastModified||'',lastFetch:Date.now(),feedType:discovered.feedType||'',error:'',demo:false};
  const posts=mergePostFlags(discovered.posts.map(p=>({...p,feedUrl:url,feedTitle:sub.title})));
  state.subscriptions.push(sub);state.posts=[...state.posts.filter(p=>p.feedUrl!==url),...posts];state.selectedFeed='';
  await Promise.all([idbPut('subscriptions',sub),idbBulkPut('posts',posts)]);
  setMessage(`Following ${sub.title} · ${posts.length} posts found.`);toast(`Following ${sub.title}`);renderEverything();return sub;
}
async function removeFeed(url) {
  if(!confirm('Unfollow this feed? Cached articles already saved on this device will remain available.'))return;
  const sub=state.subscriptions.find(s=>s.url===url);if(!sub)return;
  state.subscriptions=state.subscriptions.filter(s=>s.url!==url);await idbDelete('subscriptions',url);
  if(sub.demo){const samplePosts=state.posts.filter(p=>p.feedUrl===url);state.posts=state.posts.filter(p=>p.feedUrl!==url);await Promise.all(samplePosts.map(p=>idbDelete('posts',p.id).catch(()=>{})));}
  else {const oldPosts=state.posts.filter(p=>p.feedUrl===url);state.posts=state.posts.filter(p=>p.feedUrl!==url);await Promise.all(oldPosts.map(p=>idbDelete('posts',p.id).catch(()=>{})));}
  if(state.selectedFeed===url)state.selectedFeed='';renderEverything();toast(`Unfollowed ${sub.title}. Full-text article cache remains on this device.`);
}

/* ---------- Readability-style extraction and strict allowlist sanitizer ---------- */
const SAFE_TAGS=new Set(['p','div','section','article','main','span','h1','h2','h3','h4','h5','h6','strong','b','em','i','u','s','small','sup','sub','blockquote','q','cite','code','pre','kbd','samp','ul','ol','li','dl','dt','dd','br','hr','a','img','figure','figcaption','table','thead','tbody','tfoot','tr','th','td','caption','abbr','time','details','summary']);
const DROP_TAGS=new Set(['script','style','iframe','object','embed','form','input','button','textarea','select','option','link','meta','base','svg','math','video','audio','source','canvas','template','noscript','nav','footer','header','aside','menu','menuitem','portal']);
function escapeHtml(value) { return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function sanitizeHtml(untrusted, baseUrl='https://example.org/') {
  const parsed=new DOMParser().parseFromString(String(untrusted||''),'text/html');
  const output=document.createDocumentFragment();
  function appendClean(source,parent) {
    if(source.nodeType===Node.TEXT_NODE){parent.appendChild(document.createTextNode(source.nodeValue||''));return;}
    if(source.nodeType!==Node.ELEMENT_NODE)return;
    const tag=localName(source);
    if(DROP_TAGS.has(tag))return;
    if(!SAFE_TAGS.has(tag)){[...source.childNodes].forEach(child=>appendClean(child,parent));return;}
    const target=document.createElement(tag);
    if(tag==='a'){
      const href=source.getAttribute('href');
      if(href){const resolved=safeLink(href,baseUrl);if(resolved){target.setAttribute('href',resolved);target.setAttribute('target','_blank');target.setAttribute('rel','noopener noreferrer nofollow');}}
      const title=source.getAttribute('title');if(title)target.setAttribute('title',title.slice(0,300));
    } else if(tag==='img') {
      const raw=source.getAttribute('src');const resolved=raw?safeLink(raw,baseUrl):'';
      if(!resolved)return;
      target.setAttribute('src',raw.startsWith('/api/fetch?url=')?raw:`/api/fetch?url=${encodeURIComponent(resolved)}`);
      target.setAttribute('alt',(source.getAttribute('alt')||'Article image').slice(0,300));
      target.setAttribute('loading','lazy');target.setAttribute('referrerpolicy','no-referrer');
      const width=source.getAttribute('width'),height=source.getAttribute('height');
      if(width&&/^\d{1,4}$/.test(width))target.setAttribute('width',width);
      if(height&&/^\d{1,4}$/.test(height))target.setAttribute('height',height);
    } else if(['td','th'].includes(tag)) {
      for(const attr of ['colspan','rowspan']){const v=source.getAttribute(attr);if(v&&/^\d{1,2}$/.test(v))target.setAttribute(attr,v);}
    } else if(tag==='time') {
      const datetime=source.getAttribute('datetime');if(datetime&&datetime.length<64)target.setAttribute('datetime',datetime);
    } else if(tag==='abbr') {
      const title=source.getAttribute('title');if(title)target.setAttribute('title',title.slice(0,300));
    } else if(tag==='ol') {
      const start=source.getAttribute('start');if(start&&/^-?\d{1,4}$/.test(start))target.setAttribute('start',start);
    }
    [...source.childNodes].forEach(child=>appendClean(child,target));
    parent.appendChild(target);
  }
  [...parsed.body.childNodes].forEach(child=>appendClean(child,output));
  const wrapper=document.createElement('div');wrapper.appendChild(output);return wrapper.innerHTML;
}
function extractMainContent(rawHtml, articleUrl) {
  const doc=new DOMParser().parseFromString(rawHtml,'text/html');
  doc.querySelectorAll('script,style,nav,footer,header,aside,form,iframe,button,dialog,noscript,template,[hidden],[aria-hidden="true"]').forEach(n=>n.remove());
  const selectors=['article','main','[role="main"]','.article-body','.article-content','.post-content','.entry-content','.post-body','.story-body','.content__article-body','.markdown-body'];
  let candidates=[];for(const selector of selectors){try{candidates.push(...doc.querySelectorAll(selector));}catch{}}
  if(!candidates.length)candidates=[doc.body];
  const score=(el)=>{
    const text=(el.innerText||el.textContent||'').trim();
    if(text.length<120)return -1;
    const paragraphs=el.querySelectorAll('p').length;
    const links=[...el.querySelectorAll('a')].reduce((n,a)=>n+(a.innerText||a.textContent||'').length,0);
    const linkRatio=links/Math.max(1,text.length);
    const headings=el.querySelectorAll('h1,h2,h3').length;
    return text.length + paragraphs*260 + headings*40 - linkRatio*text.length*1.25;
  };
  candidates.sort((a,b)=>score(b)-score(a));
  let best=candidates[0]||doc.body;
  // Avoid a whole-site wrapper when a narrower semantic article has stronger text density.
  if(best===doc.body){const paragraphs=[...doc.querySelectorAll('p')];if(paragraphs.length){const parent=paragraphs[0].closest('article,main,section,div')||paragraphs[0].parentElement;if(parent&&score(parent)>score(best)*.35)best=parent;}}
  const text=(best.innerText||best.textContent||'').replace(/\s+/g,' ').trim();
  if(text.length<160)throw new Error('Could not find enough main-article text; using the feed summary instead.');
  return {html:sanitizeHtml(best.innerHTML,articleUrl),text};
}
const robotsCache=new Map();
async function robotsAllows(articleUrl) {
  let u;try{u=new URL(articleUrl);}catch{return false;}
  const key=u.origin;
  const old=robotsCache.get(key);if(old&&Date.now()-old.at<12*60*60*1000)return old.allowed(u.pathname);
  let rules=[];
  try {
    const response=await proxyFetch(`${u.origin}/robots.txt`,{timeout:6000});
    if(response.ok){const text=(await response.text()).slice(0,150_000);let active=false;
      for(const rawLine of text.split(/\r?\n/)){
        const line=rawLine.split('#')[0].trim();if(!line)continue;
        const split=line.indexOf(':');if(split<0)continue;
        const field=line.slice(0,split).trim().toLowerCase(),value=line.slice(split+1).trim();
        if(field==='user-agent')active=(value==='*'||/mysticmikado/i.test(value));
        else if(active&&field==='disallow'&&value)rules.push(value);
      }
    }
  } catch { /* A missing/unreachable robots file does not make feeds unavailable. */ }
  const allowed=(path)=>{const matching=rules.filter(rule=>path.startsWith(rule)).sort((a,b)=>b.length-a.length)[0];return !matching;};
  robotsCache.set(key,{at:Date.now(),allowed});return allowed(u.pathname);
}
async function loadFullArticle(post) {
  if(!post.link)return {html:sanitizeHtml(post.summary,''),text:stripMarkup(post.summary),cached:false,fallback:true,why:'This sample entry has no external article URL.'};
  const cachedArticle=await idbGet('articles',post.link).catch(()=>null);
  if(cachedArticle){cached.add(post.link);return {...cachedArticle,cached:true};}
  if(!navigator.onLine) return {html:sanitizeHtml(post.summary,post.link),text:stripMarkup(post.summary),cached:false,fallback:true,why:'Offline: no full-text copy has been saved yet.'};
  if(!(await robotsAllows(post.link)))return {html:sanitizeHtml(post.summary,post.link),text:stripMarkup(post.summary),cached:false,fallback:true,why:'The site’s robots.txt disallows fetching this article; showing its feed summary instead.'};
  try {
    const response=await proxyFetch(post.link);
    if(!response.ok)throw new Error(`Article server returned HTTP ${response.status}.`);
    const html=await readResponseText(response);
    const extracted=extractMainContent(html,post.link);
    const record={url:post.link,html:extracted.html,text:extracted.text,title:post.title,savedAt:Date.now(),source:'extracted'};
    await idbPut('articles',record);cached.add(post.link);return {...record,cached:false};
  } catch(error) {
    return {html:sanitizeHtml(post.summary,post.link),text:stripMarkup(post.summary),cached:false,fallback:true,why:`Full-text extraction failed (${error.message}); showing the feed summary.`};
  }
}

/* ---------- Views, feed and article rendering. Every inserted article HTML passes through sanitizer. ---------- */
function getSubscriptionsForDisplay() { return state.subscriptions.slice().sort((a,b)=>a.demo?(b.demo?0:-1):b.demo?1:(a.title||'').localeCompare(b.title||'')); }
function getVisiblePosts() {
  const demoSelected = state.selectedFeed===DEMO_FEED.url;
  const hasRealPosts = state.posts.some(p=>!p.demo);
  const sourcePosts = demoSelected ? state.posts.filter(p=>p.demo) : hasRealPosts ? state.posts.filter(p=>!p.demo) : state.posts;
  return sourcePosts.filter(p=>(!state.selectedFeed||p.feedUrl===state.selectedFeed)&&
    (state.filter==='all'||(state.filter==='unread'&&!p.read)||(state.filter==='star'&&p.star))&&
    (!state.query||`${p.title} ${p.feedTitle} ${stripMarkup(p.summary)}`.toLowerCase().includes(state.query))
  ).sort((a,b)=>state.oldestFirst?(a.published||0)-(b.published||0):(b.published||0)-(a.published||0));
}
function relativeDate(timestamp) {
  if(!timestamp)return 'Date unknown';
  const days=Math.max(0,Math.round((Date.now()-timestamp)/86400000));
  if(days===0)return 'Today';if(days===1)return 'Yesterday';if(days<7)return `${days} days ago`;
  return new Date(timestamp).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
}
function setMessage(message) { $('#msg').textContent=message||''; }
function toast(message) {
  const item=document.createElement('div');item.className='toast';item.textContent=message;$('#toasts').appendChild(item);
  setTimeout(()=>item.remove(),3500);
}
function setConnection(kind,text) {
  const el=$('#connectionStatus');el.classList.remove('online','offline');if(kind==='online')el.classList.add('online');if(kind==='offline')el.classList.add('offline');el.textContent=text;
}
function renderFeeds() {
  const feeds=getSubscriptionsForDisplay();
  $('#feeds').innerHTML='';
  if(!feeds.length){const li=document.createElement('li');li.className='subscription-empty';li.textContent='No subscriptions yet. Add a blog URL above to begin.';$('#feeds').appendChild(li);}
  for(const feed of feeds) {
    const li=document.createElement('li');li.className=(state.selectedFeed===feed.url?'on':'');
    const row=document.createElement('div');row.className='feed-actions';
    const btn=document.createElement('button');btn.className='name';btn.type='button';btn.dataset.feedPick=feed.url;
    const unread=state.posts.filter(p=>p.feedUrl===feed.url&&!p.read).length;
    btn.textContent=feed.title||new URL(feed.url).hostname;
    if(unread){const count=document.createElement('span');count.className='count';count.textContent=` ${unread}`;btn.appendChild(count);}
    if(feed.error){const warning=document.createElement('span');warning.className='count';warning.textContent=' !';warning.title=feed.error;btn.appendChild(warning);}
    row.appendChild(btn);
    const remove=document.createElement('button');remove.className='feed-remove';remove.type='button';remove.dataset.removeFeed=feed.url;remove.title=feed.demo?'Remove sample feed':'Unfollow this feed';remove.setAttribute('aria-label',`${feed.demo?'Remove sample feed':'Unfollow'} ${feed.title}`);remove.textContent='×';row.appendChild(remove);
    li.appendChild(row);$('#feeds').appendChild(li);
  }
  const select=$('#feedFilter');
  select.innerHTML='<option value="">Every subscription</option>';
  feeds.forEach(feed=>{const opt=document.createElement('option');opt.value=feed.url;opt.textContent=feed.title;select.appendChild(opt);});
  const currentExists=feeds.some(feed=>feed.url===state.selectedFeed);
  if(!currentExists)state.selectedFeed='';
  select.value=state.selectedFeed;
}
function renderTimeline() {
  const visible=getVisiblePosts();
  $('#timelineSummary').textContent=`${visible.length} article${visible.length===1?'':'s'} · chronological, newest first unless changed`;
  $('#sort').textContent=state.oldestFirst?'Oldest first':'Newest first';
  $('#list').innerHTML='';
  if(!visible.length){
    const empty=document.createElement('div');empty.className='empty';
    const title=document.createElement('h3');title.textContent=state.posts.length?'No scrolls match these filters.':'The scroll is quiet';empty.appendChild(title);
    const p=document.createElement('p');p.textContent=state.posts.length?'Try another subscription or search term.':'Follow a blog above to fill your chronological timeline. The sample dispatch is kept locally for exploring the reader UI.';empty.appendChild(p);
    const b=document.createElement('button');b.className='seal';b.textContent='Discover blogs';b.type='button';b.addEventListener('click',()=>switchView('discover'));empty.appendChild(b);$('#list').appendChild(empty);return;
  }
  visible.forEach((post,i)=>{
    const article=document.createElement('article');article.className=`card ${post.read?'seen':''} fresh`;article.style.setProperty('--i',i);
    const main=document.createElement('div');main.className='card-main';main.tabIndex=0;main.setAttribute('role','button');main.dataset.openPost=post.id;
    const title=document.createElement('h3');title.textContent=post.title||'Untitled article';main.appendChild(title);
    const meta=document.createElement('div');meta.className='meta';meta.textContent=`${post.feedTitle||'Unknown feed'} · ${relativeDate(post.published)}`;main.appendChild(meta);
    if(post.demo){const tag=document.createElement('span');tag.className='sample-tag';tag.textContent='sample';meta.appendChild(tag);}
    const summary=document.createElement('p');summary.className='summary';summary.textContent=stripMarkup(post.summary)||'Open article to read more.';main.appendChild(summary);
    const actions=document.createElement('div');actions.className='card-actions';
    const stateBadge=document.createElement('span');stateBadge.className=`post-state ${post.read?'':'unread'}`;stateBadge.textContent=post.read?'Read':'Unread';actions.appendChild(stateBadge);
    const star=document.createElement('button');star.className='star';star.type='button';star.dataset.starPost=post.id;star.setAttribute('aria-label',post.star?'Remove star':'Star article');star.textContent=post.star?'★':'☆';actions.appendChild(star);
    const mark=document.createElement('button');mark.type='button';mark.dataset.markRead=post.id;mark.title=post.read?'Mark unread':'Mark read';mark.setAttribute('aria-label',mark.title);mark.textContent=post.read?'↶':'✓';actions.appendChild(mark);
    article.append(main,actions);$('#list').appendChild(article);
  });
}
function switchView(view) {
  state.currentView=view==='discover'?'discover':'timeline';
  $('#timelineView').hidden=state.currentView!=='timeline';$('#discoverView').hidden=state.currentView!=='discover';
  $$('.nav-tab').forEach(btn=>{const active=btn.dataset.view===state.currentView;btn.classList.toggle('is-active',active);btn.setAttribute('aria-pressed',String(active));});
  if(state.currentView==='discover')loadDiscovery();
}
function renderEverything() { renderFeeds();renderTimeline(); }
function insight(post,text) {
  const words=(text||stripMarkup(post.summary)).split(/\s+/).filter(Boolean);
  const frequencies={};words.forEach(w=>{const k=w.toLowerCase().replace(/[^a-z0-9]/g,'');if(k.length>5)frequencies[k]=(frequencies[k]||0)+1;});
  const themes=Object.entries(frequencies).sort((a,b)=>b[1]-a[1]).slice(0,3).map(x=>x[0]);
  return `Sage’s note · ${words.length} words · about ${Math.max(1,Math.round(words.length/200))} min · themes: ${themes.join(', ')||'quiet'}`;
}
async function openPost(id) {
  const post=state.posts.find(p=>p.id===id);if(!post)return;
  const requestSequence=++readerRequestSequence;
  state.currentPostId=id;post.read=1;await idbPut('posts',post).catch(()=>{});
  $('#slipv').hidden=true;$('#readv').hidden=false;document.body.classList.add('reading');
  $('#rt').textContent=post.title||'Untitled article';$('#rm').textContent=`${post.feedTitle||'Unknown feed'} · ${new Date(post.published||Date.now()).toLocaleString()}`;
  $('#rb').innerHTML=sanitizeHtml(post.summary,post.link||'https://example.org/');$('#rb').style.fontSize=`${state.fontSize}rem`;
  $('#sage').textContent=insight(post,stripMarkup(post.summary));$('#rs').textContent=post.star?'★ Starred':'☆ Star';
  $('#markUnread').textContent='Mark unread';$('#rstamp').innerHTML='<span class="hanko big">既</span>';
  const link=$('#originalLink');if(post.link){link.href=post.link;link.hidden=false;}else{link.removeAttribute('href');link.hidden=true;}
  $('#articleStatus').textContent='';$('#cacheStatus').textContent='';renderEverything();Snd.play('bell');
  try {
    const article=await loadFullArticle(post);
    if(requestSequence!==readerRequestSequence || state.currentPostId!==id || $('#readv').hidden)return;
    // The same strict allowlist is applied again before the DOM receives cached or freshly extracted HTML.
    $('#rb').innerHTML=sanitizeHtml(article.html,post.link||'https://example.org/');
    $('#sage').textContent=insight(post,article.text||'');
    $('#articleStatus').textContent=article.why|| (article.fallback?'Feed summary shown.':article.cached?'Full article loaded from this device’s offline cache.':'Full article extracted in your browser and saved offline.');
    $('#cacheStatus').textContent=article.cached?'Offline copy available':article.fallback?'Summary fallback':'Saved to this device';
    if(article.cached&&post.link)cached.add(post.link);
  } catch(e) { if(requestSequence===readerRequestSequence)$('#articleStatus').textContent='Feed summary shown; the full article could not be loaded.'; }
}
function closeReader() {readerRequestSequence++;$('#readv').hidden=true;document.body.classList.remove('reading');Snd.play('wood');}
async function setRead(postId,read) {
  const post=state.posts.find(p=>p.id===postId);if(!post)return;
  post.read=read?1:0;await idbPut('posts',post).catch(()=>{});renderEverything();
  if(state.currentPostId===postId)$('#markUnread').textContent=post.read?'Mark unread':'Mark read';
  toast(post.read?'Marked as read · 既':'Marked as unread');
}
async function toggleStar(postId) {
  const post=state.posts.find(p=>p.id===postId);if(!post)return;
  post.star=post.star?0:1;await idbPut('posts',post).catch(()=>{});Snd.play('pluck');renderEverything();
  if(state.currentPostId===postId)$('#rs').textContent=post.star?'★ Starred':'☆ Star';
  toast(post.star?'Pinned with a gold seal ★':'Seal removed');
}
function stepPost(direction) {
  const list=getVisiblePosts(),index=list.findIndex(p=>p.id===state.currentPostId),next=list[index+direction];if(next)openPost(next.id);else{Snd.play('wood');toast('No more scrolls that way.');}
}
function drawLot() {
  const pool=state.posts.filter(p=>!p.read);if(!pool.length){setMessage('Every scroll has been read. The shrine is quiet.');Snd.play('bell');return;}
  setMessage('');$('#slip').innerHTML='<span class="shake">籤</span>';$('#slipv').hidden=false;
  [0,350,700].forEach(t=>setTimeout(()=>Snd.play('taiko'),t));
  setTimeout(()=>{const p=pool[Math.floor(Math.random()*pool.length)],age=Math.max(0,Math.floor((Date.now()-p.published)/86400000)),i=Math.min(4,Math.floor(age/7)),luck=['大吉','中吉','小吉','吉','末吉'][i];
    $('#slip').innerHTML=`<div class="luck ${i===0?'top':''}">${luck}</div><p><b>${escapeHtml(p.title)}</b></p><p class="meta">${escapeHtml(p.feedTitle||'Mystic Dispatch')}</p><button class="seal" type="button" data-open-lot="${escapeHtml(p.id)}">Read this fortune</button>`;redo($('#slip'),'slip');Snd.play(i===0?'gong':'bell');
  },1150);
}
function redo(el,cls){if(!el)return;el.classList.remove(cls);void el.offsetWidth;el.classList.add(cls);}

/* ---------- Anonymous discovery UI. Curated fallback is visible even without database credentials. ---------- */
function seedDiscoveryList() {
  const seen=new Map();
  for(const item of SEED_FEEDS){try{const url=normalizeUrl(item.url);if(!seen.has(url))seen.set(url,{...item,url,popularity:Math.max(5,Math.floor(72-(seen.size*4.15))),co_subscription:0,why:'Curated seed list · ready to follow'});}catch{}}
  return [...seen.values()];
}
function makeRecommendationCard(item,mode) {
  const card=document.createElement('article');card.className='recommend-card';
  const top=document.createElement('div');top.className='recommend-top';const copy=document.createElement('div');
  const heading=document.createElement('h4');heading.textContent=item.title||hostName(item.url);copy.appendChild(heading);
  const description=document.createElement('p');description.textContent=item.description||item.why||'An independent feed to explore.';copy.appendChild(description);
  const anchor=document.createElement('a');anchor.href=item.url;anchor.target='_blank';anchor.rel='noopener noreferrer';anchor.textContent=item.url;copy.appendChild(anchor);top.appendChild(copy);
  const btn=document.createElement('button');btn.type='button';btn.className='ghost';btn.textContent='＋ Follow';btn.addEventListener('click',async()=>{btn.disabled=true;const old=btn.textContent;btn.textContent='Adding…';try{await addFeed(item.url);switchView('timeline');}catch(e){toast(e.message||'Could not add this feed.');}finally{btn.disabled=false;btn.textContent=old;}});top.appendChild(btn);card.appendChild(top);
  const stats=document.createElement('div');stats.className='recommend-stats';
  const pop=document.createElement('span');pop.textContent=item.seeded?`Demo baseline score · ${Number(item.popularity||0)}`:`${Number(item.popularity||0)} opt-in batch${Number(item.popularity||0)===1?'':'es'}`;stats.appendChild(pop);
  const co=document.createElement('span');co.textContent=`${Number(item.co_subscription||0)} co-subscription overlap`;stats.appendChild(co);card.appendChild(stats);
  const why=document.createElement('p');why.textContent=item.why||(Number(item.co_subscription||0)>0?'Often followed alongside one or more of your subscriptions.':'Suggested from the curated seed set until anonymous overlap data is available.');card.appendChild(why);
  return card;
}
async function apiJson(url,options={}) {
  const response=await fetch(url,{...options,headers:{'content-type':'application/json',...(options.headers||{})},cache:'no-store'});
  const payload=await response.json().catch(()=>({error:`Server returned HTTP ${response.status}.`}));
  if(!response.ok)throw new Error(payload.error||`Request failed (${response.status}).`);return payload;
}
async function loadDiscovery() {
  $('#popularList').innerHTML='<p class="meta">Gathering the scrolls…</p>';
  $('#recommendList').innerHTML='';
  const current=state.subscriptions.filter(s=>!s.demo).map(s=>s.url);
  $('#recommendIntro').textContent=current.length?'Recommendations exclude feeds you already follow. Anonymous overlap appears after opt-in batches are shared.':'Follow a real blog to personalize these suggestions; your current local sample feed is never submitted.';
  let popular=[],recommended=[];
  try {const payload=await apiJson('/api/discovery/popular?limit=12');popular=payload.feeds||[];}catch{popular=seedDiscoveryList();}
  try {if(current.length){const payload=await apiJson('/api/discovery/recommendations',{method:'POST',body:JSON.stringify({feeds:current})});recommended=payload.recommendations||[];}}
  catch {recommended=[];}
  if(!recommended.length)recommended=seedDiscoveryList().filter(item=>!current.includes(item.url)).slice(0,8).map(item=>({...item,why:'Curated seed suggestion · follow directly to explore'}));
  $('#popularList').innerHTML='';
  const already=new Set(current);
  const filteredPopular=popular.filter(item=>!already.has(item.url)).slice(0,12);
  for(const item of filteredPopular)$('#popularList').appendChild(makeRecommendationCard(item,'popular'));
  if(!filteredPopular.length){const p=document.createElement('p');p.className='empty';p.textContent='No popular feeds available yet.';$('#popularList').appendChild(p);}
  $('#recommendList').innerHTML='';for(const item of recommended.filter(item=>!already.has(item.url)).slice(0,10))$('#recommendList').appendChild(makeRecommendationCard(item,'recommended'));
  if(!$('#recommendList').children.length){const p=document.createElement('p');p.className='empty';p.textContent='Your follow list covers the seed shelf. Search for a site above or share a batch to build overlap recommendations.';$('#recommendList').appendChild(p);}
}
function hostName(url) {try{return new URL(url).hostname.replace(/^www\./,'');}catch{return String(url||'Feed');}}
async function shareSubscriptions() {
  if(!$('#shareConsent').checked){toast('Tick the opt-in box first. Nothing is shared by default.');return;}
  const feeds=[...new Set(state.subscriptions.filter(s=>!s.demo).map(s=>normalizeUrl(s.url)))];
  if(!feeds.length){toast('Add at least one real feed before sharing.');return;}
  if(feeds.length>100){toast('Please share at most 100 feeds in a single batch.');return;}
  const button=$('#shareNow');button.disabled=true;const original=button.textContent;button.textContent='Preparing token…';
  try {
    const {token}=await apiJson('/api/discovery/token',{method:'POST',body:'{}'});
    button.textContent='Sharing one batch…';
    const result=await apiJson('/api/discovery/submit',{method:'POST',body:JSON.stringify({token,feeds})});
    toast(`Shared ${result.accepted||feeds.length} normalized feeds anonymously. Thank you.`);$('#shareConsent').checked=false;switchView('discover');
  } catch(error) {
    toast(`Discovery server unavailable: ${error.message}. Your local reader still works; set up Supabase to enable sharing.`);
  } finally {button.disabled=false;button.textContent=original;}
}

/* ---------- OPML import/export; imported URLs still go through feed autodiscovery and validation. ---------- */
function exportOpml() {
  const feeds=state.subscriptions.filter(s=>!s.demo);
  const outlines=feeds.map(s=>`    <outline text="${escapeXml(s.title)}" title="${escapeXml(s.title)}" type="rss" xmlUrl="${escapeXml(s.url)}" htmlUrl="${escapeXml(s.homeUrl||s.siteUrl||'')}"/>`).join('\n');
  const xml=`<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0"><head><title>Mystic Mikado subscriptions</title><dateCreated>${new Date().toUTCString()}</dateCreated></head><body>\n${outlines}\n</body></opml>`;
  const blob=new Blob([xml],{type:'text/x-opml;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='mystic-mikado-subscriptions.opml';a.click();URL.revokeObjectURL(url);toast(`Exported ${feeds.length} subscriptions.`);
}
function escapeXml(value){return String(value??'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/'/g,'&apos;');}
async function importOpml(file) {
  if(!file)return;
  if(file.size>2_000_000)throw new Error('OPML file is too large (2 MB max).');
  const text=await file.text(),doc=parseXml(text),outlines=[...doc.getElementsByTagName('outline')];
  const urls=[...new Set(outlines.map(o=>o.getAttribute('xmlUrl')).filter(Boolean))].slice(0,100);
  if(!urls.length)throw new Error('No outline with an xmlUrl was found in that OPML file.');
  let added=0,failed=0;
  for(const url of urls){try{await addFeed(url);added++;}catch(e){failed++;toast(`Skipped ${hostName(url)}: ${e.message}`);}}
  toast(`OPML import finished · ${added} added or already followed · ${failed} failed.`);renderEverything();
}

/* ---------- Sound design carried over from the original UI; music is continuous across views. ---------- */
const Snd={
  on:true,vol:.76,ctx:null,master:null,limiter:null,musicBus:null,musicOn:false,userPausedMusic:false,musicTimer:null,musicNodes:[],musicStep:0,
  c(){if(!this.ctx){const A=window.AudioContext||window.webkitAudioContext;if(A){this.ctx=new A();this.master=this.ctx.createGain();this.master.gain.value=this.vol;this.limiter=this.ctx.createDynamicsCompressor();this.limiter.threshold.value=-12;this.limiter.knee.value=16;this.limiter.ratio.value=4;this.limiter.attack.value=.004;this.limiter.release.value=.24;this.master.connect(this.limiter);this.limiter.connect(this.ctx.destination);}}
    if(this.ctx&&this.ctx.state==='suspended')this.ctx.resume();return this.ctx;},
  env(c,t,a,d,peak,output){const g=c.createGain();g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(Math.max(.0002,peak),t+Math.max(.005,a));g.gain.exponentialRampToValueAtTime(.0001,t+Math.max(.015,a+d));g.connect(output||this.master||c.destination);return g;},
  tone(type,f0,f1,a,d,peak,delay=0,output=null){const c=this.c();if(!c)return;const t=c.currentTime+delay,o=c.createOscillator();o.type=type;o.frequency.setValueAtTime(f0,t);if(f1)o.frequency.exponentialRampToValueAtTime(Math.max(1,f1),t+Math.max(.01,a+d));o.connect(this.env(c,t,a,d,peak,output));o.start(t);o.stop(t+a+d+.06);},
  noise(dur,f0,f1,f2,peak){const c=this.c();if(!c)return;const t=c.currentTime,n=Math.floor(c.sampleRate*dur),buffer=c.createBuffer(1,n,c.sampleRate),data=buffer.getChannelData(0);for(let i=0;i<n;i++)data[i]=(Math.random()*2-1)*Math.exp(-i/(n*.3));const source=c.createBufferSource();source.buffer=buffer;const filter=c.createBiquadFilter();filter.type='bandpass';filter.Q.value=3.5;filter.frequency.setValueAtTime(f0,t);filter.frequency.exponentialRampToValueAtTime(f1,t+dur*.25);filter.frequency.exponentialRampToValueAtTime(f2,t+dur);source.connect(filter);filter.connect(this.env(c,t,.02,dur,peak));source.start(t);},
  play(name){if(!this.on)return;if(name==='wood')this.tone('triangle',520,180,.002,.06,.18);if(name==='taiko'){this.tone('sine',130,36,.004,.4,.55);this.tone('triangle',340,80,.002,.06,.2);}if(name==='bell')[1,2.76,5.4].forEach((m,i)=>this.tone('sine',220*m,0,.005,1.7,.19/(i+1)));if(name==='gong')[1,1.5,2.4,3.1].forEach((m,i)=>this.tone('sine',110*m,0,.01,2.4,.22/(i+1)));if(name==='pluck'){const p=[392,440,523,587,659],f=p[Math.floor(Math.random()*p.length)];this.tone('triangle',f,f*.99,.003,.55,.2);this.tone('sine',f*2,0,.003,.3,.065);}},
  startMusic(){const c=this.c();if(!c||this.musicOn)return;this.musicOn=true;this.musicStep=0;this.musicBus=c.createGain();this.musicBus.gain.setValueAtTime(.0001,c.currentTime);this.musicBus.gain.exponentialRampToValueAtTime(.94,c.currentTime+2.6);this.musicBus.connect(this.master);
    const filter=c.createBiquadFilter();filter.type='lowpass';filter.frequency.value=1350;filter.Q.value=.45;filter.connect(this.musicBus);
    [[55,'sine',.028],[73.42,'sine',.046],[110,'sine',.058],[146.83,'triangle',.024],[220,'sine',.014]].forEach(([f,type,level])=>{const o=c.createOscillator(),g=c.createGain();o.type=type;o.frequency.value=f;g.gain.setValueAtTime(.0001,c.currentTime);g.gain.exponentialRampToValueAtTime(level,c.currentTime+3.5);o.connect(g);g.connect(filter);o.start();this.musicNodes.push({osc:o,gain:g});});
    const lfo=c.createOscillator(),lfoGain=c.createGain();lfo.frequency.value=.075;lfoGain.gain.value=.003;lfo.connect(lfoGain);lfoGain.connect(this.musicNodes[1].gain.gain);lfo.start();this.musicNodes.push({osc:lfo,gain:lfoGain});
    const windBuffer=c.createBuffer(1,c.sampleRate*3,c.sampleRate),windData=windBuffer.getChannelData(0);for(let i=0;i<windData.length;i++)windData[i]=(Math.random()*2-1)*.26;const wind=c.createBufferSource();wind.buffer=windBuffer;wind.loop=true;const wf=c.createBiquadFilter();wf.type='lowpass';wf.frequency.value=720;wf.Q.value=.35;const wg=c.createGain();wg.gain.value=.026;wind.connect(wf);wf.connect(wg);wg.connect(this.musicBus);wind.start();this.musicNodes.push({osc:wind,gain:wg});this.musicLoop();},
  musicLoop(){if(!this.musicOn||!this.musicBus)return;const notes=[293.66,0,349.23,392,440,392,349.23,0,293.66,392,523.25,440,392,349.23,293.66,0];const i=this.musicStep%notes.length,f=notes[i];if(f){this.tone('triangle',f,f*.996,.018,1.62,.15,0,this.musicBus);this.tone('sine',f*2,f*1.98,.012,.96,.045,.018,this.musicBus);if(i===4||i===10)this.tone('sine',f/2,0,.035,1.95,.052,.06,this.musicBus);}this.musicStep++;this.musicTimer=setTimeout(()=>this.musicLoop(),2050+(i%3)*170);},
  stopMusic(){if(!this.musicOn)return;this.musicOn=false;clearTimeout(this.musicTimer);const c=this.ctx,bus=this.musicBus,nodes=this.musicNodes.splice(0);this.musicBus=null;if(c&&bus){const t=c.currentTime;bus.gain.cancelScheduledValues(t);bus.gain.setValueAtTime(Math.max(.0001,bus.gain.value),t);bus.gain.exponentialRampToValueAtTime(.0001,t+1.1);}nodes.forEach(({osc,gain})=>{try{gain.gain.cancelScheduledValues(c.currentTime);gain.gain.setTargetAtTime(.0001,c.currentTime,.08);osc.stop(c.currentTime+1.2);}catch{}});setTimeout(()=>{try{bus&&bus.disconnect();}catch{}},1400);},
  setVolume(v){this.vol=v;if(this.master&&this.ctx)this.master.gain.setTargetAtTime(v,this.ctx.currentTime,.06);}
};
function syncMusicUI(){const playing=Snd.musicOn;$('#amb').textContent=playing?'♫ Ambience playing':'♫ Start ambience';$('#amb').setAttribute('aria-pressed',String(playing));$('#ambMini').textContent=playing?'Ⅱ Pause music':'▶ Play';$('#ambMini').setAttribute('aria-pressed',String(playing));$('#ambState').textContent=playing?'Continuous · dragon moon':'Paused · tap to resume';}
function toggleMusic(){if(Snd.musicOn){Snd.userPausedMusic=true;Snd.stopMusic();toast('The shrine falls quiet');}else{Snd.userPausedMusic=false;Snd.startMusic();Snd.play('bell');toast('Ambient soundtrack started');}syncMusicUI();}
function syncVolume(value){Snd.setVolume(Number(value)/100);$('#vol').value=String(value);$('#volMini').value=String(value);}

/* ---------- Events & startup ---------- */
$('#add').addEventListener('submit',async event=>{event.preventDefault();const input=$('#addr');const button=$('#add button');button.disabled=true;button.textContent='…';try{await addFeed(input.value);input.value='';}catch(error){setMessage(error.message||'Could not add this feed.');toast(error.message||'Could not add this feed.');}finally{button.disabled=false;button.textContent='＋';}});
$('#q').addEventListener('input',event=>{state.query=event.target.value.toLowerCase().trim();renderTimeline();});
$('#feedFilter').addEventListener('change',event=>{state.selectedFeed=event.target.value;renderFeeds();renderTimeline();});
$('#sort').addEventListener('click',()=>{state.oldestFirst=!state.oldestFirst;Snd.play('wood');renderTimeline();});
$('#refreshAll').addEventListener('click',()=>refreshAllFeeds(true));
$('#lot').addEventListener('click',drawLot);
$('#navTimeline').addEventListener('click',()=>switchView('timeline'));$('#navDiscover').addEventListener('click',()=>switchView('discover'));
$$('[data-flt]').forEach(button=>button.addEventListener('click',()=>{state.filter=button.dataset.flt;$$('[data-flt]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));Snd.play('wood');renderTimeline();}));
$('#rs').addEventListener('click',()=>state.currentPostId&&toggleStar(state.currentPostId));
$('#markUnread').addEventListener('click',()=>state.currentPostId&&setRead(state.currentPostId,0));
$('#fm').addEventListener('click',()=>{state.fontSize=Math.max(.85,state.fontSize-.1);$('#rb').style.fontSize=`${state.fontSize}rem`;Snd.play('wood');});
$('#fp').addEventListener('click',()=>{state.fontSize=Math.min(1.75,state.fontSize+.1);$('#rb').style.fontSize=`${state.fontSize}rem`;Snd.play('wood');});
$('#x').addEventListener('click',closeReader);
$('#readv').addEventListener('click',event=>{if(event.target===$('#readv'))closeReader();});
$('#slipv').addEventListener('click',event=>{if(event.target===$('#slipv'))$('#slipv').hidden=true;});
$('#snd').addEventListener('click',event=>{Snd.on=!Snd.on;event.currentTarget.setAttribute('aria-pressed',String(Snd.on));event.currentTarget.textContent=Snd.on?'SFX: on':'SFX: off';if(Snd.on)Snd.play('bell');toast(Snd.on?'Sound effects enabled':'Sound effects muted');});
$('#amb').addEventListener('click',toggleMusic);$('#ambMini').addEventListener('click',toggleMusic);
$('#vol').addEventListener('input',event=>syncVolume(event.target.value));$('#volMini').addEventListener('input',event=>syncVolume(event.target.value));
$('#theme').addEventListener('click',event=>{const toDark=document.documentElement.dataset.theme==='light';document.documentElement.dataset.theme=toDark?'dark':'light';event.currentTarget.setAttribute('aria-pressed',String(toDark));event.currentTarget.textContent=toDark?'☾ Dark mode':'☼ Light mode';Snd.play('bell');});
$('#shareNow').addEventListener('click',shareSubscriptions);
$('#reloadDiscover').addEventListener('click',loadDiscovery);
$('#opmlExport').addEventListener('click',exportOpml);$('#opmlImportBtn').addEventListener('click',()=>$('#opmlFile').click());
$('#opmlFile').addEventListener('change',async event=>{try{await importOpml(event.target.files?.[0]);}catch(e){toast(e.message||'Could not import OPML.');}finally{event.target.value='';}});

document.addEventListener('click',event=>{
  const target=event.target.closest('button,[data-open-post]');if(!target)return;
  if(target.dataset.feedPick){state.selectedFeed=target.dataset.feedPick;$('#feedFilter').value=state.selectedFeed;renderFeeds();renderTimeline();Snd.play('wood');return;}
  if(target.dataset.removeFeed){removeFeed(target.dataset.removeFeed);return;}
  if(target.dataset.openPost){openPost(target.dataset.openPost);return;}
  if(target.dataset.starPost){event.stopPropagation();toggleStar(target.dataset.starPost);return;}
  if(target.dataset.markRead){const post=state.posts.find(p=>p.id===target.dataset.markRead);if(post)setRead(post.id,!post.read);return;}
  if(target.dataset.openLot){$('#slipv').hidden=true;openPost(target.dataset.openLot);return;}
});
document.addEventListener('keydown',event=>{
  if(event.target.matches('input,textarea,select')&&!['Escape'].includes(event.key))return;
  if(event.key==='Escape'){if(!$('#readv').hidden)closeReader();$('#slipv').hidden=true;}
  if(event.key==='j'&&state.currentPostId&&!$('#readv').hidden)stepPost(1);
  if(event.key==='k'&&state.currentPostId&&!$('#readv').hidden)stepPost(-1);
  if(event.key==='s'&&state.currentPostId&&!$('#readv').hidden)toggleStar(state.currentPostId);
  if(event.key==='o')drawLot();if(event.key==='m')$('#snd').click();
});
document.addEventListener('pointerdown',event=>{
  const ripple=document.createElement('span');ripple.className='ink';ripple.style.left=`${event.clientX}px`;ripple.style.top=`${event.clientY}px`;document.body.appendChild(ripple);setTimeout(()=>ripple.remove(),750);
  // Respect the browser's autoplay policy but begin the ambient bed after the first deliberate gesture.
  if(!Snd.musicOn&&!Snd.userPausedMusic&&!event.target.closest('#amb,#ambMini,#snd,#vol,#volMini')){Snd.startMusic();syncMusicUI();}
});
window.addEventListener('online',()=>{setConnection('online','Online · background refresh enabled');refreshAllFeeds(false);});
window.addEventListener('offline',()=>setConnection('offline','Offline · local cache ready'));

for(let i=0;i<18;i++){const petal=document.createElement('span');petal.className='petal';const size=8+(i%3)*3;petal.style.cssText=`left:${(i*57)%100}%;width:${size}px;height:${size+4}px;animation-duration:${10+(i*5)%9}s;animation-delay:-${(i*3)%14}s`;document.body.appendChild(petal);}

(async function init(){
  try {
    await loadLocalState();
    setConnection(navigator.onLine?'online':'offline',navigator.onLine?'Online · feeds refresh in background':'Offline · local cache ready');
    if(state.subscriptions.some(s=>!s.demo)&&navigator.onLine)refreshAllFeeds(false);
    else if(!state.subscriptions.some(s=>!s.demo))$('#lastRefresh').textContent='Sample library · offline-ready';
    const last=await metaGet('lastRefresh',0);if(last)$('#lastRefresh').textContent=`Last refresh ${new Date(last).toLocaleString()}`;
    if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
  } catch(error) {
    setConnection('offline','Local storage unavailable');toast(`Storage warning: ${error.message}`);
    state.subscriptions=[{...DEMO_FEED}];state.posts=demoPosts.map(p=>({...p}));renderEverything();
  }
})();

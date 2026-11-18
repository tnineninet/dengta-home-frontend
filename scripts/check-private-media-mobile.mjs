// Run with cwd set to the candidate frontend. All media and scope state live only in browser memory.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const require = createRequire(resolve('package.json'));
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href);
const { PNG } = require('pngjs');
const here = process.env.MEDIA_EVIDENCE_DIR || await mkdtemp(resolve(tmpdir(), 'dengta-private-media-'));
await mkdir(here, { recursive: true });
const png = new PNG({ width: 144, height: 96 });
for(let y=0;y<png.height;y++) for(let x=0;x<png.width;x++){
  const c=(x-96)**2+(y-31)**2<190?[255,208,119]:y>62+9*Math.sin(x/14)?[38,101,124]:[90+x/4,157+y/5,185+x/5];
  png.data.set([...c,255],4*(y*png.width+x));
}
const imageBytes = PNG.sync.write(png);
const photo = {name:'synthetic-coast.png',mimeType:'image/png',buffer:imageBytes};
await writeFile(resolve(here,photo.name),imageBytes);
const fixtureApi = `
export const API_BASE_URL=location.origin;
const state=window.fixtureState={assets:[],preferences:{},writes:[],files:{},reads:[]};
const ids={user_avatar:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',companion_avatar:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',chat_background:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'};
export async function apiFetch(path,init={}){
  init.signal?.throwIfAborted();
  if(init.method==='POST' && path==='/api/v2/private-media/assets'){
    const form=init.body,file=form.get('file'),purpose=form.get('purpose'),id=ids[purpose];
    const probe=await createImageBitmap(file);
    const asset={id,purpose,width:probe.width,height:probe.height}; probe.close();
    state.files[id]=file;state.assets.push(asset);state.writes.push(['POST',purpose,file.type,file.size]);
    return Response.json({ok:true,asset});
  }
  const id=path.match(/^\\/api\\/v2\\/private-media\\/assets\\/([^/]+)\\/content$/)?.[1];
  if(id && state.files[id]){state.reads.push(id);return new Response(state.files[id]);}
  throw Error('Unexpected synthetic fetch: '+path);
}
export async function apiRequest(path,init={}){
  init.signal?.throwIfAborted();
  if(path==='/api/v2/private-media/catalog' && !init.method) return structuredClone({assets:state.assets,preferences:state.preferences});
  if(path==='/api/v2/private-media/preferences' && init.method==='PUT'){
    const pair=JSON.parse(init.body);
    if(pair.asset_id)state.preferences[pair.purpose]=pair.asset_id;else delete state.preferences[pair.purpose];
    state.writes.push(['PUT',pair.purpose,pair.asset_id]);
    return {ok:true,preference:pair};
  }
  throw Error('Unexpected synthetic request: '+path);
}`;
const entry = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import MediaSettings from '/src/MediaSettings.jsx';
import {usePrivateMediaCatalog} from '/src/use-private-media-catalog.js';
import {selectedPrivateMedia} from '/src/private-media.js';
import {preparePrivatePhoto} from '/src/private-photo.js';
import '/src/index.css';import '/src/native-feel.css';import '/src/settings-media-polish.css';
window.preparePhoto=preparePrivatePhoto;
function Demo(){
 const [show,setShow]=useState(true),record=usePrivateMediaCatalog('synthetic-scope');
 window.selectedPhoto=purpose=>selectedPrivateMedia(record.catalog,purpose)?.id||null;
 return <main style={{height:'100dvh',overflowY:'auto',padding:'12px',background:'#f8f5ef','--theme-ink':'#363133','--theme-accent':'#675146','--theme-card-rgb':'255 255 255','--theme-ink-rgb':'52 46 43'}}>
 <button data-fixture-toggle onClick={()=>setShow(!show)}>本地测试：{show?'关闭设置':'重开设置'}</button>
 {show&&<MediaSettings catalog={record.catalog} loading={record.loading} error={record.error} onRefresh={record.refresh} onCatalogChange={record.updateCatalog} onPreview={()=>{}}/>}</main>}
createRoot(document.querySelector('#root')).render(<Demo/>);
`;
const server=await createServer({configFile:false,envDir:false,root:process.cwd(),appType:'custom',logLevel:'error',
  server:{host:'127.0.0.1',port:0,hmr:false,watch:null},optimizeDeps:{include:['react','react-dom/client','react/jsx-runtime','react/jsx-dev-runtime']},
  plugins:[{name:'memory-fixture',enforce:'pre',resolveId(id){
    if(id==='/fixture-entry.jsx')return resolve('fixture-entry.jsx');
    if(/^\.\/api(?:\.js)?$/.test(id))return '\0fixture-api';
    if(id==='./auth-session.js')return '\0fixture-auth';
    if(id==='./StickerImportSettings.jsx'||id==='./XhsStickerImportSettings.jsx')return '\0fixture-sticker';
  },load(id){
    if(id===resolve('fixture-entry.jsx').replaceAll('\\','/')||id===resolve('fixture-entry.jsx'))return entry;
    if(id==='\0fixture-api')return fixtureApi;
    if(id==='\0fixture-auth')return 'const snapshot={user:{id:"synthetic-only"},activeCompanionId:"synthetic-friend",scopeRevision:0};export const authSession={getSnapshot:()=>snapshot,subscribe:()=>()=>{}};';
    if(id==='\0fixture-sticker')return 'export default function FixtureStub(){return null};export const StickerSource=()=>null;';
  },configureServer(vite){vite.middlewares.use((req,res,next)=>{
    if(req.url!=='/')return next();
    res.setHeader('content-type','text/html; charset=utf-8');res.end('<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/fixture-entry.jsx"></script></html>');
  });}}]});
let browser, page;
try {
  await server.listen();
  const origin='http://127.0.0.1:'+server.httpServer.address().port;
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),args:['--disable-background-networking']});
  page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true,serviceWorkers:'block'});
  const external=[], errors=[];
  await page.route(/^https?:/,route=>{
    const url=new URL(route.request().url());
    if(url.origin===origin&&!url.pathname.startsWith('/api/'))return route.continue();
    external.push(url.origin+url.pathname);return route.abort();
  });
  page.on('pageerror',err=>{errors.push(err.message);console.error(err.message);});
  page.on('console',msg=>{if(msg.type()==='error')console.error(msg.text());});
  await page.goto(origin);
  const button=page.locator('[data-fixture-toggle]');
  await button.waitFor({timeout:15000});
  const records={};
  for(const [purpose,stem] of [['user_avatar','avatar'],['companion_avatar','companion'],['chat_background','wallpaper']]){
    const card=page.locator('section[aria-labelledby="media-'+purpose+'"]'), input=card.locator('input[type=file]');
    await input.scrollIntoViewIfNeeded();
    const box=await input.boundingBox();
    assert.ok(box.width>=44 && box.height>=44,'actual file input hit area');
    const chooserRequest=page.waitForEvent('filechooser');await input.click();const chooser=await chooserRequest;
    await chooser.setFiles(photo);
    // The protected thumbnail intentionally starts reading only in view. Scroll
    // the newly inserted row into view just as a person inspecting it would.
    await card.locator('.media-choice').scrollIntoViewIfNeeded();
    await card.locator('img').waitFor();
    await page.waitForFunction(p=>document.querySelector('[aria-labelledby="media-'+p+'"] img')?.naturalWidth===144,purpose);
    const pick=card.getByRole('button',{name:'启用',exact:true}), current=card.getByRole('button',{name:'使用中',exact:true});
    const capture=async name=>{const path=resolve(here,stem+'-'+name+'.png'); await card.screenshot({path});};
    assert.equal(await pick.isEnabled(),true);assert.equal(await page.evaluate(p=>window.selectedPhoto(p),purpose),null);
    await capture('1-uploaded');
    await pick.click();await current.waitFor();assert.equal(await current.getAttribute('aria-pressed'),'true');await capture('2-enabled');
    await button.click();await button.click();await current.waitFor();
    const saved=await page.evaluate(p=>window.selectedPhoto(p),purpose);assert.ok(saved);
    await card.getByRole('button',{name:/恢复默认/}).click();await pick.waitFor();await capture('3-restored');
    assert.equal(await page.evaluate(p=>window.selectedPhoto(p),purpose),null);assert.equal(await pick.isEnabled(),true);
    records[purpose]={pickerOpened:true,imagePixels:[144,96],hitBox:box,selectedAfterReopen:saved,selectedAfterReset:null};
  }
  const codec=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=6400;canvas.height=2800;const ctx=canvas.getContext('2d');
    ctx.fillStyle='red';ctx.fillRect(0,0,1800,2800);ctx.fillStyle='lime';ctx.fillRect(1800,0,2800,2800);ctx.fillStyle='blue';ctx.fillRect(4600,0,1800,2800);
    const blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg',.9));canvas.width=canvas.height=0;
    const oversizedJPEG=new File([blob],'synthetic.jpg',{type:'image/jpeg'});
    const avatar=await window.preparePhoto(oversizedJPEG,'user_avatar');
    const yieldInfo=async file=>{const bmp=await createImageBitmap(file);const c=document.createElement('canvas');c.width=bmp.width;c.height=bmp.height;const x=c.getContext('2d');x.drawImage(bmp,0,0);const out={width:bmp.width,height:bmp.height,middle:Array.from(x.getImageData(bmp.width>>1,bmp.height>>1,1,1).data),left:Array.from(x.getImageData(2,bmp.height>>1,1,1).data),right:Array.from(x.getImageData(bmp.width-3,bmp.height>>1,1,1).data)};bmp.close();c.width=c.height=0;return out;};
    const bg=await window.preparePhoto(oversizedJPEG,'chat_background');
    const heicError=await window.preparePhoto(new File([new Uint8Array([0,1,2,3])],'invalid.heic',{type:'image/heic'}),'user_avatar').then(()=>'',e=>e.message);
    const controller=new AbortController();const pending=window.preparePhoto(oversizedJPEG,'user_avatar',controller.signal);controller.abort();const cancelName=await pending.then(()=>'',e=>e.name);
    return {avatar:await yieldInfo(avatar),background:await yieldInfo(bg),heicError,cancelName};
  });
  assert.equal(codec.avatar.width,1024);assert.equal(codec.avatar.height,1024);
  for(const sample of [codec.avatar.left,codec.avatar.middle,codec.avatar.right])assert.ok(sample[1]>240&&sample[0]<10&&sample[2]<10,'the central square must remain green after cropping');
  assert.equal(codec.background.width,6400);assert.equal(codec.background.height,2800);
  assert.ok(codec.background.left[0]>235&&codec.background.right[2]>235,'background keeps both ends');
  assert.match(codec.heicError,/HEIC.*JPEG/);assert.equal(codec.cancelName,'AbortError');
  const api=await page.evaluate(()=>({writes:window.fixtureState.writes,contentReads:window.fixtureState.reads}));
  assert.equal(api.writes.length,9);assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  await writeFile(resolve(here,'private-photo-results.json'),JSON.stringify({browser:browser.version(),viewport:'390x844',source:'local synthetic MediaSettings + catalog hook + API wrappers + AuthenticatedImage; in-memory transport and synthetic identity',network:'loopback Vite only',records,codec,api,external,errors},null,2));
  console.log(JSON.stringify({passed:Object.keys(records),writes:api.writes.length,external,codec}));
} catch (error) {
  if (page) {
    await page.screenshot({ path: resolve(here, 'private-photo-failure.png') }).catch(() => {});
    console.error(await page.locator('body').innerText().catch(() => ''));
  }
  throw error;
} finally {await browser?.close();await server.close();}

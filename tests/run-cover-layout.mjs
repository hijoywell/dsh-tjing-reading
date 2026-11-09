// Regression: coverless books must retain a 3:4 cover, including TXT.
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url);
const source=await readFile(new URL('client.js',root),'utf8');
const css=new Function('CODE_STACK',source.slice(source.indexOf('    const BOOK_STYLES = `'),source.indexOf('    const STYLE_NODE ='))+'\nreturn BOOK_STYLES;')('monospace');
const component=source.slice(source.indexOf('    function CoverCard('),source.indexOf('    function Shelf('));
const suite=await readFile(new URL('tests/cover-layout.tabbit.js',root),'utf8');
const begin=suite.indexOf('await page.evaluate(({css,component})=>{')+'await page.evaluate(({css,component})=>{'.length;
const end=suite.indexOf('\n},{css,component});',begin);
assert.ok(begin>0 && end>begin);
const expression='(({css,component})=>{'+suite.slice(begin,end)+'\n})('+JSON.stringify({css,component})+')';
const profile=await mkdtemp(join(tmpdir(),'dsh-cover-browser-'));
const child=spawn(process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless','--disable-gpu','--no-first-run','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
let ws;
const timer=setTimeout(()=>{child.kill();console.error('Cover browser test timed out');process.exitCode=1;},60000);
try {
  let info;
  for(let i=0;i<200;i++){try{info=await readFile(join(profile,'DevToolsActivePort'),'utf8');break;}catch{await delay(50);}}
  if(!info)throw Error('Chrome endpoint unavailable');
  const [port,url]=info.trim().split(/\r?\n/);
  ws=new WebSocket(`ws://127.0.0.1:${port}${url}`);await once(ws,'open');
  let id=0;const pending=new Map();
  ws.addEventListener('message',event=>{const msg=JSON.parse(event.data);const job=pending.get(msg.id);if(job){pending.delete(msg.id);msg.error?job.reject(Error(JSON.stringify(msg.error))):job.resolve(msg.result);}});
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const next=++id;pending.set(next,{resolve,reject});ws.send(JSON.stringify({id:next,method,params,sessionId}));});
  const {targetId}=await send('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
  await send('Emulation.setDeviceMetricsOverride',{width:300,height:520,deviceScaleFactor:1,mobile:false},sessionId);
  const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);
  if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
  for(const cover of result.result.value){assert.ok(cover.width>=100);assert.ok(cover.height>=133);assert.ok(Math.abs(cover.width/cover.height-.75)<.01);}
  assert.deepEqual(result.result.value.map(cover=>cover.tag),['TXT','EPUB']);
  // Paint and fonts must settle before recording the visual preview.
  await send('Runtime.evaluate',{expression:'document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))',awaitPromise:true},sessionId);
  const screenshot=await send('Page.captureScreenshot',{format:'png'},sessionId);
  const output=join(tmpdir(),'dsh-txt-cover-preview.png');
  await writeFile(output,Buffer.from(screenshot.data,'base64'));
  console.log('PASS '+JSON.stringify(result.result.value)+'; screenshot='+output);
  await send('Browser.close');
} finally {clearTimeout(timer);ws?.close();child.kill();}

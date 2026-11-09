// Isolated browser-only integration test; does not attach to the user's browser.
// Set CHROME_PATH if Chrome is installed elsewhere. No npm dependencies needed.
import { spawn } from 'node:child_process';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';
await import('./prepare-headless-formats.mjs');
const profile = await mkdtemp(join(tmpdir(), 'dsh-ebook-browser-'));
const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const child = spawn(chrome, ['--headless','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'], {stdio:'ignore'});
let ws;
try {
  let portInfo;
  for (let i=0; i<200; i++) {
    try { portInfo = await readFile(join(profile,'DevToolsActivePort'),'utf8'); break; } catch { await delay(50); }
  }
  if (!portInfo) throw new Error('Chrome debugging endpoint did not become ready');
  const [port, url] = portInfo.trim().split(/\r?\n/);
  ws = new WebSocket(`ws://127.0.0.1:${port}${url}`);
  await once(ws,'open');
  let next=0;
  const pending=new Map();
  ws.addEventListener('message',event=>{
    const msg=JSON.parse(event.data);
    const task=pending.get(msg.id);
    if(task){pending.delete(msg.id);msg.error?task.reject(Error(JSON.stringify(msg.error))):task.resolve(msg.result);}
  });
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
    const id=++next;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,sessionId}));
  });
  const {targetId}=await send('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
  const html=await readFile(join(tmpdir(),'dsh-format-check','formats.html'),'utf8');
  const script=html.slice(html.indexOf('<script>')+8,html.lastIndexOf('</script>')).replaceAll('<\\/script','</script');
  // Return the test promise directly; never dump DOM before asynchronous parsing ends.
  const expression='(async()=>{'+script.slice(0,script.indexOf('\nrun('))+'\nreturn await '+script.slice(script.indexOf('\nrun(')+1).split('.then(result => {document.body.textContent=')[0]+';})()';
  const timer=setTimeout(()=>{console.error('Browser test timed out');child.kill();process.exitCode=1;},90000);
  try {
    const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);
    if(result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
    console.log('BROWSER PASS '+JSON.stringify(result.result.value));
  } finally { clearTimeout(timer); }
  await send('Browser.close');
} finally {
  ws?.close();
  child.kill();
}

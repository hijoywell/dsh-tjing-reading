const fs = await import('node:fs/promises');
const source = await fs.readFile('client.js','utf8');
const css = new Function('CODE_STACK',source.slice(source.indexOf('    const BOOK_STYLES = `'),source.indexOf('    const STYLE_NODE ='))+'\nreturn BOOK_STYLES;')('monospace');
const component = source.slice(source.indexOf('    function CoverCard('),source.indexOf('    function Shelf('));
const result=await page.evaluate(({css,component})=>{
  document.head.innerHTML='<meta charset="utf-8">';
  const style=document.createElement('style');style.textContent=css;document.head.append(style);
  document.body.innerHTML='<main class="bk-root" style="padding:22px;width:244px;height:auto;background:#fff;color:#333;--dsw-alias-label-primary:#222;--dsw-alias-label-secondary:#777"><div class="bk-shelf-grid"></div></main>';
  const e=(tag,props,...children)=>{
    if(typeof tag==='function')return tag(props);
    const el=document.createElement(tag);
    for(const [key,value] of Object.entries(props||{})) {
      if(key==='className')el.className=value;
      else if(key==='style')Object.assign(el.style,value);
      else if(!key.startsWith('on') && value!=null)el.setAttribute(key,value);
    }
    for(const child of children.flat(Infinity))if(child!=null && child!==false)el.append(child instanceof Node?child:document.createTextNode(String(child)));
    return el;
  };
  const CoverCard=new Function('e','useState','useMemo','useEffect','t','Icon','ICON_MORE',component+'\nreturn CoverCard;')(
    e,value=>[value,()=>{}],fn=>fn(),()=>{},key=>key,()=>{const span=document.createElement('span');span.textContent='⋯';return span;},[]);
  const grid=document.querySelector('.bk-shelf-grid');
  for(const [kind,title] of [['txt','毛泽东传'],['epub','没有封面的书']])grid.append(CoverCard({record:{id:kind,title,kind,chapterCount:1},groups:[]}));
  return [...document.querySelectorAll('.bk-cover')].map(el=>{
    const rect=el.getBoundingClientRect();
    return {width:rect.width,height:rect.height,tag:el.querySelector('.bk-cover-tag').textContent};
  });
},{css,component});
for(const cover of result){assert.ok(cover.width>=100);assert.ok(cover.height>=133);assert.ok(Math.abs(cover.width/cover.height-.75)<.01);}
return {covers:result,screenshot:await page.screenshot({fullPage:false})};

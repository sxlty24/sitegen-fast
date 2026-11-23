// Optimized drop-in for makefun-site 1.0.0 — byte-identical output, faster CPU.
// escapeHtml single scan; inline batches plain runs; slugify memoized; renderNodes array+join.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const ESC_RE = /[&<>"']/g;
const ESC_TEST = /[&<>"']/;
const escCache = new Map();
function escapeHtml(text) {
  if (!ESC_TEST.test(text)) return text;
  const hit = escCache.get(text);
  if (hit !== undefined) return hit;
  ESC_RE.lastIndex = 0;
  const r = text.replace(ESC_RE, (c) => ESC[c]);
  if (escCache.size < 4096) escCache.set(text, r);
  return r;
}
const SLUG_MAX = 64;
const slugCache = new Map();
function slugify(text) {
  const hit = slugCache.get(text);
  if (hit !== undefined) return hit;
  const plain = text.normalize('NFKD').replace(/\p{M}/gu, '');
  let out = '', gap = false;
  for (const ch of plain) {
    let keep = null;
    if (ch >= 'A' && ch <= 'Z') keep = ch.toLowerCase();
    else if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) keep = ch;
    if (keep === null) { gap = out.length > 0; continue; }
    if (gap) out += '-';
    gap = false; out += keep;
  }
  out = out.slice(0, SLUG_MAX).replace(/-+$/, '');
  if (out === '') out = 'untitled';
  slugCache.set(text, out);
  return out;
}
function uniqueSlug(slug, taken) { let out = slug; for (let n = 2; taken.has(out); n++) out = `${slug}-${n}`; taken.add(out); return out; }
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function longDate(date) { return `${Number(date.slice(8,10))} ${MONTHS[Number(date.slice(5,7))-1]} ${date.slice(0,4)}`; }

const FM_LINE = /^([a-z_]+):(?: (.*))?$/;
const FM_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const FM_NAME = /^[a-z0-9-]+$/;
const FM_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FM_TAG = /^[^"[\]]+$/;
const FM_KEYS = new Set(['title','date','tags','draft','layout','slug','summary']);
function daysIn(y,m){ if(m===2) return (y%4===0&&y%100!==0)||y%400===0?29:28; return (m===4||m===6||m===9||m===11)?30:31; }
function stringOf(raw){
  if(raw[0]==='"'){
    if(raw.length<2||raw[raw.length-1]!=='"') return {error:'a quoted string is not closed'};
    let out='';
    for(let i=1;i<raw.length-1;i++){ const c=raw[i];
      if(c==='\\'){ const n=raw[i+1]; if((n!=='"'&&n!=='\\')||i+1===raw.length-1) return {error:'a quoted string holds an escape other than \\" or \\\\'}; out+=n; i++; }
      else if(c==='"') return {error:'a quoted string holds a stray quote'};
      else out+=c; }
    return {value:out};
  }
  if(raw[0]==='[') return {error:'a bare string opens on ['};
  return {value:raw};
}
function valueOf(key,raw){
  if(key==='title'||key==='summary'){ const s=stringOf(raw); return 'error' in s?{error:`key "${key}": ${s.error}`}:s; }
  if(key==='date'){ const m=FM_DATE.exec(raw); const y=m?Number(m[1]):0,mo=m?Number(m[2]):0,d=m?Number(m[3]):0;
    if(!m||y<1970||y>2099||mo<1||mo>12||d<1||d>daysIn(y,mo)) return {error:'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)'}; return {value:raw}; }
  if(key==='tags'){ if(raw[0]!=='['||raw[raw.length-1]!==']') return {error:'key "tags": not a list [a, b]'};
    const inner=raw.slice(1,-1); if(inner.trim()==='') return {value:[]};
    const tags=inner.split(',').map(t=>t.trim()); for(const t of tags) if(t===''||!FM_TAG.test(t)) return {error:'key "tags": an empty tag, or one holding " [ or ]'}; return {value:tags}; }
  if(key==='draft') return raw==='true'?{value:true}:raw==='false'?{value:false}:{error:'key "draft": true or false'};
  if(key==='layout') return FM_NAME.test(raw)?{value:raw}:{error:'key "layout": not a template name'};
  if(key==='slug') return FM_SLUG.test(raw)&&raw.length<=64?{value:raw}:{error:'key "slug": not a slug'};
  return {error:`unknown key "${key}"`};
}
function parseFrontMatter(text){
  const lines=text.split('\n');
  if(lines[0]!=='---') return {error:'no front matter'};
  let close=-1; for(let i=1;i<lines.length;i++) if(lines[i]==='---'){close=i;break;}
  if(close===-1) return {error:'the front matter is not closed'};
  const data={};
  for(let i=1;i<close;i++){ const line=lines[i];
    if(line===''||line[0]==='#'||/^[ \t]*$/.test(line)) continue;
    const m=FM_LINE.exec(line); if(!m) return {error:`line ${i+1} is not "key: value"`};
    const key=m[1]; const raw=(m[2]??'').replace(/[ \t]+$/,'');
    if(!FM_KEYS.has(key)) return {error:`unknown key "${key}"`};
    if(Object.hasOwn(data,key)) return {error:`key "${key}" is given twice`};
    if(raw==='') return {error:`key "${key}" has no value`};
    const v=valueOf(key,raw); if('error' in v) return v; data[key]=v.value; }
  if(!Object.hasOwn(data,'title')) return {error:'no title'};
  return {data,body:lines.slice(close+1).join('\n')};
}

const BLANK=/^[ \t]*$/;
const FENCE_OPEN=/^```([A-Za-z0-9_+-]*)[ \t]*$/;
const FENCE_CLOSE=/^```[ \t]*$/;
const HEADING=/^(#{1,6})[ \t]+(.*?)[ \t]*$/;
const HR=/^(?:---|\*\*\*)[ \t]*$/;
const BULLET=/^[-*] (.*)$/;
const ORDERED=/^(\d{1,9})\. (.*)$/;
const CONTINUED=/^ {2,}\S/;
function headingOf(line){ const m=HEADING.exec(line); return m===null||m[2]===''?null:{depth:m[1].length,text:m[2]}; }
function isBlank(line){ for(let i=0;i<line.length;i++){ const c=line[i]; if(c!==' '&&c!=='\t') return false; } return true; }
function endsParagraph(line){ if(line.length===0) return true; const c0=line[0]; if(c0===' '||c0==='\t') return isBlank(line); if(c0==='`') return FENCE_OPEN.test(line); if(c0==='#') return headingOf(line)!==null; if(c0==='-'||c0==='*') return HR.test(line); return false; }
function trimLine(line){ let a=0,b=line.length; while(a<b&&(line[a]===' '||line[a]==='\t'))a++; while(b>a&&(line[b-1]===' '||line[b-1]==='\t'))b--; return a===0&&b===line.length?line:line.slice(a,b); }
function lex(src){
  const lines=src.split('\n'); const tokens=[]; let i=0; const n=lines.length;
  while(i<n){ const line=lines[i];
    if(isBlank(line)){i++;continue;}
    const fence=FENCE_OPEN.exec(line);
    if(fence!==null){ const body=[]; i++; while(i<n&&!FENCE_CLOSE.test(lines[i])) body.push(lines[i++]); i++; tokens.push({type:'code',lang:fence[1],lines:body}); continue; }
    const heading=headingOf(line);
    if(heading!==null){ tokens.push({type:'heading',depth:heading.depth,text:heading.text}); i++; continue; }
    if(HR.test(line)){ tokens.push({type:'hr'}); i++; continue; }
    if(line[0]==='>'){ const body=[]; while(i<n&&lines[i][0]==='>') body.push(trimLine(lines[i++].replace(/^> ?/,''))); tokens.push({type:'blockquote',lines:body.filter(l=>l!=='')}); continue; }
    const bullet=BULLET.exec(line); const ordered=bullet===null?ORDERED.exec(line):null;
    if(bullet!==null||ordered!==null){ const isOrdered=ordered!==null; const marker=isOrdered?ORDERED:BULLET; const items=[];
      while(i<n){ const m=marker.exec(lines[i]);
        if(m!==null){ items.push([trimLine(isOrdered?m[2]:m[1])]); i++; }
        else if(CONTINUED.test(lines[i])){ items[items.length-1].push(trimLine(lines[i])); i++; }
        else break; }
      tokens.push({type:'list',ordered:isOrdered,start:isOrdered?Number(ordered[1]):1,items:items.map(p=>p.join('\n'))}); continue; }
    const body=[trimLine(line)]; i++;
    while(i<n&&!endsParagraph(lines[i])) body.push(trimLine(lines[i++]));
    tokens.push({type:'paragraph',text:body.join('\n')}); }
  return tokens;
}
const ESCAPABLE=new Set(['\\','`','*','_','[',']','(',')','#','+','-','.','!','>']);
function findUnescaped(s,what,from){ const wl=what.length; for(let j=from;j<=s.length-wl;j++){ if(s[j]==='\\'&&j+1<s.length&&ESCAPABLE.has(s[j+1])){j++;continue;} if(s.startsWith(what,j)) return j; } return -1; }
function findSingleStar(s,from){ for(let j=from;j<s.length;j++){ const c=s[j]; if(c==='\\'&&j+1<s.length&&ESCAPABLE.has(s[j+1])){j++;continue;} if(c!=='*') continue; if(s[j+1]==='*'){j++;continue;} return j; } return -1; }
const INLINE_SPECIAL = /[\\`*[]/;
function inline(s,env){
  if(!INLINE_SPECIAL.test(s)) return escapeHtml(s);
  let out=''; let i=0,plainStart=0; const n=s.length;
  while(i<n){ const c=s[i];
    if(c==='\\'&&i+1<n&&ESCAPABLE.has(s[i+1])){ if(i>plainStart)out+=escapeHtml(s.slice(plainStart,i)); out+=escapeHtml(s[i+1]); i+=2; plainStart=i; continue; }
    if(c==='`'){ const j=s.indexOf('`',i+1); if(j>i+1){ if(i>plainStart)out+=escapeHtml(s.slice(plainStart,i)); out+='<code>'+escapeHtml(s.slice(i+1,j))+'</code>'; i=j+1; plainStart=i; continue; } i++; continue; }
    if(c==='*'){
      if(s[i+1]==='*'){ const j=findUnescaped(s,'**',i+2); if(j>i+2){ if(i>plainStart)out+=escapeHtml(s.slice(plainStart,i)); out+='<strong>'+inline(s.slice(i+2,j),env)+'</strong>'; i=j+2; plainStart=i; continue; } i+=2; continue; }
      const j=findSingleStar(s,i+1); if(j>i+1){ if(i>plainStart)out+=escapeHtml(s.slice(plainStart,i)); out+='<em>'+inline(s.slice(i+1,j),env)+'</em>'; i=j+1; plainStart=i; continue; } i++; continue; }
    if(c==='['){ const k=findUnescaped(s,']',i+1); const m=k!==-1&&s[k+1]==='('?s.indexOf(')',k+2):-1; const target=m===-1?'':s.slice(k+2,m);
      if(target!==''&&!/\s/.test(target)){ if(i>plainStart)out+=escapeHtml(s.slice(plainStart,i)); out+='<a href="'+escapeHtml(env.link(target))+'">'+inline(s.slice(i+1,k),env)+'</a>'; i=m+1; plainStart=i; continue; } i++; continue; }
    i++; }
  if(n>plainStart)out+=escapeHtml(s.slice(plainStart,n));
  return out;
}
function renderMarkdown(src,env){
  const ids=new Set(); const blocks=[]; const toc=[]; let excerpt=null;
  for(const t of lex(src)){
    if(t.type==='heading'){ const id=uniqueSlug(slugify(t.text),ids); const html=inline(t.text,env); const d=t.depth; blocks.push('<h'+d+' id="'+id+'">'+html+'</h'+d+'>\n'); if(d===2||d===3) toc.push({level:d,id,html}); }
    else if(t.type==='code'){ const cls=t.lang===''?'':' class="language-'+escapeHtml(t.lang)+'"'; let body=''; for(const l of t.lines) body+=escapeHtml(l)+'\n'; blocks.push('<pre><code'+cls+'>'+body+'</code></pre>\n'); }
    else if(t.type==='hr'){ blocks.push('<hr>\n'); }
    else if(t.type==='blockquote'){ blocks.push(t.lines.length===0?'<blockquote>\n</blockquote>\n':'<blockquote>\n<p>'+inline(t.lines.join('\n'),env)+'</p>\n</blockquote>\n'); }
    else if(t.type==='list'){ const tag=t.ordered?'ol':'ul'; const open=t.ordered&&t.start!==1?'<ol start="'+t.start+'">':'<'+tag+'>'; let body=''; for(const item of t.items) body+='<li>'+inline(item,env)+'</li>\n'; blocks.push(open+'\n'+body+'</'+tag+'>\n'); }
    else if(t.type==='paragraph'){ const html=inline(t.text,env); if(excerpt===null) excerpt=html; blocks.push('<p>'+html+'</p>\n'); } }
  return {html:blocks.join(''),toc,excerpt:excerpt??''};
}

const INCLUDE_DEPTH=8;
const T_PATH=/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const T_FOR=/^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const T_IF=/^if (not )?(\S+)$/;
const T_INCLUDE=/^include "([a-z0-9-]+)"$/;
class TemplateError extends Error {}
function pathOf(name,text){ if(!T_PATH.test(text)) throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`); return text.split('.'); }
function tokenize(name,src){
  const tokens=[]; let text='',i=0;
  while(i<src.length){ const open=src.indexOf('{',i);
    if(open===-1||open===src.length-1){ text+=src.slice(i); break; }
    const next=src[open+1];
    if(next!=='{'&&next!=='%'){ text+=src.slice(i,open+1); i=open+1; continue; }
    text+=src.slice(i,open);
    if(next==='{'){ const raw=src[open+2]==='{'; const close=src.indexOf(raw?'}}}':'}}',open+(raw?3:2));
      if(close===-1) throw new TemplateError(`template "${name}": a ${raw?'{{{':'{{'} is not closed`);
      if(text!=='') tokens.push({t:'text',text}); text='';
      tokens.push({t:raw?'raw':'var',path:pathOf(name,src.slice(open+(raw?3:2),close).trim())}); i=close+(raw?3:2); continue; }
    const close=src.indexOf('%}',open+2);
    if(close===-1) throw new TemplateError(`template "${name}": a {% is not closed`);
    const end=close+2; const lineStart=src.lastIndexOf('\n',open-1)+1; const nl=src.indexOf('\n',end); const lineEnd=nl===-1?src.length:nl;
    const standalone=/^[ \t]*$/.test(src.slice(lineStart,open))&&/^[ \t]*$/.test(src.slice(end,lineEnd));
    if(standalone) text=text.slice(0,text.length-(open-lineStart));
    if(text!=='') tokens.push({t:'text',text}); text='';
    tokens.push({t:'tag',tag:src.slice(open+2,close).trim()}); i=standalone?(nl===-1?src.length:nl+1):end; }
  if(text!=='') tokens.push({t:'text',text});
  return tokens;
}
function parseTemplate(name,src){
  const root={kind:'root',body:[]}; const stack=[root]; let body=root.body;
  for(const tok of tokenize(name,src)){
    if(tok.t==='text') body.push({kind:'text',text:tok.text});
    else if(tok.t==='var'||tok.t==='raw') body.push({kind:tok.t,path:tok.path});
    else { const tag=tok.tag; const top=stack[stack.length-1]; let m;
      if((m=T_FOR.exec(tag))!==null){ const node={kind:'for',name:m[1],path:pathOf(name,m[2]),body:[]}; body.push(node); stack.push(node); body=node.body; }
      else if((m=T_IF.exec(tag))!==null){ const node={kind:'if',not:m[1]!==undefined,path:pathOf(name,m[2]),then:[],else:null}; body.push(node); stack.push(node); body=node.then; }
      else if(tag==='else'){ if(top.kind!=='if'||top.else!==null) throw new TemplateError(`template "${name}": an else outside an if`); top.else=[]; body=top.else; }
      else if(tag==='endfor'||tag==='endif'){ if(top.kind!==(tag==='endfor'?'for':'if')) throw new TemplateError(`template "${name}": an ${tag} with no open ${tag.slice(3)}`); stack.pop(); const parent=stack[stack.length-1]; body=parent.kind==='root'?parent.body:parent.kind==='for'?parent.body:parent.else??parent.then; }
      else if((m=T_INCLUDE.exec(tag))!==null) body.push({kind:'include',name:m[1]});
      else throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`); } }
  if(stack.length>1) throw new TemplateError(`template "${name}": a ${stack[stack.length-1].kind} is not closed`);
  return root.body;
}
function lookup(scope,path){ let s=scope; while(s!==null&&!Object.hasOwn(s.vars,path[0])) s=s.parent; if(s===null) return undefined; let v=s.vars[path[0]]; for(let k=1;k<path.length;k++){ if(v===null||typeof v!=='object'||!Object.hasOwn(v,path[k])) return undefined; v=v[path[k]]; } return v; }
function textOf(v){ if(typeof v==='string') return v; if(typeof v==='number') return String(v); if(typeof v==='boolean') return v?'true':'false'; if(Array.isArray(v)) return v.map(textOf).join(', '); return ''; }
function truthy(v){ if(Array.isArray(v)) return v.length>0; return v!==undefined&&v!==null&&v!==false&&v!==''&&v!==0; }
function renderNodes(nodes,scope,ctx,depth){ const out=[]; renderInto(out,nodes,scope,ctx,depth); return out.join(''); }
function renderInto(out,nodes,scope,ctx,depth){
  for(const n of nodes){ const k=n.kind;
    if(k==='text') out.push(n.text);
    else if(k==='var') out.push(escapeHtml(textOf(lookup(scope,n.path))));
    else if(k==='raw') out.push(textOf(lookup(scope,n.path)));
    else if(k==='if'){ const v=truthy(lookup(scope,n.path)); const branch=v!==n.not?n.then:n.else; if(branch!==null) renderInto(out,branch,scope,ctx,depth); }
    else if(k==='for'){ const xs=lookup(scope,n.path); if(!Array.isArray(xs)) continue; const len=xs.length; for(let kk=0;kk<len;kk++){ const vars={[n.name]:xs[kk],loop:{index:kk+1,first:kk===0,last:kk===len-1,length:len}}; renderInto(out,n.body,{vars,parent:scope},ctx,depth); } }
    else if(k==='include'){ const t=ctx.templates.get(n.name); if(t!==undefined&&depth<INCLUDE_DEPTH) renderInto(out,t,scope,ctx,depth+1); } }
}

// ---- template compiler: nodes -> JS function (avoids per-node interpretation) ----
function jsStr(s){ return JSON.stringify(s); }
function L(scope,path){ let s=scope; const p0=path[0]; while(s!==null&&!Object.hasOwn(s.vars,p0)) s=s.parent; if(s===null) return undefined; let v=s.vars[p0]; const pl=path.length; if(pl===1) return v; for(let k=1;k<pl;k++){ if(v===null||typeof v!=='object'||!Object.hasOwn(v,path[k])) return undefined; v=v[path[k]]; } return v; }
function compileNodes(nodes, sv){
  const lines=[];
  const P=(path)=>'L('+sv+',['+path.map(jsStr).join(',')+'])';
  for(const n of nodes){ const k=n.kind;
    if(k==='text') lines.push('o+='+jsStr(n.text)+';');
    else if(k==='var') lines.push('o+=E(T('+P(n.path)+'));');
    else if(k==='raw') lines.push('o+=T('+P(n.path)+');');
    else if(k==='if'){ const cond='TR('+P(n.path)+')'+(n.not?'===false':'===true');
      lines.push('if('+cond+'){'+compileNodes(n.then,sv)+'}'+(n.else?'else{'+compileNodes(n.else,sv)+'}':'')); }
    else if(k==='for'){ const nm=jsStr(n.name); const csv='s'+(++compileDepth);
      lines.push('{const xs='+P(n.path)+';if(Array.isArray(xs)){const len=xs.length;const lp={index:0,first:false,last:false,length:len};const '+csv+'={vars:{['+nm+']:undefined,loop:lp},parent:'+sv+'};for(let kk=0;kk<len;kk++){'+csv+'.vars['+nm+']=xs[kk];lp.index=kk+1;lp.first=kk===0;lp.last=kk===len-1;'+compileNodes(n.body,csv)+'}}}'); compileDepth--; }
    else if(k==='include'){ const nm=jsStr(n.name);
      lines.push('{const t=C.get('+nm+');if(t!==undefined&&d<'+INCLUDE_DEPTH+')o=t(o,'+sv+',d+1);}'); }
  }
  return lines.join('');
}
let compileDepth=0;
function makeCompiler(templatesMap){
  const C=new Map();
  const E=escapeHtml, T=textOf, TR=truthy;
  for(const [name,nodes] of templatesMap){
    compileDepth=0;
    const body=compileNodes(nodes,'s');
    const fn=new Function('o','s','d','L','E','T','TR','C', body+'return o;');
    C.set(name,(o,s,d)=>fn(o,s,d,L,E,T,TR,C));
  }
  return C;
}

const REPORT_FILE='build-report.txt';
const RESERVED=['posts','tags','page'];
function byCodeUnits(a,b){ return a<b?-1:a>b?1:0; }
function wordsOf(text){ let c=0,inW=false; const n=text.length; for(let i=0;i<n;i++){ const ch=text.charCodeAt(i); let ws; if(ch<=127){ ws=ch===32||ch===9||ch===10||ch===13||ch===12||ch===11; } else { ws=ch===160||ch===5760||(ch>=8192&&ch<=8202)||ch===8232||ch===8233||ch===8239||ch===8287||ch===12288||ch===65279; } if(ws){inW=false;} else if(!inW){inW=true;c++;} } return c; }
function resolvePath(dir,rel){ const parts=dir===''?[]:dir.split('/'); for(const seg of rel.split('/')){ if(seg===''||seg==='.') continue; if(seg==='..'){ if(parts.length===0) return null; parts.pop(); } else parts.push(seg); } return parts.join('/'); }
function dirOf(path){ const i=path.lastIndexOf('/'); return i<0?'':path.slice(0,i); }

export function run(input){
  const templates=new Map(); const report=[];
  for(const name of Object.keys(input.templates).sort(byCodeUnits)){
    try{ templates.set(name,parseTemplate(name,input.templates[name])); }
    catch(err){ if(!(err instanceof TemplateError)) throw err; report.push(err.message); } }
  const base=input.site.base_url.replace(/\/+$/,'');
  const sources=[]; const statics=[]; const bySource=new Map(); const broken=new Set();
  const files=[...input.files].sort((x,y)=>byCodeUnits(x.path,y.path));
  for(const f of files){ if(f.path.endsWith('.md')) sources.push({path:f.path,text:f.content.replace(/\r\n?/g,'\n')}); else statics.push({path:f.path,content:f.content}); }
  const kept=[];
  for(const s of sources){
    const fm=parseFrontMatter(s.text);
    if('error' in fm){ report.push(`refused ${s.path}: ${fm.error}`); continue; }
    s.data=fm.data; s.body=fm.body; s.post=s.path.startsWith('posts/');
    let own; for(const d of RESERVED) if(d!=='posts'&&s.path.startsWith(`${d}/`)){own=d;break;}
    if(own!==undefined){ report.push(`refused ${s.path}: ${own}/ is the generator's own`); continue; }
    if(s.post&&!Object.hasOwn(s.data,'date')){ report.push(`refused ${s.path}: a post needs a date`); continue; }
    const layout=s.data.layout??(s.post?'post':'page');
    if(!templates.has(layout)){ report.push(`refused ${s.path}: layout "${layout}" is no template that parses`); continue; }
    s.layout=layout;
    if(s.data.draft===true){ report.push(`draft ${s.path}`); continue; }
    kept.push(s); }
  const taken=new Map();
  const takenIn=(dir)=>{ let t=taken.get(dir); if(t===undefined){ t=new Set(dir===''?RESERVED:[]); taken.set(dir,t); } return t; };
  for(const s of kept){
    const dir=s.post?'posts':dirOf(s.path);
    const slug=uniqueSlug(s.data.slug??slugify(s.data.title),takenIn(dir));
    s.slug=slug; s.outDir=dir===''?slug:`${dir}/${slug}`; s.url=`${base}/${s.outDir}/`; bySource.set(s.path,s); }
  const staticPaths=new Set(statics.map(f=>f.path));
  for(const s of kept){
    const dir=dirOf(s.path);
    const env={ link:(target)=>{
      if(/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)||target[0]==='/'||target[0]==='#') return target;
      const hash=target.indexOf('#'); const rel=hash===-1?target:target.slice(0,hash); const frag=hash===-1?'':target.slice(hash);
      const path=rel===''?null:resolvePath(dir,rel);
      if(path!==null&&bySource.has(path)) return `${bySource.get(path).url}${frag}`;
      if(path!==null&&staticPaths.has(path)) return `${base}/${path}${frag}`;
      broken.add(`broken-link ${s.path} -> ${target}`); return target; } };
    const md=renderMarkdown(s.body,env); s.html=md.html; s.toc=md.toc; s.excerpt=md.excerpt; }
  const posts=kept.filter(s=>s.post);
  posts.sort((x,y)=>byCodeUnits(y.data.date,x.data.date)||byCodeUnits(x.slug,y.slug));
  for(let k=0;k<posts.length;k++){ posts[k].newer=k===0?null:posts[k-1]; posts[k].older=k===posts.length-1?null:posts[k+1]; }
  const bySlug=new Map();
  const ownTags=(s)=>{ const seen=new Set(); const res=[]; for(const name of (s.data.tags??[])){ const sl=slugify(name); if(!seen.has(sl)){seen.add(sl);res.push(name);} } return res; };
  for(const p of posts){ p.tagRefs=[]; for(const name of ownTags(p)){ const slug=slugify(name); let tag=bySlug.get(slug); if(tag===undefined){ tag={name,slug,url:`${base}/tags/${slug}/`,posts:[]}; bySlug.set(slug,tag); } tag.posts.push(p); p.tagRefs.push(tag); } }
  for(const s of kept) if(!s.post) s.tagRefs=ownTags(s).map(name=>bySlug.get(slugify(name))??{name,slug:slugify(name),url:'',posts:[]});
  const tags=[...bySlug.values()].sort((x,y)=>y.posts.length-x.posts.length||byCodeUnits(x.slug,y.slug));
  const linkOf=(s)=>(s===null?null:{title:s.data.title,url:s.url,date:s.data.date??'',date_long:s.data.date===undefined?'':longDate(s.data.date)});
  const cardOf=(s)=>{ if(s._card!==undefined) return s._card; const c={ title:s.data.title,url:s.url,date:s.data.date??'',date_long:s.data.date===undefined?'':longDate(s.data.date),summary:s.data.summary??'',excerpt:s.excerpt,reading_minutes:Math.max(1,Math.ceil(wordsOf(s.body)/200)),tags:s.tagRefs.map(t=>({name:t.name,slug:t.slug,url:t.url})) }; s._card=c; return c; };
  const cards=new Map(posts.map(p=>[p,cardOf(p)]));
  const pageOf=(s)=>{ const c=cardOf(s); return { title:c.title,url:c.url,date:c.date,date_long:c.date_long,summary:c.summary,excerpt:c.excerpt,reading_minutes:c.reading_minutes,tags:c.tags,slug:s.slug,content:s.html,toc:s.toc.map(h=>({level:h.level,id:h.id,html:h.html})),newer:linkOf(s.newer??null),older:linkOf(s.older??null),is_post:s.post }; };
  const site={title:input.site.title,base_url:base};
  const allTags=tags.map(t=>({name:t.name,slug:t.slug,url:t.url,count:t.posts.length}));
  const recent=posts.slice(0,input.site.recent).map(p=>cards.get(p));
  const compiled=makeCompiler(templates);
  const render=(name,vars)=>{ const fn=compiled.get(name); if(fn===undefined) return null; return fn('',{vars:{site,tags:allTags,recent,...vars},parent:null},0); };
  const output={};
  for(const s of kept) output[`${s.outDir}/index.html`]=render(s.layout,{page:pageOf(s)});
  const per=input.site.per_page; const pages=Math.max(1,Math.ceil(posts.length/per));
  const indexUrl=(k)=>(k===1?`${base}/`:`${base}/page/${k}/`);
  for(let k=1;k<=pages;k++){ const html=render('index',{ posts:posts.slice((k-1)*per,k*per).map(p=>cards.get(p)), pager:{number:k,total:pages,url:indexUrl(k),newer_url:k===1?'':indexUrl(k-1),older_url:k===pages?'':indexUrl(k+1)} });
    if(html!==null) output[k===1?'index.html':`page/${k}/index.html`]=html; }
  const tagOf=(t)=>({name:t.name,slug:t.slug,url:t.url,count:t.posts.length,posts:t.posts.map(p=>cards.get(p))});
  for(const t of tags){ const html=render('tag',{tag:tagOf(t)}); if(html!==null) output[`tags/${t.slug}/index.html`]=html; }
  const tagsHtml=render('tags',{}); if(tagsHtml!==null) output['tags/index.html']=tagsHtml;
  for(const f of statics){ if(Object.hasOwn(output,f.path)) report.push(`shadowed ${f.path}: a built page has its path`); else output[f.path]=f.content; }
  const lines=[...report,...broken].sort(byCodeUnits);
  const pageCount=kept.filter(s=>!s.post).length;
  lines.push(`built ${pageCount} pages, ${posts.length} posts, ${tags.length} tags and ${statics.length} static files`);
  output[REPORT_FILE]=`${lines.join('\n')}\n`;
  return output;
}
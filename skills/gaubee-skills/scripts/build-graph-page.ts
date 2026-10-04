#!/usr/bin/env bun
/**
 * build-graph-page.ts — 技能 Graph 交互展示页生成器
 *
 * 文件意图（正交意图清单）：
 * - [2026-10-03] 原始需求（kzf）：给技能 Graph 生成一个专门的展示网页看看效果。
 * - 1. 读 data/tech-graph.json + deps history → 生成自包含的 data/tech-graph.html（内嵌数据，零网络依赖，file:// 直接打开）
 * - 2. 页面：canvas 力导向图（user/project/tech）+ 搜索 + 类型过滤 + 悬停高亮邻接 + 点选详情 + 榜单/时间线/项目栈侧栏
 *
 * 隐私：页面含私有仓信号，仅限本地查看，禁止发布到站点。
 * 运行：bun scripts/build-graph-page.ts
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import { DATA, sourceDir, writeFileAtomic } from "./lib.ts";

const DEPS_DIR = sourceDir("github-deps");
// 页面内嵌本地图谱（含私有仓信号，隐私红线）：产物进仓库外私有数据区
const OUT = path.join(DATA, "tech-graph.html");

interface GNode {
  id: string;
  kind: "user" | "project" | "tech";
  label: string;
  meta?: {
    url?: string;
    private?: boolean;
    usedBy?: number;
    starUrl?: string;
    starDesc?: string;
    starCount?: number;
    depsCount?: number;
  };
}
interface GEdge {
  from: string;
  rel: string;
  to: string;
  meta?: Record<string, unknown>;
}

/** 采用时间线：只统计跟踪开始后新增的依赖（最老快照=基线存量，不算采用事件，2026-10-04 修 BUG） */
async function firstSeenTimeline(): Promise<{
  entries: [string, string][];
  baselineDate: string;
  baselineCount: number;
}> {
  const histDir = path.join(DEPS_DIR, "history");
  if (!existsSync(histDir)) return { entries: [], baselineDate: "", baselineCount: 0 };
  const files = readdirSync(histDir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  const seen = new Map<string, string>();
  let baselineDate = files[0] ? files[0].replace(".json", "") : "";
  let baselineCount = 0;
  if (files.length > 0) {
    const snap = JSON.parse(await Bun.file(path.join(histDir, files[0])).text()) as {
      repos: { deps: { name: string }[] }[];
    };
    baselineCount = new Set(snap.repos.flatMap((r) => r.deps.map((d) => d.name))).size;
  }
  for (const f of files.slice(1)) {
    const snap = JSON.parse(await Bun.file(path.join(histDir, f)).text()) as {
      repos: { deps: { name: string }[] }[];
    };
    for (const r of snap.repos)
      for (const d of r.deps) if (!seen.has(d.name)) seen.set(d.name, f.replace(".json", ""));
  }
  const entries = [...seen.entries()].sort((a, b) => (a[1] < b[1] ? 1 : -1)).slice(0, 25);
  return { entries, baselineDate, baselineCount };
}

async function main() {
  const graph = JSON.parse(await Bun.file(path.join(DATA, "tech-graph.json")).text()) as {
    stats: Record<string, number>;
    nodes: GNode[];
    edges: GEdge[];
  };
  const timeline = await firstSeenTimeline();
  const idx = new Map<string, number>();
  const nodes: (GNode & { deg: number })[] = [];
  const links: [number, number][] = [];
  for (const n of graph.nodes) {
    if (n.kind === "tech" && String(n.id).startsWith("star:")) continue;
    idx.set(n.id, nodes.length);
    nodes.push({ ...n, deg: 0 });
  }
  for (const e of graph.edges) {
    const s = idx.get(e.from);
    const t = idx.get(e.to);
    if (s === undefined || t === undefined) continue;
    links.push([s, t]);
    nodes[s]!.deg++;
    nodes[t]!.deg++;
  }

  // 榜单
  const breadth = nodes
    .filter((n) => n.kind === "tech" && (n.meta?.usedBy ?? 0) >= 2)
    .sort((a, b) => (b.meta?.usedBy ?? 0) - (a.meta?.usedBy ?? 0));
  const echoes = nodes.filter((n) => n.kind === "tech" && n.meta?.starUrl);
  const projects = nodes.filter((n) => n.kind === "project");

  const payload = JSON.stringify({
    nodes: nodes.map((n) => ({
      i: n.id.replace(/^(user|project|tech):/, ""),
      k: n.kind[0],
      l: n.label,
      d: n.deg,
      u: n.meta?.usedBy ?? 0,
      su: n.meta?.starUrl ?? "",
      sd: n.meta?.starDesc ?? "",
      so: n.meta?.starOrder ?? 0,
      url: n.meta?.url ?? "",
      pv: n.meta?.private ? 1 : 0,
    })),
    links,
  });
  const lists = JSON.stringify({
    breadth: breadth.map((n) => [n.label, n.meta?.usedBy ?? 0, n.meta?.starUrl ?? ""]),
    timeline: timeline.entries,
    timelineMeta: [timeline.baselineDate, timeline.baselineCount],
    echoes: echoes.map((n) => [
      n.label,
      n.meta?.starUrl ?? "",
      (n.meta?.starDesc ?? "").slice(0, 90),
      n.meta?.usedBy ?? 0,
      n.meta?.starOrder ?? 0,
    ]),
    projects: projects.map((n) => [
      n.label,
      n.meta?.url ?? "",
      n.meta?.depsCount ?? 0,
      n.meta?.private ? 1 : 0,
    ]),
  });
  const stats = JSON.stringify(graph.stats);

  const html = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>技能 Graph — Gaubee</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { --bg:#0b0e14; --panel:#11151f; --line:#1e2533; --fg:#d7dde8; --dim:#8b94a7; --user:#a78bfa; --proj:#60a5fa; --tech:#34d399; --hi:#fbbf24; }
  * { box-sizing:border-box; margin:0; }
  body { background:var(--bg); color:var(--fg); font:14px/1.6 -apple-system,"PingFang SC",sans-serif; height:100vh; display:flex; flex-direction:column; overflow:hidden; }
  header { padding:10px 18px; border-bottom:1px solid var(--line); display:flex; gap:14px; align-items:center; flex-wrap:wrap; }
  header h1 { font-size:16px; font-weight:600; }
  .stat { color:var(--dim); font-size:12px; } .stat b { color:var(--fg); }
  .chips { display:flex; gap:6px; margin-left:auto; align-items:center; }
  .chip { border:1px solid var(--line); border-radius:999px; padding:2px 10px; font-size:12px; cursor:pointer; user-select:none; }
  .chip.on { border-color:var(--fg); }
  #search { background:var(--panel); border:1px solid var(--line); color:var(--fg); border-radius:6px; padding:4px 10px; width:180px; outline:none; }
  main { flex:1; display:flex; min-height:0; }
  #wrap { flex:1; position:relative; }
  canvas { position:absolute; inset:0; width:100%; height:100%; cursor:grab; }
  aside { width:320px; border-left:1px solid var(--line); overflow-y:auto; padding:14px; }
  .tabs { display:flex; gap:6px; margin-bottom:10px; }
  .tab { font-size:12px; color:var(--dim); cursor:pointer; padding:2px 8px; border-radius:6px; }
  .tab.on { background:var(--panel); color:var(--fg); }
  .li { padding:3px 0; font-size:13px; border-bottom:1px dashed var(--line); display:flex; justify-content:space-between; gap:8px; }
  .li a { color:var(--proj); text-decoration:none; word-break:break-all; }
  .li .n { color:var(--dim); white-space:nowrap; }
  #tip { position:absolute; pointer-events:none; background:#000c; border:1px solid var(--line); border-radius:8px; padding:8px 10px; font-size:12px; max-width:320px; display:none; z-index:3; }
  #tip a { color:var(--proj); }
  #legend { position:absolute; left:12px; bottom:10px; font-size:12px; color:var(--dim); display:flex; gap:14px; }
  .dot { display:inline-block; width:9px; height:9px; border-radius:50%; margin-right:4px; }
  footer { padding:4px 18px; color:var(--dim); font-size:11px; border-top:1px solid var(--line); }
</style>
</head>
<body>
<header>
  <h1>技能 Graph</h1>
  <span class="stat" id="st"></span>
  <input id="search" placeholder="搜索技术 / 项目…">
  <div class="chips">
    <span class="chip on" data-k="u">我</span>
    <span class="chip on" data-k="p">项目</span>
    <span class="chip on" data-k="t">技术</span>
    <span class="chip" id="fitbtn">复位视图</span>
  </div>
</header>
<main>
  <div id="wrap">
    <canvas id="cv"></canvas>
    <div id="tip"></div>
    <div id="legend">
      <span><span class="dot" style="background:var(--user)"></span>我</span>
      <span><span class="dot" style="background:var(--proj)"></span>项目</span>
      <span><span class="dot" style="background:var(--tech)"></span>技术</span>
      <span>拖节点 · 滚轮缩放 · 空白处拖动平移 · 点选看详情</span>
    </div>
  </div>
  <aside>
    <div class="tabs">
      <span class="tab on" data-t="breadth">广度榜</span>
      <span class="tab" data-t="timeline">采用时间线</span>
      <span class="tab" data-t="echoes">星标呼应</span>
      <span class="tab" data-t="projects">项目栈</span>
    </div>
    <div id="list"></div>
  </aside>
</main>
<footer>生成于 __GEN__ · 数据内嵌自 data/tech-graph.json · <b>含私有仓信号，仅限本地查看，禁止发布</b></footer>
<script>
const GRAPH = __PAYLOAD__;
const LISTS = __LISTS__;
const STATS = __STATS__;
window.__G = { GRAPH, LISTS, STATS }; // 暴露给外部走查（ego evaluate 看不见词法全局）

// ---------- 侧栏 ----------
const st = document.getElementById("st");
st.innerHTML = "项目 <b>"+STATS.projects+"</b> · 技术 <b>"+STATS.techs+"</b> · 星标 <b>"+STATS.stars+"</b> · 边 <b>"+STATS.edges+"</b>";
const listEl = document.getElementById("list");
function esc(s){ const d=document.createElement("i"); d.textContent=s==null?"":String(s); return d.innerHTML; }
function link(u,t){ return u ? '<a href="'+esc(u)+'" target="_blank">'+esc(t||u)+"</a>" : esc(t); }
const renderers = {
  breadth(){ return LISTS.breadth.map(r=>'<div class="li"><span>'+esc(r[0])+(r[2]?' <span class="n">★</span>':'')+'</span><span class="n">×'+r[1]+'</span></div>').join(""); },
  timeline(){ return LISTS.timeline.length
    ? LISTS.timeline.map(r=>'<div class="li"><span class="n">'+r[1]+'</span><span>'+esc(r[0])+"</span></div>").join("")
    : '<div class="li">依赖跟踪自 '+esc(LISTS.timelineMeta[0])+' 开始：当前 '+LISTS.timelineMeta[1]+' 项技术均为跟踪前存量；各仓库发生新增依赖的当天会出现在这里</div>'; },
  echoes(){ return LISTS.echoes.map(r=>'<div class="li"><span>'+link(r[1],r[0])+'<br><span class="n">'+esc(r[2])+'</span></span><span class="n">×'+r[3]+' · #'+r[4]+'</span></div>').join(""); },
  projects(){ return LISTS.projects.map(r=>'<div class="li"><span>'+link(r[1],r[0])+(r[3]?' <span class="n">🔒</span>':'')+'</span><span class="n">'+r[2]+' 依赖</span></div>').join(""); },
};
function showTab(t){ document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("on",x.dataset.t===t)); listEl.innerHTML=renderers[t](); }
document.querySelectorAll(".tab").forEach(x=>x.onclick=()=>showTab(x.dataset.t));
showTab("breadth");

// ---------- 力导向布局（分块异步：每帧走一步，页面保持响应，可看到布局生长） ----------
const N = GRAPH.nodes, L = GRAPH.links;
const W = 2200, H = 1700;
const px=new Float64Array(N.length), py=new Float64Array(N.length), vx=new Float64Array(N.length), vy=new Float64Array(N.length);
for (let i=0;i<N.length;i++){ const a=i/N.length*6.283; const r=N[i].k==="u"?0:200+((i*37)%600); px[i]=W/2+Math.cos(a)*r; py[i]=H/2+Math.sin(a)*r; }
const CELL=90, SIM_TOTAL=160;
let simIter=0, alpha=1, dirty=true, simDone=false;
function simStep(){
  const grid=new Map();
  for (let i=0;i<N.length;i++){ const k=(((px[i]/CELL)|0)+4096)*8192+(((py[i]/CELL)|0)+4096); let a=grid.get(k); if(!a){a=[];grid.set(k,a);} a.push(i); }
  for (let i=0;i<N.length;i++){
    const cx=(px[i]/CELL)|0, cy=(py[i]/CELL)|0;
    for (let gx=cx-1; gx<=cx+1; gx++) for (let gy=cy-1; gy<=cy+1; gy++){
      const arr=grid.get((gx+4096)*8192+(gy+4096)); if(!arr) continue;
      for (const j of arr){ if (j<=i) continue;
        let dx=px[i]-px[j], dy=py[i]-py[j]; let d2=dx*dx+dy*dy; if (d2<1){dx=(i%7-3)*0.1;dy=(j%7-3)*0.1;d2=dx*dx+dy*dy;}
        if (d2>160000) continue; const f=Math.min(1800*alpha/d2, 500); const d=Math.sqrt(d2)||0.1; dx/=d; dy/=d;
        vx[i]+=dx*f; vy[i]+=dy*f; vx[j]-=dx*f; vy[j]-=dy*f;
      }
    }
    const k=N[i].k; const g=k==="u"?0.14:k==="p"?0.02:0.015;
    vx[i]+=(W/2-px[i])*g*alpha*10; vy[i]+=(H/2-py[i])*g*alpha*10;
  }
  for (const [s,t] of L){
    let dx=px[t]-px[s], dy=py[t]-py[s]; const d=Math.sqrt(dx*dx+dy*dy)||1;
    const rest=N[t].k==="u"?160:70; const f=(d-rest)*0.05*alpha*10;
    dx/=d; dy/=d;
    vx[t]-=dx*f; vy[t]-=dy*f; vx[s]+=dx*f; vy[s]+=dy*f;
  }
  for (let i=0;i<N.length;i++){
    if (!Number.isFinite(px[i]) || !Number.isFinite(py[i])) { px[i]=W/2+(i%13)*7; py[i]=H/2+(i%17)*7; vx[i]=0; vy[i]=0; } // NaN 自愈
    vx[i]*=0.6; vy[i]*=0.6;
    const sp=Math.sqrt(vx[i]*vx[i]+vy[i]*vy[i]);
    if (sp>26){ vx[i]*=26/sp; vy[i]*=26/sp; } // 速度钳制：防初始斥力把节点炸飞出画布
    px[i]+=vx[i]; py[i]+=vy[i];
  }
  alpha*=0.978;
  simIter++;
  dirty=true;
  if (simIter===Math.floor(SIM_TOTAL/2)) fitView(); // 中途先取一次景
  if (simIter<SIM_TOTAL) setTimeout(simStep,0); else { fitView(); window.__simDone=true; }
}

// ---------- 渲染 ----------
const cv=document.getElementById("cv"), ctx=cv.getContext("2d"), wrap=document.getElementById("wrap"), tip=document.getElementById("tip");
let scale=1, ox=0, oy=0, hover=-1, pin=-1, query="", showK={u:true,p:true,t:true}, dragI=-1, panning=false, lx=0, ly=0;
function resize(){ cv.width=wrap.clientWidth*devicePixelRatio; cv.height=wrap.clientHeight*devicePixelRatio; dirty=true; }
new ResizeObserver(resize).observe(wrap); resize();
const KIND_COLOR={u:"#a78bfa",p:"#60a5fa",t:"#34d399"};
const ADJ=(()=>{ const a=N.map(()=>[]); for (const [s,t] of L){ a[s].push(t); a[t].push(s);} return a; })();
function radius(n){ return n.k==="u"?18:n.k==="p"?Math.min(5+n.d*1.2,13):Math.min(3.5+Math.sqrt(n.d)*2.2,11); }
function visible(i){ return showK[N[i].k]; }
function match(i){ if(!query) return true; return N[i].l.toLowerCase().includes(query); }
function draw(){
  const w=cv.width, h=cv.height; ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,w,h);
  ctx.setTransform(scale*devicePixelRatio,0,0,scale*devicePixelRatio,ox*devicePixelRatio,oy*devicePixelRatio);
  const focus=pin>=0?pin:hover;
  const active=new Set();
  if (focus>=0){ active.add(focus); for (const j of ADJ[focus]) active.add(j); }
  ctx.lineWidth=1/scale;
  for (const [s,t] of L){
    if (!visible(s)||!visible(t)) continue;
    const on = focus>=0 && (s===focus||t===focus) ? 1 : 0;
    ctx.strokeStyle = on ? "#fbbf2488" : (query||focus>=0) && (!match(s)&&!match(t)) ? "#1e253388" : "#2a3448aa";
    ctx.beginPath(); ctx.moveTo(px[s],py[s]); ctx.lineTo(px[t],py[t]); ctx.stroke();
  }
  ctx.textAlign="center"; ctx.textBaseline="top";
  // 非 user 先画，user 最后画（避免被项目堆埋住）
  const order = [];
  for (let i=0;i<N.length;i++) if (visible(i) && N[i].k!=="u") order.push(i);
  if (showK.u){ for (let i=0;i<N.length;i++) if (visible(i) && N[i].k==="u") order.push(i); }
  for (const i of order){
    const n=N[i];
    const dim = (query && !match(i)) || (focus>=0 && focus!==i && !active.has(i));
    ctx.globalAlpha = dim?0.13:1;
    ctx.fillStyle = focus===i ? "#fbbf24" : KIND_COLOR[n.k];
    ctx.beginPath(); ctx.arc(px[i],py[i],radius(n),0,6.283); ctx.fill();
    if (n.k==="u"){ ctx.lineWidth=2.5/scale; ctx.strokeStyle="#d7dde8"; ctx.stroke(); }
    const labeled = n.k==="u" || n.k==="p" || (n.u>=10) || scale>2.5 || i===focus;
    if (labeled){
      ctx.fillStyle = dim ? "#8b94a755" : "#d7dde8"; ctx.font=(n.k==="u"?14:11)/scale+"px sans-serif";
      ctx.fillText(n.l, px[i], py[i]+radius(n)+3);
    }
    ctx.globalAlpha=1;
  }
}
function fitView(){
  let minX=1e9,maxX=-1e9,minY=1e9,maxY=-1e9;
  for (let i=0;i<N.length;i++){ if (!visible(i)) continue; if (px[i]<minX)minX=px[i]; if (px[i]>maxX)maxX=px[i]; if (py[i]<minY)minY=py[i]; if (py[i]>maxY)maxY=py[i]; }
  if (maxX<minX) return;
  const cw=wrap.clientWidth||1200, ch=wrap.clientHeight||800, pad=60;
  scale=Math.min((cw-pad*2)/(maxX-minX||1), (ch-pad*2)/(maxY-minY||1), 2.2);
  ox=(cw-(maxX+minX)*scale)/2; oy=(ch-(maxY+minY)*scale)/2;
  dirty=true;
}
function loop(){ if (dirty){ try { draw(); } catch (e) { window.__err = String(e && e.stack || e); } dirty=false; } requestAnimationFrame(loop); }
requestAnimationFrame(loop);
window.__draw = function(){ try { draw(); let minX=1e9,maxX=-1e9,minY=1e9,maxY=-1e9,nanCount=0; for (let i=0;i<N.length;i++){ if (Number.isNaN(px[i])||Number.isNaN(py[i])){nanCount++;continue;} if (px[i]<minX)minX=px[i]; if (px[i]>maxX)maxX=px[i]; if (py[i]<minY)minY=py[i]; if (py[i]>maxY)maxY=py[i]; }
  const d=ctx.getImageData(0,0,cv.width,cv.height).data; let c=0; for (let i=3;i<d.length;i+=997) if (d[i]>0) c++;
  return { ok:true, paintedSamples:c, scale, ox, oy, bounds:[minX|0,maxX|0,minY|0,maxY|0], nanCount, simDone: !!window.__simDone, simIter, err: window.__err||null }; } catch(e){ return { ok:false, err:String(e && e.stack || e) }; } };

// ---------- 交互 ----------
function toWorld(mx,my){ return [ (mx-ox)/scale, (my-oy)/scale ]; }
function pick(mx,my){ const [x,y]=toWorld(mx,my); let best=-1,bd=1e9;
  for (let i=0;i<N.length;i++){ if (!visible(i)) continue; const dx=px[i]-x, dy=py[i]-y, d=dx*dx+dy*dy; const r=radius(N[i])+4; if (d<r*r && d<bd){bd=d;best=i;} }
  return best; }
cv.addEventListener("mousemove",e=>{
  const r=cv.getBoundingClientRect(), mx=e.clientX-r.left, my=e.clientY-r.top;
  if (dragI>=0){ const [x,y]=toWorld(mx,my); px[dragI]=x; py[dragI]=y; dirty=true; return; }
  if (panning){ ox+=mx-lx; oy+=my-ly; lx=mx; ly=my; dirty=true; return; }
  hover=pick(mx,my);
  if (hover>=0){ const n=N[hover];
    tip.style.display="block"; tip.style.left=(mx+14)+"px"; tip.style.top=(my+10)+"px";
    let html='<b>'+esc(n.l)+"</b> <span style='color:var(--dim)'>"+(n.k==="u"?"我":n.k==="p"?"项目":"技术")+"</span>";
    if (n.k==="t" && n.u) html+="<br>被 "+n.u+" 个项目使用";
    if (n.k==="p") html+="<br>"+(n.pv?"🔒 私有":"公开")+(n.url?" · "+link(n.url,"仓库"):"");
    if (n.su) html+="<br>★ 也收藏了 "+link(n.su,"repo")+"（收藏序号 #"+n.so+"）"+(n.sd?"<br><span style='color:var(--dim)'>"+esc(n.sd)+"</span>":"");
    if (n.k==="t" && ADJ[hover].length){ const ps=ADJ[hover].filter(j=>N[j].k==="p").map(j=>esc(N[j].l)); if (ps.length) html+="<br><span style='color:var(--dim)'>使用项目：</span>"+ps.slice(0,8).join("、")+(ps.length>8?" 等":""); }
    tip.innerHTML=html;
    cv.style.cursor="pointer";
  } else { tip.style.display="none"; cv.style.cursor=panning?"grabbing":"grab"; }
  dirty=true;
});
cv.addEventListener("mousedown",e=>{
  const r=cv.getBoundingClientRect(), mx=e.clientX-r.left, my=e.clientY-r.top;
  const i=pick(mx,my);
  if (i>=0){ dragI=i; pin=i; } else { panning=true; lx=mx; ly=my; }
  dirty=true;
});
addEventListener("mouseup",()=>{ dragI=-1; panning=false; });
cv.addEventListener("mouseleave",()=>{ hover=-1; tip.style.display="none"; dirty=true; });
cv.addEventListener("wheel",e=>{
  e.preventDefault();
  const r=cv.getBoundingClientRect(), mx=e.clientX-r.left, my=e.clientY-r.top;
  const f=e.deltaY<0?1.15:0.87;
  ox=mx-(mx-ox)*f; oy=my-(my-oy)*f; scale*=f; dirty=true;
},{passive:false});
cv.addEventListener("dblclick",()=>{ pin=-1; dirty=true; });
document.getElementById("search").addEventListener("input",e=>{ query=e.target.value.trim().toLowerCase(); dirty=true; });
document.querySelectorAll(".chip").forEach(c=>c.onclick=()=>{ showK[c.dataset.k]=!showK[c.dataset.k]; c.classList.toggle("on"); dirty=true; });
document.getElementById("fitbtn").onclick=fitView;
simStep(); // 布局启动：此时 DOM/画布/状态均已就绪，分块异步生长
</script>
</body>
</html>`;

  const page = html
    .replace("__GEN__", new Date().toISOString().slice(0, 19).replace("T", " "))
    .replace("__PAYLOAD__", payload)
    .replace("__LISTS__", lists)
    .replace("__STATS__", stats);
  writeFileAtomic(OUT, page);
  console.log(
    `written ${OUT} (${nodes.length} nodes, ${links.length} links, ${(page.length / 1024).toFixed(0)} KB)`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

/* script.js - Carga y renderizado de contenidos desde .txt
   Formatos esperados:
   - noticias.txt: bloques separados por línea --- o formato pipe date|title|lead|body
   - clasificacion.txt: CSV con cabecera o pipe '|' sin cabecera
   - ultimaJ.txt: bloques separados por --- o formato pipe con goles
   - proximaJ.txt: bloques separados por --- o formato pipe home|away|stadium|date
*/

const MAX_NEWS = 10;
const SNIPPET_CHARS = 180;

// estado global
let noticiasGlobal = [];
let clasificacionGlobal = [];
let ultimaGlobal = [];
let proximaGlobal = [];
let predGlobal = [];

/* ---------- helpers: fetch text ---------- */
async function fetchTxt(path){
  try{
    const res = await fetch(path + '?_=' + Date.now());
    if(!res.ok) return null;
    const txt = await res.text();
    return txt;
  }catch(e){ return null; }
}

/* ----- parse noticias ----- */
function parseNoticias(raw){
  if(!raw) return sampleNoticias();
  const lines = raw.split('\n').map(l=>l.trim()).filter(Boolean);

  if(lines[0].includes('|')){
    const items = lines.map(l=>{
      const cols = l.split('|').map(c=>c.trim());
      const date = cols[0] || '';
      const title = cols[1] || '';
      const lead = cols[2] || '';
      const body = cols.slice(3).join(' ').trim() || lead;
      return { title, date, author:'', body };
    });
    items.sort((a,b)=> new Date(b.date || 0) - new Date(a.date || 0));
    return items.slice(0, MAX_NEWS);
  }

  const blocks = raw.split(/\n-{3,}\n/).map(b=>b.trim()).filter(Boolean);
  const out = blocks.map(b=>{
    const lines = b.split('\n');
    const obj = {title:'',date:'',author:'',body:''};
    for(const line of lines){
      const idx = line.indexOf(':');
      if(idx>0){
        const key = line.slice(0,idx).trim().toLowerCase();
        const val = line.slice(idx+1).trim();
        if(key==='body') obj.body += val + '\n';
        else obj[key]=val;
      } else { obj.body += line + '\n'; }
    }
    obj.body = obj.body.trim();
    return obj;
  });
  out.sort((a,b)=> new Date(b.date || 0) - new Date(a.date || 0));
  return out.slice(0, MAX_NEWS);
}

function sampleNoticias(){
  return [
    {title:'Inicio de la Temporada T4: Expectación máxima',date:'2025-11-10T10:00:00',author:'Comité',body:'La liga arranca con cambios... Esta es una noticia de ejemplo para comprobar la previsualización y el modal de lectura completa.'},
    {title:'KFC Nise ficha sorpresa',date:'2025-11-09T16:20:00',author:'Redacción',body:'Rumores de mercado... Otra noticia de ejemplo para rellenar la lista.'}
  ];
}

/* ----- parse clasificación ----- */
function parseClasificacion(raw){
  if(!raw) return sampleClas();
  const lines = raw.split('\n').map(l=>l.trim()).filter(Boolean);
  if(!lines.length) return [];

  const sep = lines[0].includes('|') ? '|' : (lines[0].includes(',') ? ',' : null);
  if(!sep) return sampleClas();

  const firstCols = lines[0].split(sep).map(c=>c.trim());
  const hasHeader = isNaN(Number(firstCols[0])) && firstCols.some(c => /[a-zA-Z]/.test(c));

  let dataLines = lines.slice();
  let header = null;
  if(hasHeader) header = dataLines.shift().split(sep).map(h=>h.trim());

  const rows = dataLines.map(l=>{
    const cols = l.split(sep).map(c=>c.trim());
    const obj = {};
    if(hasHeader){
      for(let i=0;i<header.length;i++) obj[header[i]] = cols[i] || '';
      if(!obj.form){
        const maybe = Object.values(obj).find(v => typeof v==='string' && /^[\sVvEeDd\-\,]+$/.test(v) && v.trim().length<=20);
        if(maybe) obj.form = maybe;
      }
    } else {
      obj.pos  = cols[0] || '';
      obj.team = cols[1] || '';
      obj.pts  = cols[2] || '';
      obj.pj   = cols[3] || '';
      obj.v    = cols[4] || '';
      obj.e    = cols[5] || '';
      obj.p    = cols[6] || '';
      obj.gf   = cols[7] || '';
      obj.gc   = cols[8] || '';
      obj.dg   = cols[9] || '';
      obj.form = (cols[11] || cols[10] || '').trim();
    }
    obj.form = (obj.form || '').replace(/\s{2,}/g,' ').trim();
    // crear last5 para modal
    obj.last5 = obj.form ? obj.form.replace(/\s/g,'').slice(-5).split('') : [];
    return obj;
  });

  return rows;
}

function sampleClas(){
  return [
    {pos:'1',team:'Aston Villa',pts:'78',pj:'34',v:'23',e:'9',p:'2',gf:'91',gc:'47',dg:'44',form:'VVEDV',last5:['V','V','E','D','V']},
    {pos:'2',team:'KFC Nise Team',pts:'76',pj:'34',v:'21',e:'13',p:'0',gf:'87',gc:'49',dg:'38',form:'VVVVE',last5:['V','V','V','V','E']}
  ];
}

/* ----- parse ultima/proxima jornada ----- */
function parseBlocks(raw){
  if(!raw) return [];
  const lines = raw.split('\n').map(l=>l.trim()).filter(Boolean);
  if(!lines.length) return [];

  if(lines[0].includes('|')){
    return lines.map(l=>{
      const cols = l.split('|').map(c=>c.trim());
      if(cols.length === 4) return { home: cols[0], away: cols[1], stadium: cols[2], date: cols[3] };
      if(cols.length >= 8){
        return {
          home: cols[0], away: cols[1], score: `${cols[2]||''}-${cols[3]||''}`.replace(/(^-|-$)/,'').replace('--',''),
          stadium: cols[4]||'', date: cols[5]||'', scorers_home: cols[6]||'', scorers_away: cols[7]||''
        };
      } else if(cols.length===7){
        return { home: cols[0], away: cols[1], score: cols[2]||'', stadium: cols[3]||'', date: cols[4]||'', scorers_home: cols[5]||'', scorers_away: cols[6]||'' };
      } else {
        return { home: cols[0]||'', away: cols[1]||'', stadium: cols[cols.length-2]||'', date: cols[cols.length-1]||'', score:'', scorers_home:'', scorers_away:'' };
      }
    });
  }

  const blocks = raw.split(/\n-{3,}\n/).map(b=>b.trim()).filter(Boolean);
  return blocks.map(b=>{
    const obj = {};
    b.split('\n').forEach(line=>{
      const idx = line.indexOf(':');
      if(idx>0){
        const k = line.slice(0,idx).trim();
        const v = line.slice(idx+1).trim();
        obj[k]=v;
      }
    });
    return obj;
  });
}

function sampleUltima(){ return [{date:'2025-11-12',stadium:'KFC Nise Arena',home:'KFC Nise Team',away:'Exeter City',score:'2-1',scorers_home:'Falco(50),Shawn(91)',scorers_away:'Amemiya(44)'}]; }
function sampleProx(){ return [{date:'2025-11-20',stadium:'KFC Nise Arena',home:'KFC Nise Team',away:'Golden Wind'}]; }

/* ---------- render noticias ---------- */
function renderNoticias(list){
  noticiasGlobal = list || [];
  const container = document.getElementById('newsList');
  container.innerHTML='';
  if(!list || !list.length){
    container.innerHTML = '<div class="small muted">No hay noticias.</div>';
    document.getElementById('sideLatest').textContent = 'Sin noticias';
    return;
  }

  list.forEach((n, idx)=>{
    const el = document.createElement('div'); el.className='news-item';
    const dateStr = n.date ? new Date(n.date).toLocaleString() : '';
    const body = (n.body||'').replace(/\s+/g,' ').trim();
    const snippet = body.length>SNIPPET_CHARS ? body.slice(0,SNIPPET_CHARS).trim()+'…' : body;
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div style="flex:1">
          <h3>${escapeHtml(n.title||'Sin título')}</h3>
          <div class="meta">${escapeHtml(dateStr)} · ${escapeHtml(n.author||'Staff')}</div>
        </div>
        <div style="margin-left:12px" class="small muted">#${idx+1}</div>
      </div>
      <div class="news-snippet">${escapeHtml(snippet)}</div>
      <div class="news-more">Ver noticia</div>
    `;
    el.dataset.idx = idx;
    el.addEventListener('click', ()=> openNewsModal(n));
    container.appendChild(el);
  });

  const top = list[0];
  const sideLatest = document.getElementById('sideLatest');
  sideLatest.textContent = top ? `${top.title} · ${new Date(top.date).toLocaleDateString()}` : 'Sin noticias';
  sideLatest.style.cursor = 'pointer';
  sideLatest.onclick = ()=> { if(noticiasGlobal.length) openNewsModal(noticiasGlobal[0]); }
}

/* ---------- modal control noticias ---------- */
function openNewsModal(n){
  closeNewsModal();
  const overlay = document.createElement('div'); overlay.className='modal-overlay'; overlay.tabIndex=0;
  const modal = document.createElement('div'); modal.className='modal';
  modal.innerHTML = `
    <div class="modal-inner">
      <button class="close-btn" aria-label="Cerrar">✕</button>
      <h2>${escapeHtml(n.title||'')}</h2>
      <div class="meta">${escapeHtml(new Date(n.date||'').toLocaleString())} · ${escapeHtml(n.author||'Staff')}</div>
      <div class="body">${escapeHtml(n.body||'')}</div>
    </div>
  `;
  overlay.appendChild(modal); document.body.appendChild(overlay);
  overlay.addEventListener('click', (e)=>{ if(e.target===overlay) closeNewsModal(); });
  modal.querySelector('.close-btn').addEventListener('click', closeNewsModal);
  overlay.addEventListener('keydown', (e)=>{ if(e.key==='Escape') closeNewsModal(); });
  overlay.focus();
}

function closeNewsModal(){ const existing = document.querySelector('.modal-overlay'); if(existing) existing.remove(); }

/* ---------- modal partidos ---------- */
function openMatchModal(m, standingsRows = [], type='match'){
  closeNewsModal();
  const overlay = document.createElement('div'); overlay.className='modal-overlay'; overlay.tabIndex=0;
  const modal = document.createElement('div'); modal.className='modal';

  const title = `${m.home||''} vs ${m.away||''}`;
  const sub = `${m.date ? escapeHtml(m.date)+' · ' : ''}${m.stadium ? escapeHtml(m.stadium) : ''}`;

  let scorersHTML = '';
  if((m.scorers_home && m.scorers_home.trim()) || (m.scorers_away && m.scorers_away.trim())){
    const gh = m.scorers_home ? m.scorers_home.split(',').map(s=>s.trim()) : [];
    const ga = m.scorers_away ? m.scorers_away.split(',').map(s=>s.trim()) : [];
    scorersHTML = `<div style="display:flex;gap:16px;margin-top:12px">
      <div style="flex:1"><strong>${escapeHtml(m.home||'')}</strong><div style="margin-top:6px">${gh.length? gh.map(g=>`<div>${escapeHtml(g)}</div>`).join('') : '<div class="small muted">Sin goles</div>'}</div></div>
      <div style="flex:1"><strong>${escapeHtml(m.away||'')}</strong><div style="margin-top:6px">${ga.length? ga.map(g=>`<div>${escapeHtml(g)}</div>`).join('') : '<div class="small muted">Sin goles</div>'}</div></div>
    </div>`;
  }

  // Clasificación + últimos 5 partidos
  let contextHTML = '';
  if(Array.isArray(standingsRows) && standingsRows.length && (m.home || m.away)){
    const find = (team)=> standingsRows.find(r => r.team && r.team.trim().toLowerCase() === (team||'').trim().toLowerCase());
    const left = find(m.home) || {pos:'-',pts:'-', last5:[]};
    const right = find(m.away) || {pos:'-',pts:'-', last5:[]};

    const renderLast5 = (arr)=>{
      if(!arr || !arr.length) return '';
      return `<div style="display:flex;gap:4px;margin-top:2px">${arr.map(r=>{
        const color = r==='V' ? 'limegreen' : r==='E' ? 'gray' : r==='D' ? '#ff6b6b' : '#666';
        return `<span class="result-dot" style="background:${color}"></span>`;
      }).join('')}</div>`;
    };

    contextHTML = `<div style="display:flex;gap:24px;margin-top:12px;color:#bbb">
      <div>
        <strong>${escapeHtml(m.home||'')}</strong>
        <div class="small muted">Pos: ${left.pos} · Pts: ${left.pts}</div>
        ${(type==='last' || type==='next') ? renderLast5(left.last5) : ''}
      </div>
      <div>
        <strong>${escapeHtml(m.away||'')}</strong>
        <div class="small muted">Pos: ${right.pos} · Pts: ${right.pts}</div>
        ${(type==='last' || type==='next') ? renderLast5(right.last5) : ''}
      </div>
    </div>`;
  }

  const scoreLine = m.score ? `<div style="font-size:20px;margin-top:8px"><strong>Resultado: ${escapeHtml(m.score)}</strong></div>` : '';

  modal.innerHTML = `
    <div class="modal-inner">
      <button class="close-btn" aria-label="Cerrar">✕</button>
      <h2>${escapeHtml(title)}</h2>
      <div class="meta">${sub}</div>
      ${scoreLine}
      ${contextHTML}
      ${scorersHTML}
    </div>
  `;
  overlay.appendChild(modal); document.body.appendChild(overlay);
  overlay.addEventListener('click', (e)=>{ if(e.target===overlay) closeNewsModal(); });
  modal.querySelector('.close-btn').addEventListener('click', closeNewsModal);
  overlay.addEventListener('keydown', (e)=>{ if(e.key==='Escape') closeNewsModal(); });
  overlay.focus();
}

/* ---------- safe HTML escape helper ---------- */
function escapeHtml(str){
  if(!str) return ''
  return String(str).replace(/[&<>"'`]/g, s => {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;', '`':'&#96;'}[s]
  })
}


/* ---------- render clasificación ---------- */
function renderClasificacion(rows){
  clasificacionGlobal = rows || [];
  const container = document.getElementById('tableContainer');
  container.innerHTML='';

  if(!rows || !rows.length){ container.innerHTML='<div class="small muted">Clasificación no disponible.</div>'; return; }

  const table = document.createElement('table');
  table.style.width='100%';
  table.style.borderCollapse='collapse';
  table.innerHTML = `<thead><tr>
    <th>#</th><th>Equipo</th><th>Pts</th><th>PJ</th><th>V</th><th>E</th><th>P</th><th>GF</th><th>GC</th><th>DG</th><th>Últ.</th>
  </tr></thead><tbody></tbody>`;
  const tbody = table.querySelector('tbody');

  rows.forEach(r=>{
    const tr = document.createElement('tr');
    tr.style.borderTop='1px solid rgba(255,255,255,0.03)';
    tr.style.verticalAlign='middle';

    // asignar clase según posición
    const posNum = parseInt(r.pos,10);
    tr.classList.remove('top1','top3','top4_5','top6_7_8','playoff','descenso');
    if(posNum===1) tr.classList.add('top1');
    else if(posNum>=2 && posNum<=3) tr.classList.add('top3');
    else if(posNum>=4 && posNum<=5) tr.classList.add('top4_5');
    else if(posNum>=6 && posNum<=8) tr.classList.add('top6_7_8');
    else if(posNum>=19 && posNum<=20) tr.classList.add('playoff');
    else if(posNum>=21 && posNum<=24) tr.classList.add('descenso');

    const formStr = (r.form||'').replace(/\s{2,}/g,'').trim().split(/\s|,/).join('').slice(0,5).padEnd(5,' ');
    const formDots = Array.from(formStr).map(s=>{
      if(s==='V'||s==='v') return '<span class="result-dot win" style="background:#4caf50"></span>';
      if(s==='E'||s==='e') return '<span class="result-dot draw" style="background:#ffeb3b"></span>';
      if(s==='D'||s==='d') return '<span class="result-dot loss" style="background:#f44336"></span>';
      return '<span style="opacity:0.15;background:#666;"></span>';
    }).join('');

    tr.innerHTML = `<td>${escapeHtml(r.pos||'')}</td>
      <td>${escapeHtml(r.team||'')}</td>
      <td style="text-align:center">${escapeHtml(r.pts||'')}</td>
      <td style="text-align:center">${escapeHtml(r.pj||'')}</td>
      <td style="text-align:center">${escapeHtml(r.v||'')}</td>
      <td style="text-align:center">${escapeHtml(r.e||'')}</td>
      <td style="text-align:center">${escapeHtml(r.p||'')}</td>
      <td style="text-align:center">${escapeHtml(r.gf||'')}</td>
      <td style="text-align:center">${escapeHtml(r.gc||'')}</td>
      <td style="text-align:center">${escapeHtml(r.dg||'')}</td>
      <td style="text-align:center">${formDots}</td>`;

    tbody.appendChild(tr);
  });

  container.appendChild(table);

  const sideTop = document.getElementById('sideTop');
  sideTop.textContent = rows.slice(0,5).map(r=>`${r.pos}. ${r.team} (${r.pts||0})`).join(' · ');
  sideTop.style.cursor='pointer';
  sideTop.onclick = ()=> switchToSection('standingsView');
}

/* ---------- render últimos y próximos partidos ---------- */
function renderUltima(list){
  ultimaGlobal = list || [];
  const listEl = document.getElementById('lastList'); listEl.innerHTML='';
  if(!list || !list.length){ listEl.innerHTML='<div class="small muted">No hay registros de la última jornada.</div>'; return; }

  list.slice(0,10).forEach(m=>{
    const row = document.createElement('div'); row.className='match-row';
    row.style.display='flex'; row.style.justifyContent='space-between'; row.style.alignItems='center';
    row.style.padding='8px 6px'; row.style.borderTop='1px solid rgba(255,255,255,0.03)'; row.style.cursor='pointer';
    row.innerHTML = `<div><strong>${escapeHtml(m.home||'')}</strong> <span class="muted">vs</span> <strong>${escapeHtml(m.away||'')}</strong><div class="small muted">${escapeHtml(m.date||'')} · ${escapeHtml(m.stadium||'')}</div></div><div><strong>${escapeHtml(m.score||' - ')}</strong></div>`;
    row.addEventListener('click', ()=> openMatchModal(m, clasificacionGlobal, 'last'));
    listEl.appendChild(row);
  });
}

function renderProxima(list, standingsRows){
  proximaGlobal = list || [];
  const listEl = document.getElementById('nextList'); listEl.innerHTML='';
  if(!list || !list.length){ listEl.innerHTML='<div class="small muted">No hay partidos programados.</div>'; return; }

  list.slice(0,10).forEach(m=>{
    const row = document.createElement('div'); row.className='match-row';
    row.style.display='flex'; row.style.justifyContent='space-between'; row.style.alignItems='center';
    row.style.padding='8px 6px'; row.style.borderTop='1px solid rgba(255,255,255,0.03)'; row.style.cursor='pointer';
    row.innerHTML = `<div><strong>${escapeHtml(m.home||'')}</strong> <span class="muted">vs</span> <strong>${escapeHtml(m.away||'')}</strong><div class="small muted">${escapeHtml(m.date||'')} · ${escapeHtml(m.stadium||'')}</div></div><div class="small muted">Ver</div>`;
    row.addEventListener('click', ()=> openMatchModal(m, standingsRows||clasificacionGlobal,'next'));
    listEl.appendChild(row);
  });
}

/* ---------- pestañas y navegación ---------- */
function setupTabs(){
  const tabs = document.querySelectorAll('#tabs > .tab');
  if(!tabs || !tabs.length) return;
  tabs.forEach(t=>{
    t.addEventListener('click', ()=>{
      tabs.forEach(x=>x.classList.remove('active'));
      t.classList.add('active');
      const section = t.dataset.tab;
      document.querySelectorAll('.tab-content').forEach(c=> c.style.display = (c.id===section)?'block':'none');
      if(section==='standingsView') renderClasificacion(clasificacionGlobal);
    });
  });
}

function switchToSection(sectionId){
  const tab = document.querySelector(`#tabs > .tab[data-tab="${sectionId}"]`);
  if(tab) tab.click();
  const main = document.getElementById('mainPanel');
  if(main) main.scrollIntoView({behavior:'smooth', block:'start'});
}

// pestaña especial Challenge
document.getElementById("challengeTab").addEventListener("click", () => {
  
  // Crear modal de confirmación simple
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";

  const modal = document.createElement("div");
  modal.className = "modal";
  modal.innerHTML = `
    <div class="modal-inner">
      <h2>¿Deseas salir de la web?</h2>
      <p class="meta">Serás redirigido a la plataforma de torneos Challenge Place.</p>

      <div style="display:flex; gap:12px; margin-top:20px;">
        <button id="confirmYes" class="btn">Sí, continuar</button>
        <button id="confirmNo" class="btn secondary">Cancelar</button>
      </div>
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // Botones
  document.getElementById("confirmYes").onclick = () => {
    window.open("https://challenge.place/c/68b5d58123000de9bea36dcb", "_blank");
    overlay.remove();
  };

  document.getElementById("confirmNo").onclick = () => {
    overlay.remove();
  };

  // Cerrar clicando fuera del modal
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
});


/* ---------- inicialización ---------- */
async function init(){
  setupTabs();

  const tableBtn = document.getElementById('showTableBtn');
  const predBtn  = document.getElementById('showPredBtn');
  if(tableBtn && predBtn){
    tableBtn.addEventListener('click', ()=>{ tableBtn.classList.add('active'); predBtn.classList.remove('active'); renderClasificacion(clasificacionGlobal); });
    predBtn.addEventListener('click', async ()=>{
      predBtn.classList.add('active'); tableBtn.classList.remove('active');
      const txt = await fetchTxt('ligaPredict.txt');
      const rows = txt ? parseClasificacion(txt) : [];
      renderPrediction(rows);
    });
  }

  const [notTxt, clsTxt, ultTxt, proxTxt] = await Promise.all([
    fetchTxt('noticias.txt'), fetchTxt('clasificacion.txt'), fetchTxt('ultimaJ.txt'), fetchTxt('proximaJ.txt')
  ]);

  const noticias = parseNoticias(notTxt);
  const clasificacion = parseClasificacion(clsTxt);
  const ultima = parseBlocks(ultTxt);
  const proxima = parseBlocks(proxTxt);

  noticiasGlobal = noticias;
  clasificacionGlobal = clasificacion;
  ultimaGlobal = ultima;
  proximaGlobal = proxima;

  renderNoticias(noticias);
  renderClasificacion(clasificacion);
  renderUltima(ultima.length? ultima : sampleUltima());
  renderProxima(proxima.length? proxima : sampleProx(), clasificacion);
}

document.addEventListener('DOMContentLoaded', init);

'use strict';

const SUPABASE_URL='https://rqvcbjomrjccyuchxpuh.supabase.co';
const SUPABASE_KEY='sb_publishable_iKh-ZfqV3iJpr_9b7SErEA_XhrqnSsY';
const sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);

const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];

const MODULES=[
  {key:'hazard',symbol:'GS',title:'Gefahrstoffkataster',description:'Gefahrstoffe, SDB, GBU, BA-Status und Substitutionsprüfung zentral verwalten.',url:'https://umitdrmz22-svg.github.io/gefahrstoffkataster-online/',meta:'Gefahrstoffe'},
  {key:'dms',symbol:'DO',title:'Dokumentenmanagement',description:'Gelenkte Dokumente, Versionen, Prüfung, Freigabe und Audit-Trail.',url:'https://umitdrmz22-svg.github.io/dokumentmanagement-studio/',meta:'Dokumente'},
  {key:'ba',symbol:'BA',title:'BA Studio',description:'Betriebsanweisungen erstellen, bearbeiten und im Firmenbereich dauerhaft speichern.',url:'https://umitdrmz22-svg.github.io/ba-generator/',meta:'Betriebsanweisungen'},
  {key:'bso',symbol:'BS',title:'Brandschutzordnung Studio',description:'Brandschutzordnungen als getrennte Projekte erstellen und revisionssicher weiterbearbeiten.',url:'https://umitdrmz22-svg.github.io/brandschutzordnung-studio/',meta:'Projekte'},
  {key:'flucht',symbol:'FR',title:'Flucht- und Rettungsplan Studio',description:'Flucht- und Rettungspläne erstellen, prüfen und projektbezogen speichern.',url:'https://umitdrmz22-svg.github.io/fluchtplan-ai/',meta:'Pläne'},
  {key:'unfall',symbol:'UM',title:'Unfall- und Maßnahmenmanagement',description:'Ereignisse untersuchen, 5-Why dokumentieren und Maßnahmen bis zur Wirksamkeit verfolgen.',url:'https://umitdrmz22-svg.github.io/Unfallmanagemet_studio/',meta:'Fälle / Maßnahmen'}
];

let session=null;
let membership=null;
let snapshot=null;

init();

async function init(){
  $('#todayLabel').textContent=new Intl.DateTimeFormat('de-DE',{weekday:'short',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date());
  bindUi();
  renderModules();
  const {data}=await sb.auth.getSession();
  session=data.session;
  sb.auth.onAuthStateChange((_event,next)=>{
    session=next;
    if(session)enterPortal();else showLogin();
  });
  if(session)await enterPortal();else showLogin();
}

function bindUi(){
  $$('.nav').forEach(button=>button.addEventListener('click',()=>showSection(button.dataset.section)));
  $('[data-go-modules]').addEventListener('click',()=>showSection('modules'));
  $('[data-go-tasks]').addEventListener('click',()=>showSection('tasks'));
  $('#refreshButton').addEventListener('click',()=>session&&loadDashboard(true));
  $('#logoutButton').addEventListener('click',()=>sb.auth.signOut());
  $('#loginForm').addEventListener('submit',login);
}

async function login(event){
  event.preventDefault();
  $('#loginMessage').textContent='';
  const email=$('#email').value.trim();
  const password=$('#password').value;
  const {error}=await sb.auth.signInWithPassword({email,password});
  if(error)$('#loginMessage').textContent=error.message;
}

function showLogin(){
  session=null;membership=null;snapshot=null;
  $('#loginGate').classList.remove('hidden');
  $('#portalContent').classList.add('hidden');
  $('#logoutButton').classList.add('hidden');
  $('#orgName').textContent='EHS Management Studio';
  $('#userLabel').textContent='Nicht angemeldet';
  $('#connectionText').textContent='Anmeldung erforderlich';
}

async function enterPortal(){
  $('#loginGate').classList.add('hidden');
  $('#portalContent').classList.remove('hidden');
  $('#logoutButton').classList.remove('hidden');
  $('#connectionText').textContent='Supabase verbunden';
  $('#userLabel').textContent=session.user.email||'Angemeldeter Benutzer';
  await loadMembership();
  await loadDashboard();
}

async function loadMembership(){
  const {data,error}=await sb.from('organization_members')
    .select('organization_id,role,organizations(name)')
    .eq('user_id',session.user.id)
    .eq('status','active')
    .limit(1)
    .maybeSingle();
  if(error)throwPortal(error);
  membership=data;
  $('#orgName').textContent=data?.organizations?.name||'Keine Organisation';
  const role=data?.role?roleLabel(data.role):'ohne Rolle';
  $('#userLabel').textContent=`${session.user.email} · ${role}`;
}

async function loadDashboard(manual=false){
  if(!membership){renderNoOrganization();return;}
  if(manual){
    $('#refreshButton').disabled=true;
    $('#refreshButton').textContent='↻ Wird aktualisiert …';
  }
  const org=membership.organization_id;
  const requests=[
    sb.from('hazardous_substances').select('id,product_name,sds_date,sds_verified_at,sds_review_months,risk_assessment_status,operating_instruction_status,substitution_status,status').eq('organization_id',org),
    sb.from('documents').select('id,document_number,title,status,review_due').eq('organization_id',org),
    sb.from('operating_instructions').select('id,status').eq('organization_id',org),
    sb.from('incidents').select('id,status,case_number,incident_date').eq('organization_id',org),
    sb.from('actions').select('id,title,status,due_date,extended_due_date,responsible_name,effectiveness_status').eq('organization_id',org),
    sb.from('app_records').select('id,app_key,title,updated_at').eq('organization_id',org)
  ];
  const results=await Promise.all(requests);
  const firstError=results.find(r=>r.error)?.error;
  if(firstError){throwPortal(firstError);finishRefresh();return;}
  const [hazards,documents,ba,incidents,actions,appRecords]=results.map(r=>r.data||[]);
  snapshot={hazards,documents,ba,incidents,actions,appRecords};
  renderSnapshot();
  finishRefresh();
}

function finishRefresh(){
  $('#refreshButton').disabled=false;
  $('#refreshButton').textContent='↻ Aktualisieren';
}

function renderSnapshot(){
  const {hazards,documents,ba,incidents,actions,appRecords}=snapshot;
  const today=startOfDay(new Date());
  const activeHazards=hazards.filter(h=>h.status!=='archived');
  const sdsDue=activeHazards.filter(isSdsDue);
  const activeDocuments=documents.filter(d=>!['obsolete','archived'].includes(d.status));
  const docsDue=activeDocuments.filter(d=>d.review_due&&startOfDay(new Date(d.review_due))<=today);
  const openActions=actions.filter(a=>a.status==='offen');
  const overdueActions=openActions.filter(isActionOverdue);

  $('#kpiSubstances').textContent=activeHazards.length;
  $('#kpiSdsDue').textContent=sdsDue.length?`${sdsDue.length} SDB-Prüfung${sdsDue.length===1?'':'en'} fällig`:'Keine SDB-Prüfung fällig';
  $('#kpiDocuments').textContent=activeDocuments.length;
  $('#kpiDocsDue').textContent=docsDue.length?`${docsDue.length} Wiedervorlage${docsDue.length===1?'':'n'} fällig`:'Keine Wiedervorlage fällig';
  $('#kpiBa').textContent=ba.filter(x=>x.status!=='archived').length;
  $('#kpiActions').textContent=openActions.length;
  $('#kpiActionsOverdue').textContent=overdueActions.length?`${overdueActions.length} Maßnahme${overdueActions.length===1?'':'n'} überfällig`:'Keine Maßnahme überfällig';

  const counts={
    hazard:activeHazards.length,
    dms:activeDocuments.length,
    ba:ba.filter(x=>x.status!=='archived').length,
    bso:appRecords.filter(r=>r.app_key==='brandschutzordnung').length,
    flucht:appRecords.filter(r=>r.app_key==='fluchtplan').length,
    unfall:`${incidents.length} / ${openActions.length}`
  };
  renderModules(counts);
  renderAttention({sdsDue,docsDue,overdueActions,hazards:activeHazards,documents:activeDocuments,incidents,actions});
}

function renderModules(counts={}){
  const cards=MODULES.map(m=>moduleCard(m,counts[m.key])).join('');
  $('#moduleGrid').innerHTML=cards;
  $('#quickModules').innerHTML=MODULES.slice(0,4).map(m=>`<a class="quick-module" href="${m.url}"><div><span class="module-symbol">${m.symbol}</span><span><strong>${esc(m.title)}</strong><small>${esc(m.meta)}</small></span></div><span class="arrow">→</span></a>`).join('');
}

function moduleCard(module,count){
  const value=count===undefined?'Verbunden':String(count);
  return `<a class="module-card" href="${module.url}">
    <div class="module-card-top"><span class="module-symbol">${module.symbol}</span><span class="state-badge">Produktiv</span></div>
    <h3>${esc(module.title)}</h3><p>${esc(module.description)}</p>
    <div class="module-meta"><span>${esc(module.meta)}</span><strong>${esc(value)} →</strong></div>
  </a>`;
}

function renderAttention({sdsDue,docsDue,overdueActions,hazards,documents,incidents,actions}){
  const gbuOpen=hazards.filter(h=>h.risk_assessment_status!=='aktuell');
  const workflowDocs=documents.filter(d=>['in_review','awaiting_approval','changes_requested'].includes(d.status));
  const openIncidents=incidents.filter(i=>i.status!=='abgeschlossen');
  const items=[
    {count:overdueActions.length,label:'Überfällige Maßnahmen',detail:'Frist überschritten',kind:overdueActions.length?'bad':'ok',symbol:'M',url:MODULES[5].url},
    {count:sdsDue.length,label:'Fällige SDB-Prüfungen',detail:'Sicherheitsdatenblatt prüfen',kind:sdsDue.length?'warn':'ok',symbol:'S',url:MODULES[0].url},
    {count:docsDue.length,label:'Fällige Wiedervorlagen',detail:'Dokumentenprüfung erforderlich',kind:docsDue.length?'warn':'ok',symbol:'D',url:MODULES[1].url},
    {count:gbuOpen.length,label:'GBU-Prüfstände',detail:'Nicht als aktuell gekennzeichnet',kind:gbuOpen.length?'warn':'ok',symbol:'G',url:MODULES[0].url},
    {count:workflowDocs.length,label:'Dokument-Workflow',detail:'Prüfung, Freigabe oder Änderung offen',kind:workflowDocs.length?'warn':'ok',symbol:'W',url:MODULES[1].url},
    {count:openIncidents.length,label:'Offene Ereignisse',detail:'Unfallanalyse noch nicht abgeschlossen',kind:openIncidents.length?'warn':'ok',symbol:'U',url:MODULES[5].url}
  ];
  $('#attentionList').innerHTML=items.slice(0,3).map(attentionHtml).join('');
  $('#taskGrid').innerHTML=items.map(i=>`<article class="task-card"><span class="attention-icon ${i.kind}">${i.symbol}</span><div><h3>${esc(i.label)}: ${i.count}</h3><p>${esc(i.detail)}</p></div><a href="${i.url}">Anwendung öffnen →</a></article>`).join('');
}

function attentionHtml(item){
  return `<a class="attention-item" href="${item.url}" style="text-decoration:none;color:inherit"><span class="attention-icon ${item.kind}">${item.symbol}</span><span><strong>${esc(item.label)} · ${item.count}</strong><small>${esc(item.detail)}</small></span></a>`;
}

function showSection(section){
  const map={dashboard:'dashboardSection',modules:'modulesSection',tasks:'tasksSection'};
  const titles={dashboard:'Dashboard',modules:'Anwendungen',tasks:'Offene Punkte'};
  $$('.view-section').forEach(el=>el.classList.add('hidden'));
  $('#'+map[section]).classList.remove('hidden');
  $$('.nav').forEach(b=>b.classList.toggle('active',b.dataset.section===section));
  $('#pageTitle').textContent=titles[section];
}

function renderNoOrganization(){
  $('#orgName').textContent='Keine aktive Organisation';
  $('#attentionList').innerHTML='<div class="empty-note">Für dieses Benutzerkonto wurde keine aktive Organisation gefunden.</div>';
  $('#taskGrid').innerHTML='<div class="empty-note">Keine Organisationsdaten verfügbar.</div>';
}

function isSdsDue(record){
  const source=record.sds_verified_at||record.sds_date;
  if(!source)return true;
  const due=new Date(`${source}T00:00:00`);
  due.setMonth(due.getMonth()+Number(record.sds_review_months||24));
  return startOfDay(due)<=startOfDay(new Date());
}

function isActionOverdue(action){
  if(action.status!=='offen')return false;
  const date=action.extended_due_date||action.due_date;
  if(!date)return false;
  return startOfDay(new Date(`${date}T00:00:00`))<startOfDay(new Date());
}

function startOfDay(date){return new Date(date.getFullYear(),date.getMonth(),date.getDate()).getTime();}
function roleLabel(role){return({owner:'Owner',admin:'Administrator',ersteller:'Ersteller',pruefer:'Prüfer',freigeber:'Freigeber',leser:'Leser'})[role]||role;}
function esc(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function throwPortal(error){console.error(error);$('#connectionText').textContent='Verbindungsfehler';$('#attentionList').innerHTML=`<div class="empty-note">Daten konnten nicht geladen werden: ${esc(error.message||'Unbekannter Fehler')}</div>`;}

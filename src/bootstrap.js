'use strict';
const cfg=window.UNFALL_CONFIG||{};
const app=document.getElementById('app');
if(!cfg.supabaseUrl||!cfg.supabaseAnonKey){
  app.innerHTML=`<main style="min-height:100vh;display:grid;place-items:center;padding:32px;background:#f4f7f8;font-family:Arial,sans-serif;color:#17343d"><section style="max-width:720px;background:#fff;border:1px solid #d8e1e4;border-radius:18px;padding:34px;box-shadow:0 18px 48px rgba(23,52,61,.12)"><p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.14em;color:#657b82">PRODUKTIVBETRIEB</p><h1 style="margin:0 0 14px;font-size:30px">Unfall- und Maßnahmenmanagement ist noch nicht verbunden</h1><p style="margin:0 0 18px;line-height:1.55">Demo- und Browser-Speicherung sind deaktiviert. Für Anmeldung und dauerhafte, organisationsbezogene Speicherung müssen die gemeinsame Supabase-Konfiguration und die Produktionsmigration eingerichtet sein.</p><strong>Keine Unfall- oder Maßnahmendaten werden lokal gespeichert.</strong></section></main>`;
}else{
  await import('./app.js');
}

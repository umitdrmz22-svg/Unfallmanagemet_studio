'use strict';
(function(){
  const shared=window.EHS_PLATFORM_CONFIG||{};
  window.UNFALL_CONFIG=Object.freeze({
    appName:'Unfall- und Maßnahmenmanagement',
    mode:'supabase',
    supabaseUrl:shared.supabaseUrl||'',
    supabaseAnonKey:shared.supabasePublishableKey||shared.supabaseAnonKey||'',
    functionsBaseUrl:shared.functionsBaseUrl||'',
    siteName:shared.siteName||'Organisation',
    defaultReminderWeekday:1,
    legalReviewDate:'2026-08-05',
    productionOnly:true
  });
})();

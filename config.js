'use strict';
(function(){
  const shared=window.EHS_PLATFORM_CONFIG||{};
  const defaultSupabaseUrl='https://rqvcbjomrjccyuchxpuh.supabase.co';
  const defaultPublishableKey='sb_publishable_iKh-ZfqV3iJpr_9b7SErEA_XhrqnSsY';
  const presentationMode=new URLSearchParams(location.search).get('demo')==='1';
  const resolvedSupabaseUrl=shared.supabaseUrl||defaultSupabaseUrl;
  window.UNFALL_CONFIG=Object.freeze({
    appName:'Unfall- und Maßnahmenmanagement',
    mode:presentationMode?'local':'supabase',
    supabaseUrl:resolvedSupabaseUrl,
    supabaseAnonKey:shared.supabasePublishableKey||shared.supabaseAnonKey||defaultPublishableKey,
    functionsBaseUrl:shared.functionsBaseUrl||`${resolvedSupabaseUrl}/functions/v1`,
    siteName:shared.siteName||'Organisation',
    defaultReminderWeekday:1,
    legalReviewDate:'2026-08-05',
    productionOnly:!presentationMode,
    presentationMode
  });
})();

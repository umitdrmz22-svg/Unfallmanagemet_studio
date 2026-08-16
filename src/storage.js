const nowIso=()=>new Date().toISOString();

function normalizeIncident(row){
  if(!row)return row;
  return {
    ...(row.data||{}),
    id:row.id,
    caseNumber:row.case_number,
    status:row.status,
    incidentDate:row.incident_date,
    department:row.department,
    affectedPerson:row.affected_person,
    createdAt:row.created_at,
    updatedAt:row.updated_at
  };
}

function normalizeAction(row){
  if(!row)return row;
  return {
    ...(row.data||{}),
    id:row.id,
    incidentId:row.incident_id,
    title:row.title,
    cause:row.cause,
    hierarchy:row.hierarchy,
    responsibleName:row.responsible_name,
    responsibleEmail:row.responsible_email,
    managerEmail:row.manager_email,
    dueDate:row.due_date,
    extendedDueDate:row.extended_due_date,
    extensionReason:row.extension_reason,
    extensionRequestedAt:row.extension_requested_at,
    escalationState:row.escalation_state,
    escalatedAt:row.escalated_at,
    status:row.status,
    completedAt:row.completed_at,
    effectivenessDueDate:row.effectiveness_due_date,
    effectivenessStatus:row.effectiveness_status,
    createdAt:row.created_at,
    updatedAt:row.updated_at
  };
}

export class DataStore{
  constructor(config){
    this.config=config||{};
    this.mode='supabase';
    this.client=null;
    this.user=null;
    this.profile=null;
    this.membership=null;
    this.organizationId=null;
  }

  async init(){
    if(!this.config.supabaseUrl||!this.config.supabaseAnonKey){
      throw new Error('Die sichere Online-Speicherung ist nicht konfiguriert.');
    }
    const {createClient}=await import('https://esm.sh/@supabase/supabase-js@2.45.4');
    this.client=createClient(this.config.supabaseUrl,this.config.supabaseAnonKey,{
      auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
    });
    const {data,error}=await this.client.auth.getSession();
    if(error)throw error;
    this.user=data.session?.user||null;
    if(this.user)await this.loadProfile();
    return this;
  }

  async waitForEhsAccess(){
    if(globalThis.DefiDevEHSAccess)return globalThis.DefiDevEHSAccess;
    if(typeof document==='undefined'||!document.querySelector('script[src*="ehs-entitlement-gate.js"]'))return null;
    return await new Promise(resolve=>globalThis.addEventListener('defidev-ehs-entitlement-ready',event=>resolve(globalThis.DefiDevEHSAccess||event.detail||null),{once:true}));
  }

  async loadProfile(){
    if(!this.client||!this.user)return null;
    const ehsAccess=await this.waitForEhsAccess();
    let membershipQuery=this.client
      .from('organization_members')
      .select('organization_id,role,status,organizations(name)')
      .eq('user_id',this.user.id)
      .eq('status','active');
    if(ehsAccess?.organizationId)membershipQuery=membershipQuery.eq('organization_id',ehsAccess.organizationId);
    else membershipQuery=membershipQuery.limit(1);
    const {data:membership,error:membershipError}=await membershipQuery.maybeSingle();
    if(membershipError)throw membershipError;
    this.membership=membership||null;
    this.organizationId=membership?.organization_id||null;

    const {data:profile,error:profileError}=await this.client
      .from('profiles')
      .select('id,full_name')
      .eq('id',this.user.id)
      .maybeSingle();
    if(profileError)throw profileError;
    this.profile={
      id:this.user.id,
      full_name:profile?.full_name||this.user.user_metadata?.full_name||this.user.email,
      role:membership?.role||'leser',
      organization_id:this.organizationId,
      organization_name:membership?.organizations?.name||'Organisation'
    };
    return this.profile;
  }

  isAuthenticated(){
    return Boolean(this.user&&this.organizationId);
  }

  async signIn(email,password){
    const {data,error}=await this.client.auth.signInWithPassword({email,password});
    if(error)return {ok:false,error:error.message};
    this.user=data.user;
    try{
      await this.loadProfile();
    }catch(loadError){
      await this.client.auth.signOut({scope:'local'});
      this.user=null;
      return {ok:false,error:loadError.message};
    }
    if(!this.organizationId){
      await this.client.auth.signOut({scope:'local'});
      this.user=null;
      return {ok:false,error:'Für dieses Benutzerkonto ist kein aktiver Firmenbereich hinterlegt.'};
    }
    return {ok:true};
  }

  async signOut(){
    if(this.client)await this.client.auth.signOut({scope:'local'});
    this.user=null;
    this.profile=null;
    this.membership=null;
    this.organizationId=null;
  }

  requireOrganization(){
    if(!this.user||!this.organizationId)throw new Error('Bitte zuerst anmelden.');
  }

  async listIncidents(){
    this.requireOrganization();
    const {data,error}=await this.client
      .from('incidents')
      .select('*')
      .eq('organization_id',this.organizationId)
      .order('created_at',{ascending:false});
    if(error)throw error;
    return (data||[]).map(normalizeIncident);
  }

  async getIncident(id){
    this.requireOrganization();
    const {data,error}=await this.client
      .from('incidents')
      .select('*')
      .eq('organization_id',this.organizationId)
      .eq('id',id)
      .single();
    if(error)throw error;
    return normalizeIncident(data);
  }

  async saveIncident(incident){
    this.requireOrganization();
    const payload={
      organization_id:this.organizationId,
      case_number:incident.caseNumber,
      status:incident.status||'offen',
      incident_date:incident.incidentDate||null,
      department:incident.department||null,
      affected_person:incident.affectedPerson||null,
      data:incident,
      updated_by:this.user.id
    };
    let query;
    if(incident.createdAt){
      query=this.client.from('incidents').update(payload)
        .eq('organization_id',this.organizationId).eq('id',incident.id);
    }else{
      query=this.client.from('incidents').insert({
        id:incident.id,
        ...payload,
        created_by:this.user.id
      });
    }
    const {data,error}=await query.select('*').single();
    if(error)throw error;
    return normalizeIncident(data);
  }

  async deleteIncident(id){
    this.requireOrganization();
    const {error}=await this.client.from('incidents').delete()
      .eq('organization_id',this.organizationId).eq('id',id);
    if(error)throw error;
  }

  async listActions(){
    this.requireOrganization();
    const {data,error}=await this.client
      .from('actions')
      .select('*')
      .eq('organization_id',this.organizationId)
      .order('due_date',{ascending:true});
    if(error)throw error;
    return (data||[]).map(normalizeAction);
  }

  async saveAction(action){
    this.requireOrganization();
    const payload={
      organization_id:this.organizationId,
      incident_id:action.incidentId||null,
      title:action.title,
      cause:action.cause||null,
      hierarchy:action.hierarchy||null,
      responsible_name:action.responsibleName||null,
      responsible_email:action.responsibleEmail,
      manager_email:action.managerEmail||null,
      due_date:action.dueDate||null,
      extended_due_date:action.extendedDueDate||null,
      extension_reason:action.extensionReason||null,
      extension_requested_at:action.extensionRequestedAt||null,
      escalation_state:action.escalationState||'none',
      escalated_at:action.escalatedAt||null,
      status:action.status||'offen',
      completed_at:action.completedAt||null,
      effectiveness_due_date:action.effectivenessDueDate||null,
      effectiveness_status:action.effectivenessStatus||'offen',
      data:action,
      updated_by:this.user.id
    };
    let query;
    if(action.createdAt){
      query=this.client.from('actions').update(payload)
        .eq('organization_id',this.organizationId).eq('id',action.id);
    }else{
      query=this.client.from('actions').insert({
        id:action.id,
        ...payload,
        created_by:this.user.id
      });
    }
    const {data,error}=await query.select('*').single();
    if(error)throw error;
    return normalizeAction(data);
  }

  async completeAction(id){
    const action=(await this.listActions()).find(item=>item.id===id);
    if(!action)throw new Error('Maßnahme nicht gefunden.');
    return this.saveAction({...action,status:'erledigt',completedAt:nowIso()});
  }

  async requestExtension(id,newDate,reason){
    const action=(await this.listActions()).find(item=>item.id===id);
    if(!action)throw new Error('Maßnahme nicht gefunden.');
    const updated=await this.saveAction({
      ...action,
      extendedDueDate:newDate,
      extensionReason:reason,
      extensionRequestedAt:nowIso(),
      escalationState:'extension_requested'
    });
    await this.triggerTaskNotification('extension',updated);
    return updated;
  }

  async escalateAction(id){
    const action=(await this.listActions()).find(item=>item.id===id);
    if(!action)throw new Error('Maßnahme nicht gefunden.');
    const updated=await this.saveAction({...action,escalationState:'manager_notified',escalatedAt:nowIso()});
    await this.triggerTaskNotification('escalation',updated);
    return updated;
  }

  async triggerTaskNotification(type,action){
    if(!this.config.functionsBaseUrl)return {sent:false,reason:'not_configured'};
    const {data}=await this.client.auth.getSession();
    const response=await fetch(`${this.config.functionsBaseUrl}/task-notification`,{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        Authorization:`Bearer ${data.session?.access_token||this.config.supabaseAnonKey}`
      },
      body:JSON.stringify({type,actionId:action.id,organizationId:this.organizationId})
    });
    if(!response.ok)throw new Error(`Benachrichtigung fehlgeschlagen (${response.status}).`);
    return response.json();
  }

  async historyForIncident(incidentId){
    this.requireOrganization();
    const {data,error}=await this.client
      .from('action_history')
      .select('*')
      .eq('organization_id',this.organizationId)
      .eq('incident_id',incidentId)
      .order('created_at',{ascending:false});
    if(error)throw error;
    return data||[];
  }

  exportLocalData(){
    return JSON.stringify({message:'Die Produktivdaten werden im geschützten Firmenbereich gespeichert.'},null,2);
  }
  importLocalData(){throw new Error('Lokaler Import ist im Produktivbetrieb deaktiviert.');}
  clearLocalData(){throw new Error('Lokale Datenspeicherung ist im Produktivbetrieb deaktiviert.');}
}

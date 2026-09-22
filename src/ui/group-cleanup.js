(() => {
  'use strict';
  function attach(groups){
    const host=document.getElementById('superGroupList');if(!host)return;
    for(const card of host.querySelectorAll('[data-super-group]')){
      const button=document.createElement('button');button.className='btn btn-surface btn-sm';button.textContent='Remove group…';button.onclick=()=>open(card.dataset.superGroup);card.append(button);
    }
    const archived=groups.filter(g=>g.archived===true);if(!archived.length)return;
    const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Archived groups ('+archived.length+')';details.append(summary);host.append(details);
    for(const group of archived){
      const card=document.createElement('div');card.className='admin-group-card';
      const name=document.createElement('strong');name.textContent=group.name+' · '+group.code;
      const button=document.createElement('button');button.className='btn btn-surface';button.textContent='Review restore';button.onclick=()=>open(group.code);
      card.append(name,button);details.append(card);
    }
  }
  function errorText(error){
    const code=String(error?.code||'').replace(/^functions\//,'');
    if(code==='unauthenticated')return 'Sign in again to confirm this admin change, then review the group once more.';
    if(code==='permission-denied')return 'This Google or Apple account does not have verified Superadmin access. The old admin PIN does not grant permission to remove groups.';
    if(code==='not-found'||code==='unimplemented')return 'Group cleanup is not available on this server yet, or this group no longer exists. No records were deleted.';
    if(code==='failed-precondition')return 'The group changed since this review, or its saved season needs attention. Close this window and review it again. Nothing was deleted.';
    return 'Forge could not confirm the result. Refresh the group list before retrying. Your group history is preserved.';
  }
  async function open(code){
    if(!/^[A-Z0-9]{4,10}$/.test(code))return;
    const body=document.createElement('div');body.className='today-dialog-body';
    const status=document.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');body.append(status);
    ForgeToday.openDialog('Group cleanup',body);
    async function review(){
      const uid=window.auth?.currentUser?.uid;
      const valid=()=>body.isConnected&&auth.currentUser?.uid===uid;
      status.textContent='Checking verified Superadmin access…';
      try{
        const access=await callFunction('getAdminAccess',{});if(!valid())return;
        if(!access.superadmin)throw {code:'permission-denied'};
        const p=await callFunction('previewGroupArchive',{groupCode:code});if(!valid())return;
        body.replaceChildren();
        const heading=document.createElement('h3');heading.textContent=p.name+' · '+p.groupCode;
        const copy=document.createElement('p');copy.textContent=p.archived?'Restore this group to its saved season? Existing workouts and memberships will remain unchanged.':'Remove this group from active use? It will disappear from active leaderboards and stop accepting new workouts and joins. You can restore it here later.';
        const counts=document.createElement('p');counts.textContent=p.members+' members · '+(p.atLeast?'at least ':'')+p.workoutRecords+' workout records (including removed entries). No history will be deleted.';
        const label=document.createElement('label');label.textContent='Type '+code+' to confirm';label.htmlFor='archiveConfirmCode';
        const input=document.createElement('input');input.id='archiveConfirmCode';input.className='code-input';input.autocomplete='off';input.spellcheck=false;input.maxLength=10;
        const confirm=document.createElement('button');confirm.className='btn btn-gold';confirm.textContent=p.archived?'Restore group':'Archive group';confirm.disabled=true;
        input.oninput=()=>{confirm.disabled=input.value!==code;};
        body.append(heading,copy,counts,label,input,confirm,status);status.textContent='';
        const signInAgain=document.createElement('details'),signInTitle=document.createElement('summary');signInTitle.textContent='Confirm or change your admin sign-in';signInAgain.append(signInTitle);
        if(window.FEATURE_GOOGLE_AUTH)signInAgain.append(ForgeWelcome.providers(async provider=>{const result=await ForgeWelcome.authenticate(provider,text=>status.textContent=text);if(result&&body.isConnected)await review();}));
        body.append(signInAgain);
        let busy=false;
        confirm.onclick=async()=>{
          if(busy||!valid()||input.value!==code)return;
          busy=true;confirm.disabled=true;input.disabled=true;status.textContent=p.archived?'Restoring group…':'Archiving group…';
          try{
            await callFunction('setGroupArchived',{groupCode:code,archived:!p.archived,confirmCode:input.value,revision:p.revision});
            if(!valid())return;
            ForgeToday.closeDialog();window._superGroups=null;
            await loadSuperAdmin();toast(p.archived?'Group restored.':'Group archived. History preserved.','success');
          }catch(error){if(valid()){status.textContent=errorText(error);if(String(error?.code||'').includes('unauthenticated'))signInAgain.open=true;}}
          finally{busy=false;if(valid()){confirm.disabled=false;input.disabled=false;}}
        };
      }catch(error){if(valid())status.textContent=errorText(error);}
    }
    const explanation=document.createElement('p');explanation.textContent='Group removal requires your verified Superadmin Google or Apple account. It is recoverable archiving, not permanent deletion.';body.prepend(explanation);
    if(window.FEATURE_GOOGLE_AUTH){body.append(ForgeWelcome.providers(async provider=>{const result=await ForgeWelcome.authenticate(provider,text=>status.textContent=text);if(result&&body.isConnected)await review();}));}
    if(auth.currentUser&&!auth.currentUser.isAnonymous)await review();else status.textContent='Sign in above to review this group.';
  }
  window.ForgeGroupCleanup={attach,open};
})();

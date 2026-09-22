/* A provider identifies a person; it never chooses a mode or creates a profile. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  let intent='return',busy=false;
  function providers(handler){
    const row=document.createElement('div');row.className='forge-provider-row';row.setAttribute('role','group');row.setAttribute('aria-label','Sign in to Forge');
    for(const [id,name,src]of [['google.com','Google','assets/auth/google-signin.svg'],['apple.com','Apple','assets/auth/apple-signin.png']]){
      if(id==='apple.com'&&!window.FEATURE_APPLE_AUTH)continue;
      const button=document.createElement('button');button.type='button';button.className='forge-provider-button';button.setAttribute('aria-label','Continue with '+name);button.title='Continue with '+name;
      const img=document.createElement('img');img.src=src;img.alt='';img.width=48;img.height=48;
      const label=document.createElement('span');label.textContent='Continue with '+name;button.append(img,label);button.onclick=()=>handler(id);row.append(button);
    }return row;
  }
  function message(text){const el=$('forgeWelcomeStatus');if(el)el.textContent=text;}
  function hasGroupSession(){
    return !!(window.me&&window.groupCode)||(typeof getSessions==='function'&&getSessions().length>0);
  }
  function syncGroupChoices(){
    const grouped=hasGroupSession();
    document.querySelectorAll('[data-forge-mode="solo"],[data-solo-entry]').forEach(el=>el.hidden=grouped);
    document.querySelector('.forge-mode-choices')?.classList.toggle('group-only',grouped);
    if(grouped){intent='group';if($('forgeGroupEntry'))$('forgeGroupEntry').hidden=false;}
  }
  function allowSolo(){
    if(!hasGroupSession())return true;
    const text='Sign out of Forge first to choose Solo. Your group workouts and points stay safe.';
    message(text);window.toast?.(text,'default');return false;
  }
  function signInError(error){
    const code=String(error?.code||error?.message||'');
    if(code==='auth/popup-blocked')return 'Your browser blocked the sign-in window. Open Forge in Safari or Chrome, allow sign-in pop-ups, and try again.';
    if(code==='auth/popup-closed-by-user'||code==='auth/cancelled-popup-request')return 'The sign-in window closed before finishing. Choose Google or Apple to try again.';
    if(code==='auth/network-request-failed')return 'Sign-in could not connect. Check your internet connection and try again.';
    if(code==='auth/unauthorized-domain')return 'Sign-in is not enabled for this web address. Open the official Forge staging page in Safari or Chrome.';
    if(code==='auth/operation-not-allowed'||code==='APPLE_NOT_CONFIGURED')return 'This sign-in provider is not available yet. Try the other provider or contact Forge support.';
    if(code==='FEATURE_OFF'||code==='NATIVE_AUTH_NOT_CONFIGURED')return 'Sign-in is not available in this build. Use the published staging website in Safari or Chrome.';
    if(code==='AUTH_STATE_CHANGED')return 'Your sign-in changed before it finished. Choose Google or Apple again; no profile was created.';
    return 'Sign-in did not finish. Your profile has not changed. Please try again.';
  }
  async function authenticate(provider,report){
    if(window._forgeProviderBusy){report('A sign-in window is already open. Finish or close it before trying again.');return null;}
    window._forgeProviderBusy=true;
    const buttons=[...document.querySelectorAll('.forge-provider-button')];buttons.forEach(b=>b.disabled=true);
    report('Opening '+(provider==='apple.com'?'Apple':'Google')+' sign-in…');
    try{
      // Keep the popup call in the original click, before any asynchronous work.
      const result=await startForgeProviderSignIn(provider);
      if(!result?.uid||!window.auth?.currentUser||auth.currentUser.isAnonymous||auth.currentUser.uid!==result.uid)throw Error('AUTH_STATE_CHANGED');
      report('Signed in. Opening your Forge…');return result;
    }catch(error){report(signInError(error));return null;}
    finally{window._forgeProviderBusy=false;buttons.forEach(b=>{if(b.isConnected)b.disabled=false;});}
  }
  function choose(mode){
    if(busy||window._forgeProviderBusy)return;
    if(mode==='solo'&&!allowSolo())return;
    intent=mode==='solo'?'solo':mode==='recover'?'recover':'group';
    document.querySelectorAll('[data-forge-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.forgeMode===intent)));
    const group=$('forgeGroupEntry');if(group)group.hidden=intent==='solo';
    if(intent==='group'){$('codeInput')?.focus();message('Have a group code? Enter it below. Your existing profile stays yours.');}
    if(intent==='solo'){
      message('Sign in to continue. Already used Forge? Bring back your profile before starting fresh.');
      if(window.auth?.currentUser&&!auth.currentUser.isAnonymous)ForgeSolo.open();
    }
  }
  async function enter(provider){
    if(busy)return;
    if(intent==='solo'&&!allowSolo())return;
    busy=true;const chosen=intent;
    try{
      const result=await authenticate(provider,message);if(!result)return;
      if(chosen==='recover'){await ForgeSolo.open();if(auth.currentUser?.uid===result.uid)ForgeSolo.recoverGroup();}
      else if(chosen==='solo')await ForgeSolo.open();
      else await restoreIdentityFromGoogle({...result,welcome:true});
      message('');
    }catch(e){message(signInError(e));}
    finally{busy=false;}
  }
  function recover(){
    if(busy||window._forgeProviderBusy)return;
    if(hasGroupSession()){message('You are already in a group. Use Profile to secure this account, or sign out first.');return;}
    intent='recover';
    if(window.auth?.currentUser&&!auth.currentUser.isAnonymous){ForgeSolo.open().then(()=>ForgeSolo.recoverGroup());return;}
    message('First sign in with the Google or Apple account you want to use. Next, confirm your existing group profile and Forge PIN.');
    $('forgeWelcomeProviders')?.scrollIntoView({block:'nearest',behavior:'auto'});$('forgeWelcomeProviders')?.querySelector('button')?.focus();
  }
  function unlinked(){
    showScreen('onboard');showObStep(1);intent='return';
    const section=$('forgeUnlinkedChoice');if(section){section.hidden=false;section.focus();}
    message('You’re signed in. Bring back your existing profile, or explicitly choose a fresh solo space. Nothing has been created.');
  }
  function mount(){
    const host=$('forgeWelcomeProviders');if(host&&window.FEATURE_GOOGLE_AUTH){host.replaceChildren(providers(enter));}
    syncGroupChoices();
  }
  window.ForgeWelcome={providers,choose,enter,recover,unlinked,mount,authenticate,allowSolo,hasGroupSession,syncGroupChoices};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
})();

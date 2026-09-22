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
  function choose(mode){
    if(busy||window._forgeProviderBusy)return;
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
    if(busy||window._forgeProviderBusy)return;busy=true;window._forgeProviderBusy=true;const chosen=intent;
    document.querySelectorAll('.forge-provider-button').forEach(b=>b.disabled=true);message('Opening secure sign-in…');
    try{
      const result=await startForgeProviderSignIn(provider);
      if(!auth.currentUser||auth.currentUser.uid!==result.uid)return;
      if(chosen==='recover'){await ForgeSolo.open();if(auth.currentUser?.uid===result.uid)ForgeSolo.recoverGroup();}
      else if(chosen==='solo')await ForgeSolo.open();
      else await restoreIdentityFromGoogle({...result,welcome:true});
      message('');
    }catch(e){message('Sign-in did not finish. No new profile was created. Please try again.');}
    finally{busy=false;window._forgeProviderBusy=false;document.querySelectorAll('.forge-provider-button').forEach(b=>b.disabled=false);}
  }
  function recover(){
    if(busy||window._forgeProviderBusy)return;
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
  }
  window.ForgeWelcome={providers,choose,enter,recover,unlinked,mount};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
})();

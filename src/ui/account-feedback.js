/* Safe, actionable copy. Never print provider payloads, PINs or raw server errors. */
(() => {
  'use strict';
  function claim(error){
    const code=String(error?.code||'').replace(/^functions\//,''), message=String(error?.message||'');
    if(/already belongs to another Forge profile|already runs/i.test(message))return {kind:'recover',text:'This Google or Apple account is already connected to another Forge profile. You can bring this group history into that account, or choose a different sign-in account.'};
    if(/already linked|already secured|another sign.in account/i.test(message))return {kind:'linked',text:'This Forge profile is already secured with a different sign-in account. Use that account to sign in. If it is not yours, contact Forge support.'};
    if(code==='resource-exhausted'||/Too many attempts/i.test(message))return {kind:'retry-later',text:'Too many attempts. Wait an hour before trying this profile again. Your history has not changed.'};
    if(/sign in again|recent sign.in/i.test(message)||code==='unauthenticated')return {kind:'reauth',text:'Your sign-in needs a fresh confirmation. Choose Google or Apple again, then enter your Forge PIN.'};
    if(/no PIN is set|set.*new PIN|PIN.*not.*set/i.test(message))return {kind:'pin',text:'This profile needs a PIN first. Ask your group admin to help you set a new Forge PIN, then try linking again.'};
    if(/could not confirm this profile|PIN.*match|check your PIN/i.test(message))return {kind:'pin',text:'That PIN could not confirm this profile. Check the four digits, or ask your group admin for a PIN reset.'};
    if(code==='auth/account-exists-with-different-credential'||code==='auth/credential-already-in-use')return {kind:'linked',text:'That sign-in is already in use. Sign in with the provider you previously used for Forge, then link from your existing profile.'};
    if(code==='auth/popup-blocked')return {kind:'retry',text:'Your browser blocked the sign-in window. Allow pop-ups for Forge, or open it in Safari or Chrome, then try again.'};
    if(/auth\/(popup-closed-by-user|cancelled-popup-request)/.test(code))return {kind:'retry',text:'The sign-in window closed before finishing. Nothing was linked. Choose Google or Apple to try again.'};
    if(code==='auth/operation-not-allowed'||message==='APPLE_NOT_CONFIGURED')return {kind:'setup',text:'This sign-in provider is not available in this build yet. Try the other provider or contact Forge support.'};
    if(['unavailable','deadline-exceeded','auth/network-request-failed'].includes(code)||message==='FUNCTIONS_SDK_MISSING')return {kind:'network',text:'Forge could not confirm the result with the server. Check your connection and retry; an unfinished response does not mean your history was lost.'};
    if(code==='failed-precondition')return {kind:'support',text:'Forge needs to check this profile before it can be linked. Your workout history is safe. Contact Forge support and mention “account linking”.'};
    if(code==='permission-denied')return {kind:'support',text:'This sign-in could not confirm access to the profile. Try signing in again, or contact Forge support. Your history has not been removed.'};
    return {kind:'support',text:'Forge could not finish securing your account. Please retry, or contact Forge support and mention “account linking”. No workout history has been removed.'};
  }
  function notification(error){
    const code=String(error?.code||error?.message||'');
    if(code==='PUSH_CONTEXT_CHANGED')return 'Your active profile changed. Open Profile again before enabling notifications.';
    if(code==='UNSUPPORTED')return 'This browser cannot receive Forge notifications. On iPhone, add Forge to your Home Screen and open it there, or use the phone app.';
    if(code==='FEATURE_OFF')return 'Notifications are not available in this build yet.';
    if(code==='PUSH_NO_TOKEN')return 'Permission was allowed, but this device could not register for notifications. Try again; if it repeats, contact Forge support.';
    if(code==='PUSH_TIMEOUT')return 'Notification setup is taking too long. We have not confirmed registration. Check your connection and retry.';
    if(/permission-denied|unauthenticated/.test(code))return 'Permission was allowed, but Forge could not save it to this profile. Sign in again and retry, or contact Forge support.';
    if(/messaging\/(invalid-vapid-key|token-subscribe-failed|failed-service-worker-registration)/.test(code))return 'Permission was allowed, but Forge’s notification setup needs attention. Contact Forge support; approving permission again will not fix it.';
    return 'Forge could not finish registering this device. Check your connection and try again. Notifications are not confirmed on yet.';
  }
  window.ForgeFeedback={claim,notification};
})();

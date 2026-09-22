(() => {
  'use strict';
  function open(pending){
    const valid=()=>window._claimPending===pending&&window.auth?.currentUser?.uid===pending.uid&&window.me?.userId===pending.userId&&window.groupCode===pending.groupCode;
    if(!valid())return window.toast?.('Sign in again from this profile.','error');
    const name=me.name;
    const body=document.createElement('div');body.className='today-dialog-body';
    const description=document.createElement('p');description.textContent='Bring '+me.name+' in '+pending.groupCode+' into your currently signed-in account? Forge will verify your PIN and preserve your workout history. Other groups attached to this old profile come with it. This combines profiles; it does not disconnect Google or Apple.';
    const label=document.createElement('label');label.textContent='Confirm this profile’s four-digit Forge PIN';label.htmlFor='recoverGroupPin';
    const input=document.createElement('input');input.id='recoverGroupPin';input.className='code-input';input.type='password';input.inputMode='numeric';input.maxLength=4;input.autocomplete='off';
    const status=document.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    const confirm=document.createElement('button');confirm.className='btn btn-gold';confirm.textContent='Confirm and bring back my history';
    const cancel=document.createElement('button');cancel.className='btn btn-surface';cancel.textContent='Not now';cancel.onclick=()=>ForgeToday.closeDialog();
    body.append(description,label,input,status,confirm,cancel);ForgeToday.openDialog('Review account recovery',body);
    let busy=false;
    confirm.onclick=async()=>{
      if(busy)return;
      if(!valid()){status.textContent='Your active account changed. Close this window and sign in again.';return;}
      if(!/^\d{4}$/.test(input.value)){status.textContent='Enter the four-digit Forge PIN for this profile.';return;}
      busy=true;confirm.disabled=true;cancel.disabled=true;status.textContent='Verifying ownership and bringing back your history…';
      const pin=input.value;input.value='';
      try{
        await callFunction('linkLegacyGroup',{name,groupCode:pending.groupCode,pin});
        if(!valid())return;
        window._claimPending=null;ForgeToday.closeDialog();
        await restoreIdentityFromGoogle({uid:pending.uid,preferredCode:pending.groupCode});
      }catch(error){if(valid()&&body.isConnected)status.textContent=ForgeFeedback.claim(error).text;}
      finally{busy=false;confirm.disabled=false;cancel.disabled=false;}
    };
    input.focus();
  }
  window.ForgeAccountRecovery={open};
})();

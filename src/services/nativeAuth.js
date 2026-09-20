// Native credentials only; the existing web Firebase Auth remains session owner.
// No plugin/UI/network action occurs merely by loading this file.
(function(global){
  'use strict';
  global.createForgeNativeAuth=function({auth,firebase,plugin,platform,apiKey,ready,fetcher=fetch}){
    let busy=false;
    const current=()=>auth.currentUser?.uid || null;
    const requireActor=uid=>{if(current()!==uid)throw new Error('ACCOUNT_CHANGED');};
    async function exclusive(action){
      if(!ready())throw new Error('NATIVE_AUTH_NOT_CONFIGURED');
      if(busy)throw new Error('AUTH_IN_PROGRESS');
      busy=true;
      try{return await action();}finally{busy=false;}
    }
    async function credential(provider,actor){
      if(!['google.com','apple.com'].includes(provider))throw new Error('INVALID_PROVIDER');
      const method=provider==='google.com'?'signInWithGoogle':'signInWithApple';
      if(typeof plugin?.[method]!=='function')throw new Error('NATIVE_AUTH_PLUGIN_MISSING');
      const androidApple=provider==='apple.com' && platform==='android';
      if(androidApple && typeof plugin.signOut!=='function')throw new Error('NATIVE_AUTH_PLUGIN_MISSING');
      let result;
      try{
        result=await plugin[method]({skipNativeAuth:true,scopes:provider==='apple.com'?['email','name']:['email','profile']});
      }finally{
        // Android's generic OAuth handler signs into native Firebase even with
        // skipNativeAuth. Clear that session; JS Auth is our sole session owner.
        if(androidApple)await plugin.signOut();
      }
      requireActor(actor);
      const value=result?.credential;
      const token=androidApple?value?.accessToken:value?.idToken;
      if(!value || typeof token!=='string' || !token ||
          (value.providerId && value.providerId!==provider))throw new Error('NATIVE_CREDENTIAL_INVALID');
      if(provider==='apple.com' && !androidApple && (typeof value.nonce!=='string' || !value.nonce))throw new Error('APPLE_NONCE_MISSING');
      const firebaseCredential=provider==='google.com'
        ?firebase.auth.GoogleAuthProvider.credential(value.idToken,value.accessToken || null)
        :new firebase.auth.OAuthProvider('apple.com').credential(androidApple
          ?{accessToken:value.accessToken}:{idToken:value.idToken,rawNonce:value.nonce});
      return {firebaseCredential,value};
    }
    return Object.freeze({
      signIn:provider=>exclusive(async()=>{
        const actor=current();
        const {firebaseCredential}=await credential(provider,actor);
        requireActor(actor);
        const result=await auth.signInWithCredential(firebaseCredential);
        if(!result.user?.uid || current()!==result.user.uid)throw new Error('ACCOUNT_CHANGED');
        return {uid:result.user.uid,email:result.user.email || null,provider};
      }),
      confirmDeletion:expectedUid=>exclusive(async()=>{
        const user=auth.currentUser;
        if(!user || user.isAnonymous || user.uid!==expectedUid)throw new Error('SIGN_IN_REQUIRED');
        const provider=user.providerData.some(p=>p.providerId==='apple.com')?'apple.com':'google.com';
        const {firebaseCredential,value}=await credential(provider,expectedUid);
        const result=await user.reauthenticateWithCredential(firebaseCredential);
        requireActor(expectedUid);
        if(result.user?.uid!==expectedUid)throw new Error('ACCOUNT_CHANGED');
        if(provider==='apple.com'){
          // iOS returns a one-use authorization code, not an OAuth access token.
          // Matches Firebase iOS RevokeTokenRequest; Android uses accessToken.
          const ios=platform==='ios';
          const token=ios?value.authorizationCode:value.accessToken;
          if(typeof token!=='string' || !token)throw new Error('APPLE_REVOCATION_TOKEN_MISSING');
          const idToken=await user.getIdToken(true);
          requireActor(expectedUid);
          const response=await fetcher('https://identitytoolkit.googleapis.com/v2/accounts:revokeToken?key='+encodeURIComponent(apiKey),{
            method:'POST',redirect:'error',
            headers:{'Content-Type':'application/json',...(ios?{'X-Ios-Bundle-Identifier':'in.goforge.app'}:{})},
            signal:AbortSignal.timeout(20000),
            body:JSON.stringify({providerId:'apple.com',tokenType:ios?'CODE':'ACCESS_TOKEN',token,idToken})
          });
          if(!response.ok)throw new Error('APPLE_REVOCATION_FAILED');
          requireActor(expectedUid);
        }
      })
    });
  };
})(window);

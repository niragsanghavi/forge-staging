// Single reviewed build-time environment for the page AND messaging worker.
// Never select production using a URL parameter, localStorage or hostname.
// Promotion must change this file explicitly after backend/provider verification.
Object.defineProperty(globalThis,'FORGE_BUILD_TARGET',{
  value:Object.freeze({environment:'staging',providersEnabled:true,nativeAuth:false}),
  writable:false,configurable:false
});

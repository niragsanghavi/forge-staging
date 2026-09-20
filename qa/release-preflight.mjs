// npm run release:check — read-only local gates, never deploys or signs.
// A pass is NOT evidence of real-provider, device, backend or store acceptance.
import fs from 'node:fs';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
const root=new URL('../',import.meta.url);
const read=p=>fs.readFileSync(new URL(p,root),'utf8');
let pending=0;
function check(ok,label){console.log((ok?'PASS: ':'PENDING: ')+label);if(!ok)pending++;}
const context=vm.createContext({});
vm.runInContext(read('src/config/build-target.js'),context);
check(context.FORGE_BUILD_TARGET.environment==='production','Explicit reviewed production build target');
check(context.FORGE_BUILD_TARGET.nativeAuth===true,'Native provider activation after setup verification');
const config=JSON.parse(read('capacitor.config.json'));
check(config.appId==='in.goforge.app','Existing store app ID preserved');
check(config.plugins?.FirebaseAuthentication?.skipNativeAuth===true,'JS Firebase owns the authentication session');
const plist=spawnSync('plutil',['-convert','json','-o','-',new URL('ios/App/App/GoogleService-Info.plist',root).pathname],{encoding:'utf8'});
const ios=plist.status===0?JSON.parse(plist.stdout):{};
check(ios.PROJECT_ID==='forge-25c8c' && ios.BUNDLE_ID==='in.goforge.app','iOS production Firebase/app identity');
check(!!ios.CLIENT_ID && !!ios.REVERSED_CLIENT_ID,'Updated iOS Google OAuth configuration');
check(!!ios.REVERSED_CLIENT_ID && read('ios/App/App/Info.plist').includes(ios.REVERSED_CLIENT_ID),'iOS Google callback URL scheme');
const android=JSON.parse(read('android/app/google-services.json'));
const client=android.client?.find(c=>c.client_info?.android_client_info?.package_name==='in.goforge.app');
check(android.project_info?.project_id==='forge-25c8c' && !!client,'Android production Firebase/app identity');
check(client?.oauth_client?.some(c=>c.client_type===3) && client.oauth_client.some(c=>c.client_type===1),'Updated Android web/native OAuth clients');
check(read('ios/App/App/App.entitlements').includes('com.apple.developer.applesignin'),'Apple sign-in entitlement in source (portal/profile still need verification)');
check(/versionCode\s+4\b/.test(read('android/app/build.gradle')),'Android upload code 4 (reconfirm no later Play uploads)');
console.log('\nExternal gates still require evidence: production providers, backend/rules and reviewed default-codebase assembly preserving claimIdentity ownership; signing/provisioning; Google/Apple linking and deletion on devices; Health/upgrade tests; store disclosures.');
console.log(pending?'NOT UPLOAD-READY: '+pending+' local gate(s) pending.':'Local configuration gates pass; external release approval is still required.');
process.exitCode=pending?1:0;

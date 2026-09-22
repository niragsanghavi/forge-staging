/* In-app dialogs: no browser prompt/confirm, no saved secrets. */
(() => {
  let busy=false;
  function ask({title,message='',label='',value='',secret=false,confirm='Continue'}={}){
    if(busy)return Promise.resolve(null);
    busy=true;
    return new Promise(resolve=>{
      const opener=document.activeElement,d=document.createElement('dialog'),form=document.createElement('form');
      d.className='today-dialog';d.setAttribute('aria-labelledby','forgeActionTitle');
      form.className='today-dialog-body';form.method='dialog';
      const h=document.createElement('h2');h.id='forgeActionTitle';h.textContent=title;
      const p=document.createElement('p');p.textContent=message;p.style.whiteSpace='pre-line';form.append(h,p);
      let input;
      if(label){const l=document.createElement('label');l.textContent=label;input=document.createElement('input');input.type=secret?'password':'text';input.value=value;input.autocomplete='off';input.required=true;l.append(input);form.append(l);}
      const cancel=document.createElement('button');cancel.type='button';cancel.className='btn btn-surface';cancel.textContent='Cancel';
      const save=document.createElement('button');save.type='submit';save.className='btn btn-gold';save.textContent=confirm;form.append(save,cancel);
      let result=null;
      cancel.onclick=()=>d.close();
      form.onsubmit=e=>{e.preventDefault();result=input?input.value:true;d.close();};
      d.addEventListener('close',()=>{if(input)input.value='';d.remove();busy=false;if(opener?.isConnected)opener.focus();resolve(result);},{once:true});
      d.append(form);document.body.append(d);d.showModal();(input||cancel).focus();
    });
  }
  window.ForgeDialogs={ask,confirm:(title,message)=>ask({title,message,confirm:title}).then(Boolean)};
})();

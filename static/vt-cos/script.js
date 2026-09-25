const links=[...document.querySelectorAll('.nav-links a[href^="#"]')];
const sections=links.map(a=>document.querySelector(a.getAttribute('href'))).filter(Boolean);
const mark=()=>{let current=sections[0]?.id;for(const s of sections){if(s.getBoundingClientRect().top<160) current=s.id}
links.forEach(a=>a.classList.toggle('active',a.getAttribute('href')==='#'+current));};
addEventListener('scroll',mark,{passive:true});mark();

document.querySelectorAll('a[href^="#"]').forEach(a=>a.addEventListener('click',()=>{
  const target=document.querySelector(a.getAttribute('href'));
  if(target?.tagName==='DETAILS') target.open=true;
}));

const form=document.querySelector('#contact-form');
if(form){
  form.addEventListener('submit',()=>{
    const button=form.querySelector('button[type="submit"]');
    if(button){button.disabled=true;button.textContent=document.documentElement.lang.startsWith('zh')?'送出中…':'Sending…';}
  });
}

const menuToggle=document.querySelector('.menu-toggle');
const primaryNav=document.querySelector('#primary-nav');
if(menuToggle&&primaryNav){
  menuToggle.addEventListener('click',()=>{
    const open=primaryNav.classList.toggle('open');
    menuToggle.setAttribute('aria-expanded',String(open));
    menuToggle.setAttribute('aria-label',open?(document.documentElement.lang.startsWith('zh')?'關閉導覽':'Close navigation'):(document.documentElement.lang.startsWith('zh')?'開啟導覽':'Open navigation'));
    const icon=menuToggle.querySelector('b'); if(icon) icon.textContent=open?'×':'☰';
    document.body.classList.toggle('menu-open',open);
  });
  primaryNav.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>{
    primaryNav.classList.remove('open');
    menuToggle.setAttribute('aria-expanded','false');
    document.body.classList.remove('menu-open');
    const icon=menuToggle.querySelector('b'); if(icon) icon.textContent='☰';
  }));
}

addEventListener('keydown',e=>{if(e.key==='Escape'&&primaryNav?.classList.contains('open')){primaryNav.classList.remove('open');document.body.classList.remove('menu-open');menuToggle.setAttribute('aria-expanded','false');menuToggle.setAttribute('aria-label',document.documentElement.lang.startsWith('zh')?'開啟導覽':'Open navigation');const icon=menuToggle.querySelector('b');if(icon)icon.textContent='☰';menuToggle.focus();}});

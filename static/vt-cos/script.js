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

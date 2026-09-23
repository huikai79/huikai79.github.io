const links=[...document.querySelectorAll('.nav-links a[href^="#"]')];
const sections=links.map(a=>document.querySelector(a.getAttribute('href'))).filter(Boolean);
const mark=()=>{let current=sections[0]?.id;for(const s of sections){if(s.getBoundingClientRect().top<160) current=s.id}
links.forEach(a=>a.classList.toggle('active',a.getAttribute('href')==='#'+current));};
addEventListener('scroll',mark,{passive:true});mark();
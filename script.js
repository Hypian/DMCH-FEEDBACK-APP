const $ = (id) => document.getElementById(id);
const P = (s) => s.split('|').map((x) => x.split('~'));
const T3 = (s) => s.split('~');
const ld = (k, d) => {
  try {
    return JSON.parse(localStorage.getItem(k)) || d;
  } catch (e) {
    return d;
  }
};
const sv = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch (e) {}
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/* Languages: add ['sw','Kiswahili'] here, IX.sw=3, and a 4th entry in every translation below */
const LG = [['rw', 'Kinyarwanda'], ['en', 'English'], ['fr', 'Français']];
const IX = { en: 0, fr: 1, rw: 2 };
let S = { lang: 'en', a: {} }, i = 0, A = 0, tab = 'stats';
const g = (a) => a[IX[S.lang]] || a[0];
const U = {
  welcome: ['Welcome to DMC Hospital', 'Bienvenue à l\'hôpital DMC', 'Murakaza neza kuri DMC Hospital'],
  pick: ['Choose your language', 'Choisissez votre langue', 'Hitamo ururimi'],
  type: ['Are you an inpatient or outpatient?', 'Êtes-vous hospitalisé(e) ou en consultation externe ?', 'Uri umurwayi uryamye cyangwa utaryamye?'],
  priv: ['Your responses are anonymous and confidential.', 'Vos réponses sont anonymes et confidentielles.', 'Ibisubizo byanyu ni ibanga kandi ntibigira uwo bibaza.'],
  in: ['Inpatient', 'Hospitalisé(e)', 'Umurwayi uryamye'],
  out: ['Outpatient (OPD)', 'Consultation externe (OPD)', 'Umurwayi utaryamye (OPD)'],
  dept: ['Select your department', 'Choisissez votre service', 'Hitamo serivisi'],
  doc: ['Select your doctor', 'Choisissez votre médecin', 'Hitamo umuganga'],
  all: ['Select all that apply', 'Cochez toutes les réponses applicables', 'Hitamo ibihuye byose'],
  ph: ['Type here (optional)', 'Écrivez ici (facultatif)', 'Andika hano (si ngombwa)'],
  next: ['Next', 'Suivant', 'Komeza'],
  back: ['Back', 'Retour', 'Subira inyuma'],
  send: ['Submit', 'Envoyer', 'Ohereza'],
  thanks: ['Thank you for choosing Dream Medical Center Hospital!', 'Merci d\'avoir choisi Dream Medical Center Hospital !', 'Murakoze guhitamo Dream Medical Center Hospital!']
};

const RATE = P('Excellent~Excellent~Byiza cyane|Good~Bon~Byiza|Fair~Moyen~Bisanzwe|Poor~Mauvais~Bibi');
const AREA = P("Reception desk~Réception~Ku biro by'iyakira|Cashier's desk~Caisse~Ku biro by'ubwishyu|Triage~Triage~Ku ivuriro ryo gutoranya|Consultation~Consultation~Kubonana n'umuganga|Emergency~Urgences~Ubutabazi|Laboratory~Laboratoire~Laboratwari|Radiology/Imaging~Radiologie/Imagerie~Radiologiya/Ifoto z'Imbere|Minor surgery~Petite chirurgie~Kubagwa Bito|Physiotherapy service~Service de physiothérapie~Serivisi yo Kongera Imbaraga|Vaccination~Vaccination~Inkingo|Pharmacy~Pharmacie~Farumasi");
const Q = {
  cat: { t: 's', q: T3('Patient category~Catégorie de patient~Ubwoko bw\'umurwayi'), o: P('New patient~Nouveau patient~Umurwayi mushya|Returning patient~Patient de retour~Umurwayi wagarutse') },
  time: { t: 's', q: T3('Visit time~Heure de la visite~Igihe cyo gusura'), o: P('8:00 AM – 5:00 PM~8h00 – 17h00~8h00 – 17h00|5:00 PM – 9:00 PM~17h00 – 21h00~17h00 – 21h00|9:00 PM – 8:00 AM~21h00 – 8h00~21h00 – 8h00') },
  q1: { t: 's', q: T3("How was your experience at the reception/registration desk?~Comment évaluez-vous votre expérience à la réception/l’enregistrement ?~Wakiriwe gute ku biro by'iyakira/kwiyandikisha?"), o: RATE },
  q2: { t: 's', q: T3("How was your experience at the cashier's desk?~Comment évaluez-vous votre expérience à la caisse ?~Wakiriwe gute ku biro by'ubwishyu?"), o: RATE },
  q3: { t: 's', q: T3('How long did you wait before seeing the doctor?~Combien de temps avez-vous attendu avant de voir le médecin ?~Wategereje igihe kingana iki mbere yo kubonana n\'umuganga?'), o: P('Less than 15 minutes~Moins de 15 minutes~Munsi y\'iminota 15|15–30 minutes~15–30 minutes~Iminota 15–30|30–60 minutes~30–60 minutes~Iminota 30–60|1–2 hours~1–2 heures~Isaha 1–2|More than 2 hours~Plus de 2 heures~Zirenze amasaha 2') },
  q4: { t: 'm', q: T3("Where did you experience a delay?~Où avez-vous rencontré un retard ?~Ni he wagize ubukererwe?"), o: AREA.concat(P("I did not experience any delay~Je n'ai rencontré aucun retard~Sinigeze ngira ubukererwe")) },
  q5: { t: 's', q: T3('Did the healthcare provider listen carefully and address your concerns?~Le prestataire vous a-t-il écouté attentivement et pris en compte vos préoccupations ?~Umuganga yaguteze amatwi neza akita ku bibazo byawe?'), o: P('Yes~Oui~Yego|Partly~Partiellement~Igice|No~Non~Oya') },
  q6: { t: 'm', q: T3('Where did you experience a bad attitude or unprofessionalism?~Où avez-vous constaté une mauvaise attitude ou un manque de professionnalisme ?~Ni he wagize imikorere mibi cyangwa itagize umwuga?'), o: AREA.concat(P('Excellent professionalism in all services~Excellent professionnalisme dans tous les services~Umwuga mwiza muri serivisi zose')) },
  q7: { t: 's', q: T3('How do you rate the cleanliness?~Comment évaluez-vous la propreté ?~Wabonye gute isuku?'), o: RATE },
  q8: { t: 's', q: T3('Overall, how satisfied are you with your visit?~Dans l\'ensemble, êtes-vous satisfait(e) de votre visite ?~Muri rusange, unyuzwe gute n\'urugendo rwawe?'), o: P('Very satisfied~Très satisfait(e)~Ndanyuzwe cyane|Satisfied~Satisfait(e)~Ndanyuzwe|Neutral~Neutre~Simbizi|Dissatisfied~Insatisfait(e)~Sinanyuzwe|Very dissatisfied~Très insatisfait(e)~Sinanyuzwe na gato') },
  q9: { t: 'x', q: T3("What additional services would you like Dream Medical Center to offer?~Quels services supplémentaires souhaiteriez-vous que Dream Medical Center propose ?~Ni izihe serivisi z'inyongera wifuza ko Dream Medical Center yatanga?") },
  q10: { t: 'x', q: T3('Where can we improve? Any comments or suggestions?~Où pouvons-nous nous améliorer ? Autres commentaires ou suggestions ?~Tubwire aho twanoza, cyangwa ibindi bitekerezo/inama ufite.') }
};

const OPD = P("Gynecology & Obstetrics~Gynécologie & Obstétrique~Ababyeyi n'Inda|Internal medicine~Médecine interne~Indwara zo mu Mubiri|Orthopedics~Orthopédie~Amagufa|Pediatrics~Pédiatrie~Ubuvuzi bw'Abana|General surgery~Chirurgie générale~Kubagwa Kunini|Physiotherapy & Rehabilitation~Physiothérapie & Réadaptation~Kongera Imbaraga z'Umubiri|General medicine~Médecine générale~Ubuvuzi Rusange|ENT~ORL~Amatwi, Izuru n'Umuhogo|Urology~Urologie~Umuyoboro w'Inkari|Ophthalmology~Ophtalmologie~Amaso|Dental~Dentaire~Amenyo|Emergency & Observation~Urgences & Observation~Ubutabazi n'Igenzura|Radiology/Imaging~Radiologie/Imagerie~Radiologiya/Ifoto z'Imbere|Vaccination~Vaccination~Inkingo|Laboratory~Laboratoire~Laboratwari|Pharmacy~Pharmacie~Farumasi|Minor surgery~Petite chirurgie~Kubagwa Bito");
const WARD = P('Medical ward~Service de médecine~Indwara zo mu Mubiri|Surgical ward~Service de chirurgie~Kubagwa|Maternity ward~Maternité~Ababyeyi n\'Inda|Pediatric ward~Pédiatrie~Ubuvuzi bw\'Abana|ICU~Soins intensifs~ICU');

let cfg = ld('dmc_c', null) || (() => {
  const d = OPD.map((n, k) => ({ id: 'o' + k, n, o: 1, i: 0, d: [] })).concat(WARD.map((n, k) => ({ id: 'w' + k, n, o: 0, i: 1, d: [] })));
  d[3].d = ['Doctor A', 'Doctor B'];
  d[6].d = ['Doctor A', 'Doctor B'];
  return { pin: '1234', depts: d };
})();

const docs = () => (cfg.depts.find((d) => d.id === S.dept) || { d: [] }).d;
const flow = () => {
  const f = ['lang', 'type', 'dept'];
  if (S.type === 'out' && docs().length) f.push('doc');
  return f.concat(S.type === 'in' ? ['q5', 'q7', 'q8', 'q10'] : ['cat', 'time', 'q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9', 'q10']);
};

function render() {
  const f = flow(), st = f[i], t = (k) => g(U[k]);
  let b = '';
  if (st === 'lang') {
    b = `<h2>${U.pick.join(' / ')}</h2><div style="height:10px"></div>` + LG.map(([c, n]) => `<button class="opt lang" onclick="setLang('${c}')">${n}</button>`).join('');
  } else if (st === 'type') {
    b = `<h2>${t('type')}</h2><p class=hint>${t('priv')}</p>` + ['in', 'out'].map((k) => `<button class="opt ${S.type === k ? 'on' : ''}" onclick="pick('type','${k}')"><b></b>${t(k)}</button>`).join('');
  } else if (st === 'dept') {
    b = `<h2>${t('dept')}</h2>` + cfg.depts.filter((d) => (S.type === 'in' ? d.i : d.o)).map((d) => `<button class="opt ${S.dept === d.id ? 'on' : ''}" onclick="pick('dept','${d.id}')"><b></b>${esc(g(d.n))}</button>`).join('');
  } else if (st === 'doc') {
    b = `<h2>${t('doc')}</h2>` + docs().map((x, n) => `<button class="opt ${S.doc === x ? 'on' : ''}" onclick="pickDoc(${n})"><b></b>${esc(x)}</button>`).join('');
  } else {
    const q = Q[st], m = q.t === 'm';
    b = `<h2>${g(q.q)}</h2>`;
    if (q.t === 'x') {
      b += `<textarea placeholder="${t('ph')}" oninput="S.a['${st}']=this.value">${esc(S.a[st] || '')}</textarea>`;
    } else {
      if (m) b += `<p class=hint>${t('all')}</p>`;
      b += q.o.map((o, k) => {
        const on = m ? (S.a[st] || []).includes(k) : S.a[st] === k;
        return `<button class="opt ${m ? 'm' : ''} ${on ? 'on' : ''}" onclick="${m ? `tog('${st}',${k})` : `ans('${st}',${k})`}"><b></b>${g(o)}</button>`;
      }).join('');
    }
    if (q.t !== 's') {
      b += `<button class=btn ${m && !(S.a[st] || []).length ? 'disabled' : ''} onclick="nxt()">${i === f.length - 1 ? t('send') : t('next')}</button>`;
    }
  }

  $('app').innerHTML = `<div class="wrap s"><div class=top><img src=logo.jpg alt=DMC>${i > 0 ? `<button class=ghost onclick="go(-1)">‹ ${t('back')}</button>` : ''}</div>${st === 'lang' ? '' : `<div class=bar><i style="width:${(i / f.length) * 100}%"></i></div>`}${b}</div>`;
}

const up_ = () => {
  i += 1;
  render();
  scrollTo(0, 0);
};

function setLang(c) {
  S.lang = c;
  up_();
}

function pick(k, v) {
  if (k === 'type' && S.type !== v) {
    S.dept = S.doc = null;
  }
  S[k] = v;
  up_();
}

function pickDoc(n) {
  S.doc = docs()[n];
  up_();
}

function go(d) {
  i = Math.max(0, i + d);
  render();
  scrollTo(0, 0);
}

function ans(s, k) {
  S.a[s] = k;
  render();
  setTimeout(nxt, 180);
}

function tog(s, k) {
  const ex = Q[s].o.length - 1;
  let a = S.a[s] || [];
  a = a.includes(k) ? a.filter((x) => x !== k) : k === ex ? [k] : a.filter((x) => x !== ex).concat(k);
  S.a[s] = a;
  render();
}

function nxt() {
  if (i === flow().length - 1) return submit();
  up_();
}

function submit() {
  const R = ld('dmc_r', []), d = cfg.depts.find((x) => x.id === S.dept) || { n: ['?'] };
  R.push({ t: Date.now(), l: S.lang, y: S.type, d: S.dept, dn: d.n[0], dr: S.doc || '', a: S.a });
  sv('dmc_r', R);
  $('app').innerHTML = `<div class="wrap s" style="text-align:center;padding-top:10vh"><img src=logo.jpg style="width:70%;max-width:300px"><div class=tick>✓</div><h2>${g(U.thanks)}</h2></div>`;
  setTimeout(() => {
    S = { lang: 'en', a: {} };
    i = 0;
    render();
  }, 7000);
}

/* ---------- Admin (#admin) ---------- */
function admin() {
  const h = `<div class="wrap adm s"><div class=top><img src=logo.jpg alt=DMC><button class=ghost onclick="location.hash=''">← Patient app</button></div>`;
  if (!A) return $('app').innerHTML = h + `<h2>Admin sign-in</h2><p class=hint>Demo PIN: 1234</p><input type=password id=pin placeholder=PIN><button class=btn onclick="login()">Sign in</button></div>`;
  $('app').innerHTML = h + `<h2>Admin</h2><div class=tabs>${[['stats', 'Statistics'], ['depts', 'Departments']].map(([k, n]) => `<button class="tab ${tab === k ? 'on' : ''}" onclick="tab='${k}';admin()">${n}</button>`).join('')}</div>${tab === 'stats' ? stats() : deptUI()}</div>`;
}

function login() {
  if ($('pin').value === cfg.pin) {
    A = 1;
    admin();
  } else alert('Wrong PIN');
}

function deptUI() {
  return `<div class=card><h3>Add department / ward</h3><input type=text id=nd placeholder="Name"><div class=chk><label><input type=checkbox id=no checked> Outpatient</label><label><input type=checkbox id=ni> Inpatient</label></div><button class=btn onclick="add()">Add</button></div>` +
    cfg.depts.map((d) => `<div class=card><b>${esc(d.n[0])}</b><div class=chk><label><input type=checkbox ${d.o ? 'checked' : ''} onchange="up('${d.id}','o',+this.checked)"> Outpatient</label><label><input type=checkbox ${d.i ? 'checked' : ''} onchange="up('${d.id}','i',+this.checked)"> Inpatient</label></div><input type=text value="${esc(d.d.join(', '))}" placeholder="Doctors, comma-separated" onchange="up('${d.id}','d',this.value.split(',').map(s=>s.trim()).filter(Boolean))"><button class=ghost onclick="del('${d.id}')">Delete</button></div>`).join('');
}

function up(id, k, v) {
  cfg.depts.find((d) => d.id === id)[k] = v;
  sv('dmc_c', cfg);
}

function del(id) {
  if (confirm('Delete this department?')) {
    cfg.depts = cfg.depts.filter((d) => d.id !== id);
    sv('dmc_c', cfg);
    admin();
  }
}

function add() {
  const n = $('nd').value.trim();
  if (!n) return;
  cfg.depts.push({ id: 'x' + Date.now(), n: [n, n, n], i: +$('ni').checked, o: +$('no').checked, d: [] });
  sv('dmc_c', cfg);
  admin();
}

function stats() {
  const R = ld('dmc_r', []), n = R.length, tools = `<div class=card><h3>Tools</h3><div class=tools><button onclick="seed()">Load demo data</button><button onclick="unseed()">Remove demo data</button><button onclick="csv()">Export CSV</button><button onclick="if(confirm('Delete ALL responses?')){sv('dmc_r',[]);admin()}">Clear all</button></div></div>`;
  if (!n) return `<p class=hint>No responses yet.</p>` + tools;
  const s8 = R.filter((r) => r.a.q8 != null).map((r) => 5 - r.a.q8), avg = s8.length ? (s8.reduce((a, b) => a + b, 0) / s8.length).toFixed(1) : '–', pos = s8.length ? Math.round(s8.filter((x) => x >= 4).length / s8.length * 100) : 0;
  const tl = (f, lb) => {
    const m = {};
    R.forEach((r) => [].concat(f(r)).forEach((x) => {
      if (x != null && x !== '') m[x] = (m[x] || 0) + 1;
    }));
    return Object.entries(m).map(([k, v]) => [lb ? lb(k) : k, v]).sort((a, b) => b[1] - a[1]);
  };
  const bars = (a, max, x = '') => a.map(([k, v]) => `<div class=brow><span>${esc(k)}</span><div><i style="width:${Math.min(100, v / (max || n) * 100)}%"></i></div><em>${v}${x}</em></div>`).join('') || '–';
  const q = (k, ex) => tl((r) => r.a[k], (v) => Q[k].o[+v][0]).filter((e) => !ex || e[0] !== Q[k].o[Q[k].o.length - 1][0]);
  const good = (k) => {
    const v = R.filter((r) => r.a[k] != null);
    return v.length ? Math.round(v.filter((r) => r.a[k] <= 1).length / v.length * 100) : 0;
  };
  const cd = (t, b) => `<div class=card><h3>${t}</h3>${b}</div>`, cm = R.flatMap((r) => [r.a.q10, r.a.q9]).filter((x) => x && x.trim()).slice(-8).reverse();
  return `<div class=kpis><div class=kpi><b>${n}</b>Responses</div><div class=kpi><b>${avg}/5</b>Avg satisfaction</div><div class=kpi><b>${pos}%</b>Satisfied (4–5)</div><div class=kpi><b>${R.filter((r) => r.y === 'in').length} / ${R.filter((r) => r.y !== 'in').length}</b>Inpatient / Outpatient</div></div>` +
    cd('Responses by department', bars(tl((r) => r.dn))) + cd('Overall satisfaction', bars(q('q8'))) + cd('Wait before seeing doctor (OPD)', bars(q('q3'))) +
    cd('Where delays occurred', bars(q('q4', 1))) + cd('Where bad attitude was reported', bars(q('q6', 1))) +
    cd('Rated Excellent or Good', bars([['Reception', good('q1')], ['Cashier', good('q2')], ['Cleanliness', good('q7')]], 100, '%')) +
    cd('Provider listened carefully', bars(q('q5'))) + cd('Languages used', bars(tl((r) => r.l, (v) => ({ en: 'English', fr: 'Français', rw: 'Kinyarwanda' }[v])))) +
    cd('Latest comments', cm.map((x) => `<div class=cm>${esc(x)}</div>`).join('') || '–') + tools;
}

function seed() {
  const R = ld('dmc_r', []), D = cfg.depts, C = ['Great service', 'Waiting time was too long', 'Clean and calm environment', 'Please add more parking', ''];
  for (let k = 0; k < 60; k++) {
    const y = Math.random() < 0.25 ? 'in' : 'out', L = D.filter((d) => (y === 'in' ? d.i : d.o));
    if (!L.length) continue;
    const d = L[Math.random() * L.length | 0], p = (n) => Math.random() ** 1.8 * n | 0, a = { q5: p(3), q7: p(4), q8: p(5), q10: C[p(5)] };
    if (y === 'out') Object.assign(a, { cat: p(2), time: p(3), q1: p(4), q2: p(4), q3: p(5), q4: [p(11)], q6: [p(11)] });
    R.push({ t: Date.now() - Math.random() * 2592e6, l: ['rw', 'en', 'fr'][Math.random() * 3 | 0], y, d: d.id, dn: d.n[0], dr: '', a, demo: 1 });
  }
  sv('dmc_r', R);
  admin();
}

function unseed() {
  sv('dmc_r', ld('dmc_r', []).filter((r) => !r.demo));
  admin();
}

function csv() {
  const R = ld('dmc_r', []), K = Object.keys(Q), c = (k, v) => v == null ? '' : Array.isArray(v) ? v.map((x) => Q[k].o[x][0]).join('; ') : Q[k].o ? Q[k].o[v][0] : v;
  const rows = [['date', 'language', 'type', 'department', 'doctor', ...K]].concat(R.map((r) => [new Date(r.t).toISOString(), r.l, r.y, r.dn, r.dr, ...K.map((k) => c(k, r.a[k]))]));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([rows.map((r) => r.map((x) => '"' + String(x).replace(/"/g, '""') + '"').join(',')).join('\n')], { type: 'text/csv' }));
  a.download = 'dmc-feedback.csv';
  a.click();
}

/* ---------- Boot ---------- */
$('wl').innerHTML = [...U.welcome[0]].map((c, n) => `<span style="animation-delay:${1.3 + n * 0.045}s">${c === ' ' ? '&nbsp;' : c}</span>`).join('');
setTimeout(() => {
  const s = $('splash');
  if (s) {
    s.classList.add('off');
    setTimeout(() => s.remove(), 700);
  }
}, 3800);

function boot() {
  const adm = location.hash === '#admin', s = $('splash');
  if (adm && s) s.remove();
  adm ? admin() : render();
}
addEventListener('hashchange', boot);
boot();

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
let answerTimer = null, submitting = false, progressTimer = null;
const g = (a) => a[IX[S.lang]] || a[0];
const U = {
  welcome: ['Welcome to DMC Hospital', 'Bienvenue à DMC Hospital', 'Murakaza neza kuri DMC Hospital'],
  pick: ['Choose your language', 'Choisissez votre langue', 'Hitamo ururimi'],
  introTitle: [
    'OUT PATIENT DEPARTMENT FEEDBACK QUESTIONNAIRE',
    'QUESTIONNAIRE SUR LA SATISFACTION DU SERVICE DES CONSULTATIONS EXTERNES (OPD)',
    'GUKUSANYA IBITEKEREZO BY\'ABARWAYI BAJE KWIVUZA BATAHA (OPD)'
  ],
  introBody: [
    'Your feedback is important to us and will help us improve the quality of our services. Please take a moment to complete this short survey. Your responses are anonymous and confidential',
    'Votre avis compte pour nous et nous aidera à améliorer la qualité de nos services. Merci de prendre un instant pour répondre à ce court questionnaire. Vos réponses sont anonymes et confidentielles.',
    'Ibitekerezo byanyu n’ingirakamaro kuri twe kandi bizadufasha kunoza serivisi zacu. Turabasaba ngo muduhe akanya gato mu kuzuza uru rupapuro rwikusanyabitekerezo kuri serivise dutanga. Icyitonderwa: Ibitekerezo byanyu n’ibanga kandi ntankurikizi cyangwa ingaruka bibagiraho.'
  ],
  startSurvey: ['Start survey', 'Commencer le questionnaire', 'Tangira ibibazo'],
  surveyProgress: ['Survey progress', 'Progression du questionnaire', 'Aho ugeze mu bibazo'],
  submittingTitle: ['Saving your survey', 'Enregistrement de votre questionnaire', 'Turimo kubika ibisubizo byawe'],
  submittingStep: ['Preparing your answers', 'Préparation de vos réponses', 'Gutegura ibisubizo byawe'],
  savingAnswers: ['Saving your answers on this device…', 'Enregistrement de vos réponses sur cet appareil…', 'Turimo kubika ibisubizo byawe muri iki gikoresho…'],
  submitting: ['Saving your survey on this device…', 'Enregistrement de votre questionnaire sur cet appareil…', 'Turimo kubika ibisubizo byawe muri iki gikoresho…'],
  completionTitle: [
    'THANK YOU FOR CHOOSING DREAM MEDICAL CENTER HOSPITAL!!!!!!!',
    'MERCI D\'AVOIR CHOISI DREAM MEDICAL CENTER HOSPITAL!',
    'MURAKOZE GUHITAMO DREAM MEDICAL CENTER HOSPITAL!'
  ],
  completionBody: [
    'Your feedback has been received. Thank you for choosing Dream Medical Center Hospital.',
    'Votre avis a bien été reçu. Merci d’avoir choisi Dream Medical Center Hospital.',
    'Twakiriye ibitekerezo byanyu. Murakoze guhitamo Dream Medical Center Hospital.'
  ],
  completedBadge: ['Submitted', 'Envoyé', 'Byoherejwe'],
  deviceStorageError: [
    'This browser could not save survey data. Enable site storage and try again.',
    'Ce navigateur n’a pas pu enregistrer les données du questionnaire. Autorisez le stockage du site et réessayez.',
    'Iyi browser ntiyashoboye kubika ibisubizo. Emera ububiko bw’urubuga wongere ugerageze.'
  ],
  submitError: [
    'We could not save your feedback on this device. Please try again.',
    'Nous n’avons pas pu enregistrer votre avis sur cet appareil. Veuillez réessayer.',
    'Ntitwashoboye kubika igitekerezo cyawe kuri iki gikoresho. Ongera ugerageze.'
  ],
  retryHint: [
    'Your answers are still here. Check that browser storage is available, then try again.',
    'Vos réponses sont toujours là. Vérifiez que le stockage du navigateur est disponible, puis réessayez.',
    'Ibisubizo byawe biracyahari. Reba niba ububiko bwa browser bukora, wongere ugerageze.'
  ],
  retrySubmit: ['Try saving again', 'Réessayer l’enregistrement', 'Ongera ugerageze kubika'],
  dept: ['Visited Services', 'Services Visités', 'Serivisi Yasuwe'],
  all: [
    'Please select all that apply',
    'Cochez toutes les réponses applicables',
    'Hitamo ibihuye byose'
  ],
  ph: ['Type here (optional)', 'Écrivez ici (facultatif)', 'Andika hano (si ngombwa)'],
  next: ['Next', 'Suivant', 'Komeza'],
  back: ['Back', 'Retour', 'Subira inyuma'],
  send: ['Submit', 'Envoyer', 'Ohereza'],
  thanks: [
    'THANK YOU FOR CHOOSING DREAM MEDICAL CENTER HOSPITAL!!!!!!!',
    'MERCI D\'AVOIR CHOISI DREAM MEDICAL CENTER HOSPITAL!',
    'MURAKOZE GUHITAMO DREAM MEDICAL CENTER HOSPITAL!'
  ]
};
const COOLDOWN_MS = 24 * 60 * 60 * 1000;
let welcomeTimer = null;

const RATE = P('Excellent~Excellente~Byiza cyane|Good~Bonne~Byiza|Fair~Moyenne~Mu rugero|Poor~Mauvaise~Bibi|Very poor~Très mauvaise~Bibi cyane');
const AREA = P("Reception desk~Réception~Aho bakirira abagana ivuriro|Cashier’s desk~Caisse~Aho abagana ivuriro bishyurira|Triage~Triage~Isuzuniro ry’ibanze|Consultation~Consultation~Kubonana n'umuganga|Emergency~Urgences~Aho bakirira indembe n’inkomere|Laboratory~Laboratoire~Aho batangira ibizamini|Radiology/imaging~Radiologie/Imagerie~Guca mucyuma|Minor surgery~Petite chirurgie~Kubagwa byoroheje|Physiotherapy service~Service de physiothérapie~Aho bagorora ingingo|Vaccination~Vaccination~Aho batangira inkingo|Restaurant~Restaurant~Aho batangira amafunguro");
const Q = {
  dept: { t: 'd', q: T3('Visited Services~Services Visités~Serivisi Yasuwe') },
  cat: {
    t: 's',
    q: T3('Patient Category~Catégorie de Patient~Umurwayi'),
    o: P('New Patient~Nouveau patient(e)~Uje bwa mbere.|Returning Patient~Patient déjà venu~Usanzwe y’ivuriza hano.')
  },
  time: {
    t: 's',
    q: T3('Visit Time~Heure de la Visite~Igihe waziye'),
    o: P('8:00 AM – 5:00 PM~8h00 – 17h00~8h00 – 17h00|5:00 PM – 9:00 PM~17h00 – 21h00~17h00 – 21h00|9:00 PM – 8:00 AM~21h00 – 8h00~21h00 – 8h00')
  },
  q1: {
    t: 's',
    q: T3("1. How was your experience at the reception/registration desk?~1. Comment évaluez-vous votre expérience à la réception/l’enregistrement?~1. Wakiriwe ute n’abashinzwe kwakira abatugana (reception desk)?"),
    o: RATE
  },
  q2: {
    t: 's',
    q: T3("2. How was your experience at the cashier’s desk?~2. Comment évaluez-vous votre expérience à la caisse?~2. Wakiriwe ute n’abashinzwe kwishyuza abatugana (cash desk)?"),
    o: RATE
  },
  q3: {
    t: 's',
    q: T3('3. How long did you wait before seeing the Doctor?~3. Combien de temps avez-vous attendu avant de voir le prestataire de soins (médecin)?~3. Wategereje b’ingana iki mbere yo kubonana n\'umuganga?'),
    o: P('Less than 15 minute’s~Moins de 15 minutes~Munsi y\'iminota 15|15–30 minutes~15–30 minutes~Iminota 15–30|30–60 minutes~30–60 minutes~Iminota 30–60|1-2 hour~1–2 heures~Isaha 1–2|More than 2 hour~Plus de 2 heures~Birenze amasaha 2')
  },
  q4: {
    t: 'm',
    q: T3("4. Where did you experience a delay? Please select all that apply.~4. Où avez-vous rencontré un retard? Cochez toutes les réponses applicables.~4. Ni hehe wagize ubukererwe? Hitamo ibihuye byose."),
    o: AREA.concat(P("I did not experience any delay~Je n'ai rencontré aucun retard~Sinigeze ngira ubukererwe"))
  },
  q5: {
    t: 's',
    q: T3('5. Did the doctor listen carefully and address your concerns during consultation time?~5. Le prestataire de soins vous a-t-il écouté attentivement et pris en compte vos préoccupations pendant la consultation?~5. Umuganga wakwakiriye yaguteze amatwi bikunyuze mu gihe mwaganiraga ku burwayi bwawe?'),
    o: P('Yes~Oui~Yego|Partly~Partiellement~Mu rugero|No~Non~Oya')
  },
  q6: {
    t: 'm',
    q: T3('6. Among the following OPD areas, where did you have an unpleasant experience?~6. Parmi les zones suivantes de l’OPD, dans lesquelles avez-vous constaté une expérience désagréable?~6. Ni hehe mwahuye n’ikibazo cyangwa serivisi idashimishije muri izi serivisi z’abivuza bataha ?'),
    o: AREA.concat(P('None~Je n\'ai rencontré aucun retard~Sinigeze ngira ubukererwe'))
  },
  q7: {
    t: 's',
    q: T3('7. How do you rate the cleanliness of the OPD area?~7. Comment évaluez-vous la propreté de la zone OPD?~7. Mwabonye mute isuku y’aho abivuza bakirirwa?'),
    o: RATE
  },
  q8: {
    t: 's',
    q: T3('8. Overall, how satisfied are you with your visit today?~8. Dans l\'ensemble, êtes-vous satisfait(e) de votre visite d’aujourd’hui ?~8. Muri rusange, wanyuzwe ute n\'uburyo wakiriwe mu bitaro bya Dream Medical center (DMC)?'),
    o: P('Very satisfied~Très satisfait(e)~Ndanyuzwe cyane|Satisfied~Satisfait(e)~Ndanyuzwe|Neutral~Neutre~Mu rugero|Dissatisfied~Insatisfait(e)~Sinanyuzwe|Very dissatisfied~Très insatisfait(e)~Sinanyuzwe na gato')
  },
  q9: {
    t: 'x',
    q: T3("9. What additional services would you like Dream Medical Center to offer?~9. Quels services supplémentaires souhaiteriez-vous que Dream Medical Center propose?~9. Ni izihe serivisi z'inyongera wifuza ko ibitaro bya Dream Medical Center (DMC) byatanga?")
  },
  q10: {
    t: 'x',
    q: T3('10. Please tell us where we can improve, any additional comments or suggestions.~10. Merci de nous indiquer où nous pouvons nous améliorer, ainsi que tout autre commentaire ou suggestion.~10. Turabasaba ibitekerezo by’ibyo twanoza, n’Ikindi cyose mwifuza kutubwira muhawe ikaze.')
  }
};

const OPD = P("Gynecology & Obs~Gynécologie - Obstétrique~Ubuvuzi bw’ababyeyi|Internal medicine~Médecine interne~Ubuvuzi bw’imbere mu Mubiri|Orthopedic~Orthopédie~Ubuvuzi bw’indwara z’amagufa|Pediatrics~Pédiatrie~Ubuvuzi bw'Abana|General surgery~Chirurgie générale~Imbagwa|Physiotherapy & rehabilitation~Physiothérapie & Réeducation~kugorora ingingo|General medicine~Médecine générale~Ubuvuzi Rusange|ENT~ORL~Ubuvuzi bw’indwara z’amatwi, Izuru n'Umuhogo|Urology~Urologie~Ubuvuzi bw’umuyoboro w'Inkari|Ophthalmology~Ophtalmologie~Ubuvuzi bw’amaso|Dental~Dentaire~Ubuvuzi bw’amenyo|Emergency & observation~Urgences & Observation~Aho bakirira indembe n’inkomere|Radiology /Imaging~Radiologie/Imagerie~Guca mu cyuma|Vaccination~Vaccination~Aho batangira Inkingo|Laboratory~Laboratoire~Aho batangira ibizamini|Minor surgery~Petite chirurgie~Kubagwa Byoroheje");

let cfg = ld('dmc_c', null);
if (!cfg || !cfg.v || cfg.v < 2) {
  cfg = {
    v: 2,
    pin: cfg?.pin || '1234',
    depts: OPD.map((n, k) => ({ id: 'o' + k, n }))
  };
  sv('dmc_c', cfg);
}

const flow = () => ['dept', 'cat', 'time', 'q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9', 'q10'];

function render(animate = true) {
  const f = flow(), st = f[i], t = (k) => g(U[k]);
  let title = '', hint = '', b = '';
  if (st === 'dept') {
    title = t('dept');
    b = cfg.depts.map((d) => `<button class="opt ${S.dept === d.id ? 'on' : ''}" onclick="pick('dept','${d.id}')"><b></b>${esc(g(d.n))}</button>`).join('');
  } else {
    const q = Q[st], m = q.t === 'm';
    title = g(q.q);
    if (m && !title.toLowerCase().includes(t('all').toLowerCase())) hint = t('all');
    if (q.t === 'x') {
      b += `<textarea placeholder="${t('ph')}" oninput="S.a['${st}']=this.value">${esc(S.a[st] || '')}</textarea>`;
    } else {
      b += q.o.map((o, k) => {
        const on = m ? (S.a[st] || []).includes(k) : S.a[st] === k;
        return `<button class="opt ${m ? 'm' : ''} ${on ? 'on' : ''}" data-question="${st}" data-option="${k}" aria-pressed="${on}" onclick="${m ? `tog('${st}',${k})` : `ans('${st}',${k})`}"><b></b>${g(o)}</button>`;
      }).join('');
    }
    if (q.t !== 's') {
      b += `<button class="btn ${m && !(S.a[st] || []).length ? 'disabled' : ''}" onclick="nxt()">${i === f.length - 1 ? t('send') : t('next')}</button>`;
    }
  }

  $('app').innerHTML = `<div class="wrap screen${animate ? ' screen-enter' : ''}"><div class="top"><div class="top-row"><img src="logo-optimized.jpg" alt="DMC" width="760" height="221" decoding="async">${i > 0 ? `<button class="ghost" onclick="go(-1)"><i class='bx bx-chevron-left'></i> ${t('back')}</button>` : ''}</div><div class="bar"><i style="width:${(i / f.length) * 100}%"></i></div><div class="top-title"><h2>${title}</h2>${hint ? `<p class="hint">${hint}</p>` : ''}</div></div>${b}</div>`;
}

const up_ = () => {
  i += 1;
  render();
  scrollTo(0, 0);
};

function renderIntro(animate = true) {
  $('app').innerHTML = `<main class="intro-card${animate ? ' screen-enter' : ''}"><img class="intro-logo" src="logo-optimized.jpg" alt="Dream Medical Center Hospital" width="760" height="221" loading="lazy" decoding="async"><p class="eyebrow">${esc(g(U.welcome))}</p><h1 id="intro-title">${esc(g(U.introTitle))}</h1><p class="intro-copy" id="intro-body">${esc(g(U.introBody))}</p><p class="error" id="intro-error" role="alert"></p><button class="btn intro-start" id="start-survey" onclick="startSurvey()">${esc(g(U.startSurvey))} <i class='bx bx-right-arrow-alt'></i></button></main>`;
}

function storeCompletion(submittedAt = Date.now()) {
  const completion = JSON.stringify({ submittedAt, lang: S.lang });
  localStorage.setItem('dmc_completed', completion);
  if (localStorage.getItem('dmc_completed') !== completion) {
    throw new Error('Browser storage did not retain the survey completion status.');
  }
}

function loadCompletion() {
  try {
    const completed = JSON.parse(localStorage.getItem('dmc_completed') || 'null');
    if (!Number.isFinite(completed?.submittedAt)) return false;
    if (Date.now() - completed.submittedAt >= COOLDOWN_MS) {
      localStorage.removeItem('dmc_completed');
      return false;
    }
    if (IX.hasOwnProperty(completed.lang)) S.lang = completed.lang;
    return true;
  } catch (error) {
    console.error('Could not restore the saved survey status:', error);
    return false;
  }
}

function renderComplete() {
  clearInterval(progressTimer);
  progressTimer = null;
  $('app').innerHTML = `<main class="completion-card screen-enter" role="status" aria-live="polite"><div class="completion-orbit" aria-hidden="true"><i class='bx bx-check completion-check'></i></div><h1>${esc(g(U.completionTitle))}</h1><p class="intro-copy">${esc(g(U.completionBody))}</p><div class="completion-stamp"><i class='bx bx-check'></i> ${esc(g(U.completedBadge))}</div></main>`;
}

function hideSplash(callback) {
  const splash = $('splash');
  if (!splash) {
    callback();
    return;
  }
  callback();
  splash.classList.add('off');
  setTimeout(() => {
    splash.remove();
  }, 600);
}

function renderSubmitting(progress, message) {
  const value = Math.min(100, Math.max(0, Math.round(progress)));
  const bar = $('submit-progress');
  const label = $('submit-step');
  const percent = $('submit-percent');
  if (!bar) {
    $('app').innerHTML = `<main class="submit-card screen-enter" role="status" aria-live="polite"><div class="submit-orbit" aria-hidden="true"><span class="submit-orbit-dot"></span></div><p class="eyebrow">${esc(g(U.surveyProgress))}</p><h1>${esc(g(U.submittingTitle))}</h1><p class="intro-copy" id="submit-step">${esc(message)}</p><div class="submit-progress-track" role="progressbar" aria-label="${esc(g(U.submittingTitle))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${value}"><span id="submit-progress" style="width:${value}%"></span></div><p class="submit-percent" id="submit-percent">${value}%</p><div class="submit-status"><span></span>${esc(g(U.submitting))}</div></main>`;
    return;
  }
  bar.style.width = `${value}%`;
  bar.parentElement.setAttribute('aria-valuenow', String(value));
  label.textContent = message;
  percent.textContent = `${value}%`;
}

function startSurvey() {
  const button = $('start-survey');
  if (button) button.disabled = true;
  try {
    if (loadCompletion()) {
      renderComplete();
      return;
    }
    const storageCheck = 'dmc_storage_check';
    localStorage.setItem(storageCheck, 'available');
    if (localStorage.getItem(storageCheck) !== 'available') {
      throw new Error('Browser storage did not retain a test value.');
    }
    localStorage.removeItem(storageCheck);
    i = 0;
    render();
    scrollTo(0, 0);
  } catch (error) {
    console.error('Could not start the local survey:', error);
    const notice = $('intro-error');
    if (notice) notice.textContent = g(U.deviceStorageError);
    if (button) {
      button.disabled = false;
      button.innerHTML = `${esc(g(U.startSurvey))}<span aria-hidden="true"> →</span>`;
    }
  }
}

function pick(k, v) {
  S[k] = v;
  up_();
}

function go(d) {
  if (answerTimer !== null) {
    clearTimeout(answerTimer);
    answerTimer = null;
  }
  i = Math.max(0, i + d);
  render();
  scrollTo(0, 0);
}

function ans(s, k) {
  if (answerTimer !== null) return;
  S.a[s] = k;
  document.querySelectorAll(`.opt[data-question="${s}"]`).forEach((option) => {
    const selected = Number(option.dataset.option) === k;
    option.classList.toggle('on', selected);
    option.setAttribute('aria-pressed', String(selected));
  });
  answerTimer = setTimeout(() => {
    answerTimer = null;
    nxt();
  }, 240);
}

function tog(s, k) {
  const ex = Q[s].o.length - 1;
  let a = S.a[s] || [];
  a = a.includes(k) ? a.filter((x) => x !== k) : k === ex ? [k] : a.filter((x) => x !== ex).concat(k);
  S.a[s] = a;
  document.querySelectorAll(`.opt[data-question="${s}"]`).forEach((option) => {
    const selected = a.includes(Number(option.dataset.option));
    option.classList.toggle('on', selected);
    option.setAttribute('aria-pressed', String(selected));
  });
  const next = document.querySelector('.btn');
  if (next) next.disabled = a.length === 0;
}

function nxt() {
  if (i === flow().length - 1) return submit();
  up_();
}

async function submit() {
  if (submitting) return;
  submitting = true;
  const startedAt = Date.now();
  let progress = 7;
  renderSubmitting(progress, g(U.submittingStep));
  progressTimer = setInterval(() => {
    progress = Math.min(92, progress + Math.max(1, (92 - progress) * 0.045));
    const step = progress < 38 ? g(U.submittingStep) : progress < 72 ? g(U.savingAnswers) : g(U.submittingTitle);
    renderSubmitting(progress, step);
  }, 120);
  try {
    const storedResponses = localStorage.getItem('dmc_r');
    const R = storedResponses ? JSON.parse(storedResponses) : [];
    if (!Array.isArray(R)) throw new Error('Saved feedback data is invalid.');
    const d = cfg.depts.find((x) => x.id === S.dept) || { n: ['?'] };
    R.push({ t: Date.now(), l: S.lang, d: S.dept, dn: d.n[0], a: S.a });
    const serializedResponses = JSON.stringify(R);
    localStorage.setItem('dmc_r', serializedResponses);
    if (localStorage.getItem('dmc_r') !== serializedResponses) {
      throw new Error('Browser storage did not retain the feedback data.');
    }
    storeCompletion();
    renderSubmitting(100, g(U.completionTitle));
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, 900 - (Date.now() - startedAt))));
    renderComplete();
  } catch (error) {
    console.error('Feedback submission failed:', error);
    clearInterval(progressTimer);
    progressTimer = null;
    submitting = false;
    $('app').innerHTML = `<main class="submit-card screen-enter" role="alert" aria-live="assertive"><div class="submit-error-mark" aria-hidden="true"><i class='bx bx-error-circle'></i></div><h1>${esc(g(U.submitError))}</h1><p class="intro-copy">${esc(g(U.retryHint))}</p><button class="btn intro-start" onclick="submit()"><i class='bx bx-refresh'></i> ${esc(g(U.retrySubmit))}</button></main>`;
    return;
  } finally {
    submitting = false;
    clearInterval(progressTimer);
    progressTimer = null;
  }
}

/* ---------- Admin (#admin) ---------- */
function admin() {
  const h = `<div class="wrap adm s"><div class=top><div class="top-row"><img src="logo-optimized.jpg" alt="DMC" width="760" height="221" decoding="async"><button class=ghost onclick="location.hash=''"><i class='bx bx-left-arrow-alt'></i> Patient app</button></div></div>`;
  if (!A) return $('app').innerHTML = h + `<h2>Admin sign-in</h2><p class=hint>PIN: 1234</p><input type=password id=pin placeholder=PIN><button class=btn onclick="login()"><i class='bx bx-log-in'></i> Sign in</button></div>`;
  $('app').innerHTML = h + `<h2>Admin Portal</h2><div class=tabs>${[['stats', `<i class='bx bx-bar-chart-alt-2'></i> Statistics`], ['feedbacks', `<i class='bx bx-message-square-detail'></i> Feedback List`], ['depts', `<i class='bx bx-plus-medical'></i> Services`]].map(([k, n]) => `<button class="tab ${tab === k ? 'on' : ''}" onclick="tab='${k}';admin()">${n}</button>`).join('')}</div>${tab === 'stats' ? stats() : tab === 'feedbacks' ? feedbacksUI() : deptUI()}</div>`;
}

function login() {
  if ($('pin').value === cfg.pin) {
    A = 1;
    admin();
  } else alert('Wrong PIN');
}

function feedbacksUI() {
  const R = ld('dmc_r', []);
  if (!R.length) return `<div class="card"><p class="hint">No feedbacks submitted yet.</p></div>`;
  return `<div class="card"><h3>Feedbacks Received (${R.length})</h3><p class="hint">Showing all submissions in reverse chronological order (newest first).</p>` +
    R.slice().reverse().map((r, idx) => {
      const timeStr = r.t ? new Date(r.t).toLocaleString() : 'N/A';
      const sScore = r.a?.q8 != null ? 5 - r.a.q8 : null;
      const scoreBadge = sScore != null
        ? `<span class="badge-score ${sScore <= 2 ? 'badge-low' : sScore >= 4 ? 'badge-high' : 'badge-mid'}">${sScore}/5 – ${esc(Q.q8.o[r.a.q8][0])}</span>`
        : '';
      const catStr = r.a?.cat != null ? Q.cat.o[r.a.cat]?.[0] : '';
      const timeSlot = r.a?.time != null ? Q.time.o[r.a.time]?.[0] : '';
      const delays = (r.a?.q4 || []).map((i) => Q.q4.o[i]?.[0]).filter(Boolean).join(', ');
      const issues = (r.a?.q6 || []).map((i) => Q.q6.o[i]?.[0]).filter(Boolean).join(', ');
      return `<div class="fb-item">
        <div class="fb-meta">
          <span><b>#${R.length - idx} • ${esc(r.dn || 'OPD Service')}</b> ${catStr ? `• ${esc(catStr)}` : ''} ${timeSlot ? `• ${esc(timeSlot)}` : ''}</span>
          <span><i class='bx bx-calendar'></i> ${esc(timeStr)}</span>
        </div>
        <div style="margin:8px 0">${scoreBadge} <span class="hint" style="margin-left:8px;font-size:12px">Lang: ${esc(r.l || 'en')}</span></div>
        ${delays ? `<div class="hint" style="margin:4px 0"><b>Delays noted:</b> ${esc(delays)}</div>` : ''}
        ${issues ? `<div class="hint" style="margin:4px 0"><b>Unpleasant experience / issues:</b> ${esc(issues)}</div>` : ''}
        ${r.a?.q9 ? `<div class="cm" style="margin-top:6px"><b>Requested additional services:</b> ${esc(r.a.q9)}</div>` : ''}
        ${r.a?.q10 ? `<div class="cm" style="margin-top:6px"><b>Comments / Suggestions:</b> ${esc(r.a.q10)}</div>` : ''}
      </div>`;
    }).join('') + `</div>`;
}

function deptUI() {
  return `<div class=card><h3>Add visited service</h3><input type=text id=nd placeholder="Service name"><button class=btn onclick="add()"><i class='bx bx-plus'></i> Add</button></div>` +
    cfg.depts.map((d) => `<div class=card><b>${esc(d.n[0])}</b><button class=ghost onclick="del('${d.id}')"><i class='bx bx-trash'></i> Delete</button></div>`).join('');
}

function del(id) {
  if (confirm('Delete this service?')) {
    cfg.depts = cfg.depts.filter((d) => d.id !== id);
    sv('dmc_c', cfg);
    admin();
  }
}

function add() {
  const n = $('nd').value.trim();
  if (!n) return;
  cfg.depts.push({ id: 'x' + Date.now(), n: [n, n, n] });
  sv('dmc_c', cfg);
  admin();
}

function stats() {
  const R = ld('dmc_r', []), n = R.length, tools = `<div class=card><h3>Tools</h3><div class=tools><button onclick="seed()"><i class='bx bx-data'></i> Load demo data</button><button onclick="unseed()"><i class='bx bx-eraser'></i> Remove demo data</button><button onclick="csv()"><i class='bx bx-download'></i> Export CSV</button><button onclick="if(confirm('Delete ALL responses?')){sv('dmc_r',[]);admin()}"><i class='bx bx-trash'></i> Clear all</button></div></div>`;
  if (!n) return `<p class=hint>No responses yet.</p>` + tools;
  const s8 = R.filter((r) => r.a.q8 != null).map((r) => 5 - r.a.q8), avg = s8.length ? (s8.reduce((a, b) => a + b, 0) / s8.length).toFixed(1) : '–', pos = s8.length ? Math.round(s8.filter((x) => x >= 4).length / s8.length * 100) : 0;
  const neg = s8.length ? Math.round(s8.filter((x) => x <= 2).length / s8.length * 100) : 0;
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

  // Department rankings (lowest / worst satisfaction score first)
  const dStats = {};
  R.forEach((r) => {
    const name = r.dn || 'Unknown';
    if (!dStats[name]) dStats[name] = { total: 0, scores: [] };
    dStats[name].total += 1;
    if (r.a?.q8 != null) dStats[name].scores.push(5 - r.a.q8);
  });
  const rankings = Object.entries(dStats).map(([name, data]) => {
    const score = data.scores.length ? (data.scores.reduce((a, b) => a + b, 0) / data.scores.length).toFixed(1) : '–';
    const num = data.scores.length ? (data.scores.reduce((a, b) => a + b, 0) / data.scores.length) : 5;
    const diss = data.scores.length ? Math.round(data.scores.filter((s) => s <= 2).length / data.scores.length * 100) : 0;
    return { name, total: data.total, score, num, diss };
  }).sort((a, b) => a.num - b.num); // Ascending: worst first

  const rankHtml = rankings.map((d, idx) => {
    const isWorst = idx === 0 && d.num < 3.8;
    const cls = d.num < 3 ? 'badge-low' : d.num >= 4 ? 'badge-high' : 'badge-mid';
    return `<div class="rank-row">
      <span><b>#${idx + 1}</b> ${esc(d.name)} <small style="opacity:.7">(${d.total} reviews)</small></span>
      <span>
        ${d.diss > 0 ? `<small style="color:#c81e1e;margin-right:8px">${d.diss}% dissatisfied</small>` : ''}
        <span class="badge-score ${cls}">${d.score} / 5</span>
      </span>
    </div>`;
  }).join('');

  return `<div class=kpis><div class=kpi><b>${n}</b>Total Responses</div><div class=kpi><b>${avg}/5</b>Avg Satisfaction</div><div class=kpi><b>${pos}%</b>Satisfied (4–5★)</div><div class=kpi><b>${neg}%</b>Dissatisfied (≤2★)</div></div>` +
    cd("<i class='bx bx-trending-down' style='color:#c81e1e'></i> Service Ranking by Satisfaction (Lowest / Needs Attention First)", `<p class="hint" style="margin-bottom:8px">Sorted from lowest satisfaction rating to highest.</p>` + (rankHtml || '–')) +
    cd('Responses by visited service', bars(tl((r) => r.dn))) + cd('Overall satisfaction', bars(q('q8'))) + cd('Wait before seeing Doctor', bars(q('q3'))) +
    cd('Where delays occurred', bars(q('q4', 1))) + cd('Where unpleasant experience was reported', bars(q('q6', 1))) +
    cd('Rated Excellent or Good', bars([['Reception', good('q1')], ['Cashier', good('q2')], ['Cleanliness', good('q7')]], 100, '%')) +
    cd('Doctor listened carefully', bars(q('q5'))) + cd('Languages used', bars(tl((r) => r.l, (v) => ({ en: 'English', fr: 'Français', rw: 'Kinyarwanda' }[v])))) +
    cd('Latest comments', cm.map((x) => `<div class=cm>${esc(x)}</div>`).join('') || '–') + tools;
}

function seed() {
  const R = ld('dmc_r', []), D = cfg.depts, C = ['Great service', 'Waiting time was too long', 'Clean and calm environment', 'Please add more parking', ''];
  for (let k = 0; k < 60; k++) {
    if (!D.length) continue;
    const d = D[Math.random() * D.length | 0], p = (n) => Math.random() ** 1.8 * n | 0;
    const a = { cat: p(2), time: p(3), q1: p(5), q2: p(5), q3: p(5), q4: [p(12)], q5: p(3), q6: [p(12)], q7: p(5), q8: p(5), q10: C[p(5)] };
    R.push({ t: Date.now() - Math.random() * 2592e6, l: ['rw', 'en', 'fr'][Math.random() * 3 | 0], d: d.id, dn: d.n[0], a, demo: 1 });
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
  const rows = [['date', 'language', 'service', ...K]].concat(R.map((r) => [new Date(r.t).toISOString(), r.l, r.dn, ...K.map((k) => c(k, r.a[k]))]));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([rows.map((r) => r.map((x) => '"' + String(x).replace(/"/g, '""') + '"').join(',')).join('\n')], { type: 'text/csv' }));
  a.download = 'dmc-feedback.csv';
  a.click();
}

/* ---------- Splash & Welcome Animation ---------- */
let splashAnimTimers = [];

function animateWelcomeText(text) {
  const wl = $('wl');
  if (!wl) return;
  wl.innerHTML = [...text].map((c, n) =>
    `<span style="animation-delay:${n * 0.032}s">${c === ' ' ? '&nbsp;' : esc(c)}</span>`
  ).join('');
}

function selectSplashLang(code) {
  if (welcomeTimer) {
    clearTimeout(welcomeTimer);
    welcomeTimer = null;
  }
  splashAnimTimers.forEach(clearTimeout);
  splashAnimTimers = [];
  if (IX.hasOwnProperty(code)) S.lang = code;
  hideSplash(() => startSurvey());
}

function startSplashSequence() {
  const wl = $('wl');
  const langsBox = $('splash-langs');
  if (!wl) return;

  const welcomeMessages = [
    'Bienvenue à DMC Hospital',          // French
    'Murakaza neza kuri DMC Hospital',   // Kinyarwanda
    'Welcome to DMC Hospital'            // English
  ];

  splashAnimTimers.forEach(clearTimeout);
  splashAnimTimers = [];

  // 1. French animation at 350ms
  splashAnimTimers.push(setTimeout(() => {
    animateWelcomeText(welcomeMessages[0]);
  }, 350));

  // 2. Kinyarwanda animation at 2000ms
  splashAnimTimers.push(setTimeout(() => {
    animateWelcomeText(welcomeMessages[1]);
  }, 2000));

  // 3. English animation at 3700ms
  splashAnimTimers.push(setTimeout(() => {
    animateWelcomeText(welcomeMessages[2]);
  }, 3700));

  // Reveal language button options right after the 3 animations at 5200ms
  splashAnimTimers.push(setTimeout(() => {
    if (langsBox) langsBox.classList.add('visible');
  }, 5200));

  // Auto-proceed if no language is tapped after comfortable idle time (12s)
  welcomeTimer = setTimeout(() => {
    hideSplash(() => renderIntro());
  }, 12500);
}

/* ---------- Boot ---------- */
function boot() {
  const adm = location.hash === '#admin', s = $('splash');
  if (welcomeTimer) {
    clearTimeout(welcomeTimer);
    welcomeTimer = null;
  }
  splashAnimTimers.forEach(clearTimeout);
  splashAnimTimers = [];

  if (adm) {
    if (s) s.remove();
    admin();
    return;
  }
  if (loadCompletion()) {
    if (s) s.remove();
    renderComplete();
    return;
  }
  if (s) {
    startSplashSequence();
    return;
  }
  renderIntro();
}
addEventListener('hashchange', boot);
boot();

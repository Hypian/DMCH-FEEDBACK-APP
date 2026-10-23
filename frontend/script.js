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
let S = { lang: 'en', a: {} }, i = 0, tab = 'users';
let answerTimer = null, submitting = false, progressTimer = null;
let feedbackResponses = [];
let dashboardFeedbackTimer = null;
let dashboardFeedbackRefreshInProgress = false;
let departmentsLoaded = false;
let adminSession = null;
let adminLoading = false;
let adminDataLoaded = false;
let adminError = '';
let adminDirectory = [];
let activeUsers = [];
let managedUsers = [];
let pendingFeedbackDeleteId = null;
let userManagementLoading = false;
let userManagementLoaded = false;
let userManagementError = '';
let auditEntries = [];
let auditLoading = false;
let auditLoaded = false;
let auditError = '';
let auditRefreshInProgress = false;
const g = (a) => a[IX[S.lang]] || a[0];
const API_ORIGIN = typeof window === 'undefined'
  ? ''
  : String(window.DMC_API_ORIGIN || '').replace(/\/+$/, '');

async function apiRequest(path, method = 'GET', body) {
  const response = await fetch(`${API_ORIGIN}${path}`, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.message || data?.error || 'The server request failed.');
    error.status = response.status;
    error.details = data;
    throw error;
  }
  return data;
}
const U = {
  welcome: ['Welcome to DMC Hospital', 'Bienvenue à DMC Hospital', 'Murakaza neza kuri DMC Hospital'],
  pick: ['Choose your language', 'Choisissez votre langue', 'Hitamo ururimi'],
  introTitle: [
    'OUTPATIENT DEPARTMENT FEEDBACK QUESTIONNAIRE',
    'QUESTIONNAIRE DE SATISFACTION DU SERVICE DES CONSULTATIONS EXTERNES (OPD)',
    'GUKUSANYA IBITEKEREZO BY\'ABARWAYI BAJE KWIVUZA BATAHA (OPD)'
  ],
  introBody: [
    'Your feedback is important to us and will help us improve the quality of our services. Please take a moment to complete this short survey. Your responses are anonymous and confidential.',
    'Votre avis compte pour nous et nous aidera à améliorer la qualité de nos services. Merci de prendre un instant pour répondre à ce court questionnaire. Vos réponses sont anonymes et confidentielles.',
    'Ibitekerezo byanyu n’ingirakamaro kuri twe kandi bizadufasha kunoza serivisi zacu. Turabasaba ngo muduhe akanya gato mu kuzuza uru rupapuro rwikusanyabitekerezo kuri serivise dutanga.'
  ],
  startSurvey: ['Start survey', 'Commencer le questionnaire', 'Tangira'],
  surveyProgress: ['Survey progress', 'Progression du questionnaire', 'Aho ugeze mu bibazo'],
  submittingTitle: ['Saving your survey', 'Enregistrement de votre questionnaire', 'Turimo kubika ibisubizo byawe'],
  submittingStep: ['Preparing your answers', 'Préparation de vos réponses', 'Gutegura ibisubizo byawe'],
  savingAnswers: ['Saving your answers securely…', 'Enregistrement sécurisé de vos réponses…', 'Turimo kubika ibisubizo byawe mu mutekano…'],
  submitting: ['Sending your survey securely…', 'Envoi sécurisé de votre questionnaire…', 'Turimo kohereza ibisubizo byawe mu mutekano…'],
  completionTitle: [
    'Thank you for choosing Dream Medical Center Hospital!',
    'Merci d’avoir choisi Dream Medical Center Hospital !',
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
  connectionError: [
    'The feedback server is unavailable. Run npm start in the project folder, open the URL it prints (normally http://localhost:5173), and configure the required Neon settings in .env.',
    'Le serveur de commentaires est indisponible. Exécutez npm start dans le dossier du projet, ouvrez l’adresse affichée (normalement http://localhost:5173) et configurez les paramètres Neon requis dans .env.',
    'Seriveri yakira ibitekerezo ntiboneka. Koresha npm start muri dosiye y’umushinga, ufungure aderesi igaragazwa (akenshi http://localhost:5173), kandi ushyire amakuru asabwa ya Neon muri .env.'
  ],
  submitError: [
    'We could not save your feedback. Check your connection and try again.',
    'Nous n’avons pas pu enregistrer votre avis. Vérifiez votre connexion et réessayez.',
    'Ntitwashoboye kubika igitekerezo cyawe. Reba umurongo wa interineti wongere ugerageze.'
  ],
  retryHint: [
    'Your answers are still here. Check your connection, then try again.',
    'Vos réponses sont toujours là. Vérifiez votre connexion, puis réessayez.',
    'Ibisubizo byawe biracyahari. Reba umurongo wa interineti wongere ugerageze.'
  ],
  retrySubmit: ['Try saving again', 'Réessayer l’enregistrement', 'Ongera ugerageze kubika'],
  dept: ['Visited services', 'Services visités', 'Serivisi Yasuwe'],
  all: [
    'Please select all that apply',
    'Cochez toutes les réponses applicables',
    'Hitamo ibihuye byose'
  ],
  ph: ['Type here (optional)', 'Écrivez ici (facultatif)', 'Andika hano (si ngombwa)'],
  next: ['Next', 'Suivant', 'Komeza'],
  back: ['Back', 'Retour', 'Subira inyuma'],
  send: ['Submit', 'Envoyer', 'Ohereza'],
  feedbackDeleteTitle: ['Delete this feedback?', 'Supprimer cet avis ?', 'Gusiba iki gitekerezo?'],
  feedbackDeleteDescription: [
    'This feedback record will be permanently deleted. This action cannot be undone.',
    'Cet avis sera supprimé définitivement. Cette action est irréversible.',
    'Iki gitekerezo kizasibwa burundu. Iki gikorwa ntigishobora gusubizwa inyuma.'
  ],
  feedbackDeleteCancel: ['Cancel', 'Annuler', 'Hagarika'],
  feedbackDeleteConfirm: ['Delete feedback', 'Supprimer l’avis', 'Siba igitekerezo'],
};
const COOLDOWN_MS = 24 * 60 * 60 * 1000;
let welcomeTimer = null;

const RATE = P('Excellent~Excellente~Byiza cyane|Good~Bonne~Byiza|Fair~Moyenne~Mu rugero|Poor~Mauvaise~Bibi|Very poor~Très mauvaise~Bibi cyane');
const AREA = P("Reception desk~Réception~Aho bakirira abagana ivuriro|Cashier’s desk~Caisse~Aho abagana ivuriro bishyurira|Triage~Triage~Isuzuniro ry’ibanze|Consultation~Consultation~Kubonana n'umuganga|Emergency~Urgences~Aho bakirira indembe n’inkomere|Laboratory~Laboratoire~Aho batangira ibizamini|Radiology/imaging~Radiologie/Imagerie~Guca mucyuma|Minor surgery~Petite chirurgie~Kubagwa byoroheje|Physiotherapy service~Service de physiothérapie~Aho bagorora ingingo|Vaccination~Vaccination~Aho batangira inkingo|Restaurant~Restaurant~Aho batangira amafunguro");
const Q = {
  dept: { t: 'd', q: T3('Visited services~Services visités~Serivisi Yasuwe') },
  cat: {
    t: 's',
    q: T3('Patient category~Catégorie de patient~Umurwayi'),
    o: P('New patient~Nouveau patient ou nouvelle patiente~Uje bwa mbere.|Returning patient~Patient de retour~Usanzwe y’ivuriza hano.')
  },
  time: {
    t: 's',
    q: T3('Visit time~Heure de la visite~Igihe waziye'),
    o: P('8:00 AM – 5:00 PM~8h00 – 17h00~8h00 – 17h00|5:00 PM – 9:00 PM~17h00 – 21h00~17h00 – 21h00|9:00 PM – 8:00 AM~21h00 – 8h00~21h00 – 8h00')
  },
  q1: {
    t: 's',
    q: T3("1. How was your experience at the reception and registration desk?~1. Comment évaluez-vous votre expérience à l’accueil et au guichet d’enregistrement ?~1. Wakiriwe ute n’abashinzwe kwakira abatugana (reception desk)?"),
    o: RATE
  },
  q2: {
    t: 's',
    q: T3("2. How was your experience at the cashier’s desk?~2. Comment évaluez-vous votre expérience à la caisse ?~2. Wakiriwe ute n’abashinzwe kwishyuza abatugana (cash desk)?"),
    o: RATE
  },
  q3: {
    t: 's',
    q: T3('3. How long did you wait before seeing the doctor?~3. Combien de temps avez-vous attendu avant de consulter le médecin ?~3. Wategereje b’ingana iki mbere yo kubonana n\'umuganga?'),
    o: P('Less than 15 minutes~Moins de 15 minutes~Munsi y\'iminota 15|15–30 minutes~15–30 minutes~Iminota 15–30|30–60 minutes~30–60 minutes~Iminota 30–60|1–2 hours~1–2 heures~Isaha 1–2|More than 2 hours~Plus de 2 heures~Birenze amasaha 2')
  },
  q4: {
    t: 'm',
    q: T3("4. Where did you experience a delay? Please select all that apply.~4. À quel endroit avez-vous rencontré un retard ? Cochez toutes les réponses applicables.~4. Ni hehe wagize ubukererwe? Hitamo ibihuye byose."),
    o: AREA.concat(P("I did not experience any delay~Je n'ai rencontré aucun retard~Sinigeze ngira ubukererwe"))
  },
  q5: {
    t: 's',
    q: T3('5. Did the doctor listen carefully and address your concerns during the consultation?~5. Le prestataire de soins vous a-t-il écouté attentivement et a-t-il pris en compte vos préoccupations pendant la consultation ?~5. Umuganga wakwakiriye yaguteze amatwi bikunyuze mu gihe mwaganiraga ku burwayi bwawe?'),
    o: P('Yes~Oui~Yego|Partly~Partiellement~Mu rugero|No~Non~Oya')
  },
  q6: {
    t: 'm',
    q: T3('6. In which of the following OPD areas did you have an unpleasant experience?~6. Dans les services suivants, où avez-vous vécu une expérience désagréable ?~6. Ni hehe mwahuye n’ikibazo cyangwa serivisi idashimishije muri izi serivisi z’abivuza bataha ?'),
    o: AREA.concat(P('None~Aucun problème~Nta kibazo'))
  },
  q7: {
    t: 's',
    q: T3('7. How do you rate the cleanliness of the OPD area?~7. Comment évaluez-vous la propreté des locaux du service des consultations externes ?~7. Mwabonye mute isuku y’aho abivuza bakirirwa?'),
    o: RATE
  },
  q8: {
    t: 's',
    q: T3('8. Overall, how satisfied are you with your visit today?~8. Dans l\'ensemble, êtes-vous satisfait(e) de votre visite d’aujourd’hui ?~8. Muri rusange, wanyuzwe ute n\'uburyo wakiriwe mu bitaro bya Dream Medical center (DMC)?'),
    o: P('Very satisfied~Très satisfait(e)~Ndanyuzwe cyane|Satisfied~Satisfait(e)~Ndanyuzwe|Neutral~Neutre~Mu rugero|Dissatisfied~Insatisfait(e)~Sinanyuzwe|Very dissatisfied~Très insatisfait(e)~Sinanyuzwe na gato')
  },
  q9: {
    t: 'x',
    q: T3("9. What additional services would you like Dream Medical Center to offer?~9. Quels services supplémentaires souhaiteriez-vous que Dream Medical Center propose ?~9. Ni izihe serivisi z'inyongera wifuza ko ibitaro bya Dream Medical Center (DMC) byatanga?")
  },
  q10: {
    t: 'x',
    q: T3('10. Please tell us how we can improve. Add any other comments or suggestions.~10. Merci de nous indiquer comment nous améliorer. Vous pouvez également ajouter tout autre commentaire ou suggestion.~10. Turabasaba ibitekerezo by’ibyo twanoza, n’Ikindi cyose mwifuza kutubwira muhawe ikaze.')
  }
};

const OPD = P("Gynecology & Obstetrics~Gynécologie-obstétrique~Ubuvuzi bw’ababyeyi|Internal medicine~Médecine interne~Ubuvuzi bw’imbere mu Mubiri|Orthopedics~Orthopédie~Ubuvuzi bw’indwara z’amagufa|Pediatrics~Pédiatrie~Ubuvuzi bw'Abana|General surgery~Chirurgie générale~Imbagwa|Physiotherapy & rehabilitation~Physiothérapie et rééducation~kugorora ingingo|General medicine~Médecine générale~Ubuvuzi Rusange|ENT~ORL~Ubuvuzi bw’indwara z’amatwi, Izuru n'Umuhogo|Urology~Urologie~Ubuvuzi bw’umuyoboro w'Inkari|Ophthalmology~Ophtalmologie~Ubuvuzi bw’amaso|Dental~Dentaire~Ubuvuzi bw’amenyo|Emergency & observation~Urgences et observation~Aho bakirira indembe n’inkomere|Radiology / Imaging~Radiologie / imagerie~Guca mu cyuma|Vaccination~Vaccination~Aho batangira Inkingo|Laboratory~Laboratoire~Aho batangira ibizamini|Minor surgery~Petite chirurgie~Kubagwa Byoroheje");

let cfg = ld('dmc_c', null);
if (!cfg || !cfg.v || cfg.v < 2) {
  cfg = {
    v: 2,
    depts: OPD.map((n, k) => ({ id: 'o' + k, n }))
  };
  sv('dmc_c', cfg);
}

async function loadDepartments(includeInactive = false) {
  const departments = await apiRequest(`/api/departments${includeInactive ? '?all=1' : ''}`);
  cfg.depts = departments.map((department) => ({
    id: department.id,
    n: department.labels,
    active: department.is_active
  }));
  departmentsLoaded = true;
}

function toFeedbackResponse(row) {
  const submittedAt = Date.parse(row.submitted_at);
  if (!Number.isFinite(submittedAt)) {
    throw new Error(`Feedback record ${row.id || '(unknown)'} has an invalid submission time.`);
  }
  return {
    id: row.id,
    t: submittedAt,
    l: row.language,
    d: row.department_id,
    dn: row.department_name,
    a: row.answers
  };
}

async function loadAdminData() {
  adminLoading = true;
  adminError = '';
  admin();
  try {
    const [responses, departments] = await Promise.all([
      apiRequest('/api/responses'),
      apiRequest('/api/departments?all=1')
    ]);
    feedbackResponses = responses.map(toFeedbackResponse);
    cfg.depts = departments.map((department) => ({
      id: department.id,
      n: department.labels,
      active: department.is_active
    }));
    departmentsLoaded = true;
    adminDataLoaded = true;
    startDashboardFeedbackRefresh();
  } catch (error) {
    console.error('Could not load dashboard data:', error);
    adminError = 'Dashboard data could not be loaded. Check database setup and account permissions.';
  } finally {
    adminLoading = false;
    admin();
  }
}

async function refreshDashboardFeedback() {
  if (!adminSession || location.hash !== '#admin' || !adminDataLoaded || adminLoading || dashboardFeedbackRefreshInProgress) return;
  dashboardFeedbackRefreshInProgress = true;
  try {
    const responses = await apiRequest('/api/responses');
    const updatedResponses = responses.map(toFeedbackResponse);
    const previousIds = feedbackResponses.map(({ id, t }) => [id, t]);
    const updatedIds = updatedResponses.map(({ id, t }) => [id, t]);
    if (JSON.stringify(previousIds) !== JSON.stringify(updatedIds)) {
      feedbackResponses = updatedResponses;
      admin();
    }
  } catch (error) {
    console.error('Could not refresh dashboard feedback:', error);
  } finally {
    dashboardFeedbackRefreshInProgress = false;
  }
  if (tab === 'audit') await loadAuditEvents(false);
}

function startDashboardFeedbackRefresh() {
  if (dashboardFeedbackTimer !== null || location.hash !== '#admin') return;
  dashboardFeedbackTimer = setInterval(refreshDashboardFeedback, 3000);
}

function stopDashboardFeedbackRefresh() {
  if (dashboardFeedbackTimer === null) return;
  clearInterval(dashboardFeedbackTimer);
  dashboardFeedbackTimer = null;
}

async function initializeAdmin() {
  try {
    adminSession = await apiRequest('/api/dashboard/session');
    await loadAdminData();
  } catch (error) {
    console.error('Could not initialize the admin dashboard:', error);
    adminLoading = false;
    if (error.status === 401) {
      location.assign(`login.html?next=${encodeURIComponent('index.html#admin')}`);
      return;
    }
    adminError = error.status === 403
      ? 'This account must be approved before it can access the dashboard.'
      : 'Dashboard access could not be verified. Check server setup and account permissions.';
    admin();
  }
}

const flow = () => ['time', 'dept', 'cat', 'q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9', 'q10'];

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

function getDeviceId() {
  const key = 'dmc_device_id';
  let deviceId = localStorage.getItem(key);
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem(key, deviceId);
  }
  return deviceId;
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

async function startSurvey() {
  const button = $('start-survey');
  if (button) button.disabled = true;
  try {
    if (loadCompletion()) {
      renderComplete();
      return;
    }
    if (!departmentsLoaded) await loadDepartments();
    const storageCheck = 'dmc_storage_check';
    localStorage.setItem(storageCheck, 'available');
    if (localStorage.getItem(storageCheck) !== 'available') {
      throw new Error('Browser storage did not retain a test value.');
    }
    localStorage.removeItem(storageCheck);
    try {
      await apiRequest('/api/check', 'POST', { deviceId: getDeviceId() });
    } catch (error) {
      if (error.status !== 409 || error.details?.error !== 'duplicate_submission') throw error;
      const retryAfterMs = Number(error.details.retryAfterSeconds) * 1000;
      storeCompletion(Date.now() - (COOLDOWN_MS - retryAfterMs));
      renderComplete();
      return;
    }
    i = 0;
    render();
    scrollTo(0, 0);
  } catch (error) {
    console.error('Could not start the survey:', error);
    const notice = $('intro-error');
    if (notice) notice.textContent = String(error?.message || error).includes('Browser storage')
      ? g(U.deviceStorageError)
      : g(U.connectionError);
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
    await apiRequest('/api/submit', 'POST', {
      deviceId: getDeviceId(),
      language: S.lang,
      departmentId: S.dept,
      answers: S.a
    });
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
let cohortFilter = 'all';
let adminSigningOut = false;
let adminDateFilter = 'all'; // 'all', 'today', '7d', '30d', 'custom'
let customStartDate = '';
let customEndDate = '';
let feedbackSearchQuery = '';
let feedbackServiceFilter = 'all';
let feedbackRatingFilter = 'all'; // 'all', 'sat', 'neu', 'diss'
let feedbackPage = 1;
const FEEDBACK_PAGE_SIZE = 10;
let deptSearchQuery = '';
let deptIssueFilter = 'all'; // 'all', 'delay', 'dissatisfied', 'top'
let deptSortKey = 'total'; // 'total', 'avg', 'diss', 'delay'

function getFilteredResponses() {
  const all = feedbackResponses || [];
  if (adminDateFilter === 'all') return all;
  const now = new Date();
  if (adminDateFilter === 'today') {
    const todayStr = now.toISOString().slice(0, 10);
    return all.filter((r) => r.t && new Date(r.t).toISOString().slice(0, 10) === todayStr);
  }
  if (adminDateFilter === '7d') {
    const cutoff = Date.now() - 7 * 86400000;
    return all.filter((r) => r.t && new Date(r.t).getTime() >= cutoff);
  }
  if (adminDateFilter === '30d') {
    const cutoff = Date.now() - 30 * 86400000;
    return all.filter((r) => r.t && new Date(r.t).getTime() >= cutoff);
  }
  if (adminDateFilter === 'custom') {
    return all.filter((r) => {
      if (!r.t) return false;
      const t = new Date(r.t).getTime();
      if (customStartDate) {
        const start = new Date(customStartDate + 'T00:00:00').getTime();
        if (t < start) return false;
      }
      if (customEndDate) {
        const end = new Date(customEndDate + 'T23:59:59.999').getTime();
        if (t > end) return false;
      }
      return true;
    });
  }
  return all;
}

function getDateFilterLabel() {
  if (adminDateFilter === 'today') return 'Today';
  if (adminDateFilter === '7d') return 'Last 7 Days';
  if (adminDateFilter === '30d') return 'Last 30 Days';
  if (adminDateFilter === 'custom') {
    if (customStartDate && customEndDate) return `${customStartDate} to ${customEndDate}`;
    if (customStartDate) return `From ${customStartDate}`;
    if (customEndDate) return `Up to ${customEndDate}`;
    return 'Custom Date Range';
  }
  return 'All Time';
}

function setDateFilter(filter) {
  adminDateFilter = filter;
  feedbackPage = 1;
  admin();
}

function updateCustomDates(start, end) {
  customStartDate = start;
  customEndDate = end;
  adminDateFilter = 'custom';
  feedbackPage = 1;
  admin();
}

function renderDateFilterBar(contextTitle = 'Filter by period') {
  const count = getFilteredResponses().length;
  const total = feedbackResponses.length;
  return `<div class="date-filter-bar">
    <div class="date-filter-info">
      <span class="date-filter-label"><i class='bx bx-calendar'></i> <b>Time Range:</b> ${esc(getDateFilterLabel())}</span>
      <span class="date-filter-count">(${count} of ${total} records)</span>
    </div>
    <div class="date-filter-controls">
      <div class="date-quick-pills">
        <button type="button" class="date-pill ${adminDateFilter === 'all' ? 'active' : ''}" onclick="setDateFilter('all')">All Time</button>
        <button type="button" class="date-pill ${adminDateFilter === 'today' ? 'active' : ''}" onclick="setDateFilter('today')">Today</button>
        <button type="button" class="date-pill ${adminDateFilter === '7d' ? 'active' : ''}" onclick="setDateFilter('7d')">Last 7 Days</button>
        <button type="button" class="date-pill ${adminDateFilter === '30d' ? 'active' : ''}" onclick="setDateFilter('30d')">Last 30 Days</button>
        <button type="button" class="date-pill ${adminDateFilter === 'custom' ? 'active' : ''}" onclick="setDateFilter('custom')">Custom</button>
      </div>
      <div class="date-custom-inputs" style="${adminDateFilter === 'custom' ? 'display:flex;' : 'display:none;'}">
        <input type="date" class="date-input" aria-label="Start date" id="date-start" value="${esc(customStartDate)}" onchange="updateCustomDates(this.value, $('date-end')?.value || '')">
        <span class="date-sep">to</span>
        <input type="date" class="date-input" aria-label="End date" id="date-end" value="${esc(customEndDate)}" onchange="updateCustomDates($('date-start')?.value || '', this.value)">
      </div>
    </div>
  </div>`;
}

function renderDonutChart({ title, subtitle, items, centerValue, centerLabel }) {
  const total = items.reduce((sum, item) => sum + (Number(item.value) || 0), 0);
  const size = 150;
  const strokeWidth = 24;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  let accumulatedPercent = 0;
  const segments = total > 0 ? items.map((item) => {
    if (!item.value) return '';
    const percent = item.value / total;
    const strokeDasharray = `${(percent * circumference).toFixed(2)} ${circumference.toFixed(2)}`;
    const strokeDashoffset = (-accumulatedPercent * circumference).toFixed(2);
    accumulatedPercent += percent;
    return `<circle cx="${size / 2}" cy="${size / 2}" r="${radius.toFixed(2)}"
      fill="none"
      stroke="${item.color}"
      stroke-width="${strokeWidth}"
      stroke-dasharray="${strokeDasharray}"
      stroke-dashoffset="${strokeDashoffset}"
      transform="rotate(-90 ${size / 2} ${size / 2})"
      class="donut-segment">
      <title>${esc(item.label)}: ${item.value} (${Math.round(percent * 100)}%)</title>
    </circle>`;
  }).join('') : `<circle cx="${size / 2}" cy="${size / 2}" r="${radius.toFixed(2)}" fill="none" stroke="#e5eaf0" stroke-width="${strokeWidth}" />`;

  const legend = items.map((item) => {
    const pct = total > 0 ? Math.round((item.value / total) * 100) : 0;
    return `<div class="chart-legend-item">
      <span class="legend-swatch" style="background:${item.color}"></span>
      <span class="legend-label" title="${esc(item.label)}">${esc(item.label)}</span>
      <b class="legend-val">${item.value} <small style="font-weight:normal;opacity:.8">(${pct}%)</small></b>
    </div>`;
  }).join('');

  return `<div class="donut-chart-card">
    <div class="donut-chart-header">
      <h4>${title}</h4>
      ${subtitle ? `<p class="hint">${subtitle}</p>` : ''}
    </div>
    <div class="donut-chart-body">
      <div class="donut-svg-wrap">
        <svg viewBox="0 0 ${size} ${size}" class="donut-svg" role="img" aria-label="${esc(title)}">
          ${segments}
        </svg>
        <div class="donut-center-info">
          <span class="donut-center-val">${esc(centerValue)}</span>
          <span class="donut-center-lbl">${esc(centerLabel)}</span>
        </div>
      </div>
      <div class="chart-legend">
        ${legend}
      </div>
    </div>
  </div>`;
}

function renderVisualBars(items, maxValue, unit = '') {
  if (!items || !items.length) return '<p class="hint">–</p>';
  return `<div class="visual-bar-chart">` +
    items.map(([label, val, color]) => {
      const num = Number(val) || 0;
      const pct = Math.min(100, Math.round((num / (maxValue || 1)) * 100));
      const barColor = color || (pct >= 75 ? '#10b981' : pct >= 45 ? '#0284c7' : pct >= 25 ? '#f59e0b' : '#e54b2b');
      return `<div class="visual-bar-row">
        <div class="vbar-meta">
          <span class="vbar-label">${esc(label)}</span>
          <div class="vbar-metrics">
            <b>${val}${unit}</b>
            ${unit !== '%' && maxValue ? `<small style="color:var(--ink-3)">(${pct}%)</small>` : ''}
          </div>
        </div>
        <div class="vbar-track">
          <div class="vbar-fill" style="width:${pct}%;background:${barColor}"></div>
        </div>
      </div>`;
    }).join('') +
  `</div>`;
}

let activeSliceNavigation = null;

function openChartDetailModal(chartKey, itemKey = 'all') {
  const dialog = $('chart-detail-dialog');
  const allFiltered = getFilteredResponses();
  const n = allFiltered.length;

  let subset = [];
  let categoryName = '';
  let sliceLabel = '';
  let sliceColor = '#e54b2b';
  let navFilter = {};

  if (chartKey === 'satisfaction') {
    categoryName = 'Overall Satisfaction Spectrum';
    const ratingMap = {
      star5: { label: '5★ Very Satisfied', filter: (r) => r.a?.q8 === 0, color: '#10b981', navRating: 'sat' },
      star4: { label: '4★ Satisfied', filter: (r) => r.a?.q8 === 1, color: '#0284c7', navRating: 'sat' },
      star3: { label: '3★ Neutral', filter: (r) => r.a?.q8 === 2, color: '#f59e0b', navRating: 'neu' },
      star2: { label: '2★ Dissatisfied', filter: (r) => r.a?.q8 === 3, color: '#ea580c', navRating: 'diss' },
      star1: { label: '1★ Very Dissatisfied', filter: (r) => r.a?.q8 === 4, color: '#e54b2b', navRating: 'diss' }
    };
    if (ratingMap[itemKey]) {
      const target = ratingMap[itemKey];
      sliceLabel = target.label;
      sliceColor = target.color;
      subset = allFiltered.filter(target.filter);
      navFilter = { rating: target.navRating };
    } else {
      sliceLabel = 'All Rated Reviews (1–5★)';
      sliceColor = '#10b981';
      subset = allFiltered.filter((r) => r.a?.q8 != null);
    }
  } else if (chartKey === 'cohorts') {
    categoryName = 'Patient Cohort Ratio';
    if (itemKey === 'new') {
      sliceLabel = 'First-Time / New Patients';
      sliceColor = '#0284c7';
      subset = allFiltered.filter((r) => r.a?.cat === 0);
      navFilter = { cohort: 'new' };
    } else if (itemKey === 'returning') {
      sliceLabel = 'Returning Patients';
      sliceColor = '#d97706';
      subset = allFiltered.filter((r) => r.a?.cat === 1);
      navFilter = { cohort: 'returning' };
    } else {
      sliceLabel = 'All Patient Cohorts';
      sliceColor = '#0284c7';
      subset = allFiltered;
    }
  } else if (chartKey === 'times') {
    categoryName = 'Visit Shifts Distribution';
    const timeMap = {
      time0: { label: 'Morning (8am–12pm)', filter: (r) => r.a?.time === 0, color: '#06b6d4' },
      time1: { label: 'Afternoon (12pm–4pm)', filter: (r) => r.a?.time === 1, color: '#3b82f6' },
      time2: { label: 'Evening (4pm–8pm)', filter: (r) => r.a?.time === 2, color: '#8b5cf6' },
      time3: { label: 'Night / Emergency', filter: (r) => r.a?.time === 3, color: '#64748b' }
    };
    if (timeMap[itemKey]) {
      const target = timeMap[itemKey];
      sliceLabel = target.label;
      sliceColor = target.color;
      subset = allFiltered.filter(target.filter);
    } else {
      sliceLabel = 'All Operating Shifts';
      sliceColor = '#3b82f6';
      subset = allFiltered;
    }
  } else if (chartKey === 'doctor') {
    categoryName = 'Doctor Care & Attentiveness';
    const docMap = {
      docYes: { label: 'Yes, Doctor Listened Attentively', filter: (r) => r.a?.q5 === 0, color: '#10b981' },
      docPart: { label: 'Doctor Was Partially Attentive', filter: (r) => r.a?.q5 === 1, color: '#f59e0b' },
      docNo: { label: 'Doctor Did Not Listen Attentively', filter: (r) => r.a?.q5 === 2, color: '#e54b2b' }
    };
    if (docMap[itemKey]) {
      const target = docMap[itemKey];
      sliceLabel = target.label;
      sliceColor = target.color;
      subset = allFiltered.filter(target.filter);
    } else {
      sliceLabel = 'All Doctor Care Evaluations';
      sliceColor = '#e54b2b';
      subset = allFiltered.filter((r) => r.a?.q5 != null);
    }
  }

  activeSliceNavigation = navFilter;

  const count = subset.length;
  const pct = n > 0 ? Math.round((count / n) * 100) : 0;
  const s8 = subset.filter((r) => r.a?.q8 != null).map((r) => 5 - r.a.q8);
  const avgSat = s8.length ? (s8.reduce((a, b) => a + b, 0) / s8.length).toFixed(1) : '–';
  const newCount = subset.filter((r) => r.a?.cat === 0).length;
  const retCount = subset.filter((r) => r.a?.cat === 1).length;
  const withComments = subset.filter((r) => (r.a?.q9 && r.a.q9.trim()) || (r.a?.q10 && r.a.q10.trim()));

  const deptFreq = {};
  subset.forEach((r) => {
    const d = r.dn || 'General medicine';
    deptFreq[d] = (deptFreq[d] || 0) + 1;
  });
  const topDeptEntry = Object.entries(deptFreq).sort((a, b) => b[1] - a[1])[0];
  const topDeptStr = topDeptEntry ? `${topDeptEntry[0]} (${topDeptEntry[1]})` : '–';

  const badgeEl = $('chart-detail-badge');
  if (badgeEl) {
    badgeEl.textContent = categoryName;
    badgeEl.style.backgroundColor = `${sliceColor}18`;
    badgeEl.style.color = sliceColor;
    badgeEl.style.borderColor = `${sliceColor}40`;
  }
  const titleEl = $('chart-detail-title');
  if (titleEl) titleEl.textContent = sliceLabel;
  const subtitleEl = $('chart-detail-subtitle');
  if (subtitleEl) subtitleEl.textContent = `Detailed breakdown for active range: ${getDateFilterLabel()} • ${count} of ${n} responses (${pct}%)`;
  const countEl = $('chart-detail-count');
  if (countEl) countEl.textContent = count;

  const statsEl = $('chart-detail-stats');
  if (statsEl) {
    statsEl.innerHTML = `
      <div class="chart-stat-tile">
        <span class="cst-num" style="color:${sliceColor}">${count}</span>
        <span class="cst-lbl">Total Responses (${pct}%)</span>
      </div>
      <div class="chart-stat-tile">
        <span class="cst-num" style="color:var(--navy)">${avgSat} <small style="font-size:13px;font-weight:normal">/ 5.0</small></span>
        <span class="cst-lbl">Average Satisfaction</span>
      </div>
      <div class="chart-stat-tile">
        <span class="cst-num" style="color:var(--navy)">${newCount} / ${retCount}</span>
        <span class="cst-lbl">New vs. Returning</span>
      </div>
      <div class="chart-stat-tile">
        <span class="cst-num" style="font-size:14px;color:var(--ink);">${esc(topDeptStr)}</span>
        <span class="cst-lbl">Top Visited Service</span>
      </div>
      <div class="chart-stat-tile">
        <span class="cst-num" style="color:var(--red)">${withComments.length}</span>
        <span class="cst-lbl">Written Comments</span>
      </div>
    `;
  }

  const recordsEl = $('chart-detail-records');
  if (recordsEl) {
    if (!count) {
      recordsEl.innerHTML = `<div class="chart-record-empty"><p class="hint">No matching responses found for this slice within ${esc(getDateFilterLabel())}.</p></div>`;
    } else {
      const waitOptions = ['<15 min', '15–30 min', '30–60 min', '>60 min'];
      const shiftOptions = ['Morning (8am–12pm)', 'Afternoon (12pm–4pm)', 'Evening (4pm–8pm)', 'Night / Emergency'];
      recordsEl.innerHTML = subset.map((r, idx) => {
        const timeStr = r.submitted_at ? new Date(r.submitted_at).toLocaleString() : 'Recent';
        const star = r.a?.q8 != null ? 5 - r.a.q8 : null;
        const starColor = star >= 4 ? '#10b981' : star === 3 ? '#f59e0b' : '#e54b2b';
        const starLabel = star ? `${star}★ Rating` : 'Not Rated';
        const cohortLabel = r.a?.cat === 0 ? 'First-Time Patient' : 'Returning Patient';
        const shiftLabel = r.a?.time != null ? shiftOptions[r.a.time] : '';
        const waitLabel = r.a?.q3 != null ? `Wait: ${waitOptions[r.a.q3] || '–'}` : '';
        const comment = [r.a?.q9, r.a?.q10].filter((x) => x && x.trim()).join(' — ');

        return `<div class="chart-record-card">
          <div class="chart-record-header">
            <div class="chart-record-dept">
              <b>#${idx + 1} ${esc(r.dn || 'General medicine')}</b>
              <small class="hint"><i class='bx bx-time'></i> ${esc(timeStr)}</small>
            </div>
            <div class="chart-record-badges">
              <span class="chart-record-pill" style="color:${starColor};background:${starColor}15;border-color:${starColor}35;"><i class='bx bxs-star'></i> ${starLabel}</span>
              <span class="chart-record-pill cohort"><i class='bx bx-user'></i> ${cohortLabel}</span>
              ${shiftLabel ? `<span class="chart-record-pill shift"><i class='bx bx-time-five'></i> ${esc(shiftLabel)}</span>` : ''}
              ${waitLabel ? `<span class="chart-record-pill wait">${esc(waitLabel)}</span>` : ''}
            </div>
          </div>
          ${comment ? `<div class="chart-record-comment"><i class='bx bxs-quote-left'></i> <span>"${esc(comment)}"</span></div>` : ''}
        </div>`;
      }).join('');
    }
  }

  if (dialog && typeof dialog.showModal === 'function') {
    dialog.showModal();
  }
}

function closeChartDetailModal() {
  const dialog = $('chart-detail-dialog');
  if (dialog && typeof dialog.close === 'function') {
    dialog.close();
  }
}

function goToFeedbacksSlice() {
  closeChartDetailModal();
  if (activeSliceNavigation) {
    if (activeSliceNavigation.rating) feedbackRatingFilter = activeSliceNavigation.rating;
    if (activeSliceNavigation.cohort) cohortFilter = activeSliceNavigation.cohort;
  }
  tab = 'feedbacks';
  admin();
}

function renderLargeVisualDonut({ chartKey, title, subtitle, items, centerValue, centerLabel }) {
  const total = items.reduce((sum, item) => sum + (Number(item.value) || 0), 0);
  const size = 220;
  const strokeWidth = 32;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  let accumulatedPercent = 0;
  const segments = total > 0 ? items.map((item) => {
    if (!item.value) return '';
    const percent = item.value / total;
    const strokeDasharray = `${(percent * circumference).toFixed(2)} ${circumference.toFixed(2)}`;
    const strokeDashoffset = (-accumulatedPercent * circumference).toFixed(2);
    accumulatedPercent += percent;
    return `<circle cx="${size / 2}" cy="${size / 2}" r="${radius.toFixed(2)}"
      fill="none"
      stroke="${item.color}"
      stroke-width="${strokeWidth}"
      stroke-dasharray="${strokeDasharray}"
      stroke-dashoffset="${strokeDashoffset}"
      transform="rotate(-90 ${size / 2} ${size / 2})"
      class="donut-segment"
      onclick="event.stopPropagation();openChartDetailModal('${chartKey}','${item.key || ''}')"
      role="button"
      tabindex="0">
      <title>${esc(item.label)}: ${item.value} (${Math.round(percent * 100)}%) – Click to view details</title>
    </circle>`;
  }).join('') : `<circle cx="${size / 2}" cy="${size / 2}" r="${radius.toFixed(2)}" fill="none" stroke="#e5eaf0" stroke-width="${strokeWidth}" />`;

  const legend = items.map((item) => {
    const val = Number(item.value) || 0;
    const pct = total > 0 ? Math.round((val / total) * 100) : 0;
    return `<div class="big-legend-item" onclick="event.stopPropagation();openChartDetailModal('${chartKey}','${item.key || ''}')" role="button" tabindex="0" title="Click to view details for ${esc(item.label)}">
      <div class="big-legend-row">
        <div class="big-legend-left">
          <span class="big-legend-swatch" style="background:${item.color}"></span>
          <span>${esc(item.label)}</span>
        </div>
        <div class="big-legend-right">
          <span>${val}</span>
          <small style="color:var(--ink-3);font-weight:normal">(${pct}%)</small>
        </div>
      </div>
      <div class="big-legend-track">
        <div class="big-legend-fill" style="width:${pct}%;background:${item.color}"></div>
      </div>
    </div>`;
  }).join('');

  return `<div class="big-donut-card" onclick="openChartDetailModal('${chartKey}','all')" role="region" aria-label="${esc(title)}">
    <div class="big-donut-header">
      <div class="big-donut-header-left">
        <h4>${title}</h4>
        ${subtitle ? `<p class="hint">${subtitle}</p>` : ''}
      </div>
      <span class="big-donut-click-hint"><i class='bx bx-search-alt'></i> View Details</span>
    </div>
    <div class="big-donut-body">
      <div class="big-donut-svg-wrap">
        <svg viewBox="0 0 ${size} ${size}" class="big-donut-svg" role="img" aria-label="${esc(title)}">
          ${segments}
        </svg>
        <div class="big-donut-center" onclick="event.stopPropagation();openChartDetailModal('${chartKey}','all')" style="cursor:pointer;pointer-events:auto;" title="Click to view full dataset">
          <span class="big-donut-center-val">${esc(centerValue)}</span>
          <span class="big-donut-center-lbl">${esc(centerLabel)}</span>
        </div>
      </div>
      <div class="big-donut-legend">
        ${legend}
      </div>
    </div>
  </div>`;
}

function chartsUI() {
  const allR = feedbackResponses;
  const tools = `<div class=card><h3>${adminSession?.isAdmin ? 'Management Tools' : 'Reports'}</h3><div class=tools><button class="adm-btn primary" onclick="exportExcel('full')"><i class='bx bx-download'></i> Export Filtered Dataset XLSX</button></div></div>`;
  if (!allR.length) {
    return `<div class="card"><p class="hint">No responses recorded yet to plot charts.</p></div>` + tools;
  }

  const dateFiltered = getFilteredResponses();
  const dateBarHtml = renderDateFilterBar('Statistics & Visual Charts');
  if (!dateFiltered.length) {
    return dateBarHtml + `<div class="card"><p class="hint">No responses recorded for ${esc(getDateFilterLabel())}. Try selecting "All Time" or adjusting the date range.</p><button class="adm-btn primary" onclick="setDateFilter('all')">Reset to All Time</button></div>` + tools;
  }

  const newCount = dateFiltered.filter((r) => r.a?.cat === 0).length;
  const retCount = dateFiltered.filter((r) => r.a?.cat === 1).length;
  const R = cohortFilter === 'new' ? dateFiltered.filter((r) => r.a?.cat === 0) : cohortFilter === 'returning' ? dateFiltered.filter((r) => r.a?.cat === 1) : dateFiltered;
  const n = R.length;

  const s8 = R.filter((r) => r.a.q8 != null).map((r) => 5 - r.a.q8);
  const avg = s8.length ? (s8.reduce((a, b) => a + b, 0) / s8.length).toFixed(1) : '–';
  const pos = s8.length ? Math.round(s8.filter((x) => x >= 4).length / s8.length * 100) : 0;
  const neg = s8.length ? Math.round(s8.filter((x) => x <= 2).length / s8.length * 100) : 0;

  // Donut 1: Satisfaction Spectrum
  const star5 = R.filter((r) => r.a?.q8 === 0).length;
  const star4 = R.filter((r) => r.a?.q8 === 1).length;
  const star3 = R.filter((r) => r.a?.q8 === 2).length;
  const star2 = R.filter((r) => r.a?.q8 === 3).length;
  const star1 = R.filter((r) => r.a?.q8 === 4).length;
  const bigDonutSatisfaction = renderLargeVisualDonut({
    chartKey: 'satisfaction',
    title: `<i class='bx bx-star' style="color:#10b981"></i> Overall Satisfaction Spectrum`,
    subtitle: '5-point star rating breakdown across patient reviews',
    items: [
      { key: 'star5', label: '5★ Very Satisfied', value: star5, color: '#10b981' },
      { key: 'star4', label: '4★ Satisfied', value: star4, color: '#0284c7' },
      { key: 'star3', label: '3★ Neutral', value: star3, color: '#f59e0b' },
      { key: 'star2', label: '2★ Dissatisfied', value: star2, color: '#ea580c' },
      { key: 'star1', label: '1★ Very Dissatisfied', value: star1, color: '#e54b2b' }
    ],
    centerValue: `${pos}%`,
    centerLabel: 'Satisfied (4-5★)'
  });

  // Donut 2: Cohorts Ratio
  const bigDonutCohorts = renderLargeVisualDonut({
    chartKey: 'cohorts',
    title: `<i class='bx bx-user-pin' style="color:#0284c7"></i> Patient Cohort Ratio`,
    subtitle: 'First-time visitors vs. returning patients distribution',
    items: [
      { key: 'new', label: 'First-Time Patients', value: newCount, color: '#0284c7' },
      { key: 'returning', label: 'Returning Patients', value: retCount, color: '#d97706' }
    ],
    centerValue: `${dateFiltered.length}`,
    centerLabel: 'Submissions'
  });

  // Donut 3: Visit Times
  const time0 = R.filter((r) => r.a?.time === 0).length;
  const time1 = R.filter((r) => r.a?.time === 1).length;
  const time2 = R.filter((r) => r.a?.time === 2).length;
  const time3 = R.filter((r) => r.a?.time === 3).length;
  const bigDonutVisitTimes = renderLargeVisualDonut({
    chartKey: 'times',
    title: `<i class='bx bx-time-five' style="color:#8b5cf6"></i> Visit Shifts Distribution`,
    subtitle: 'Patient attendance across day and night operational shifts',
    items: [
      { key: 'time0', label: 'Morning (8am–12pm)', value: time0, color: '#06b6d4' },
      { key: 'time1', label: 'Afternoon (12pm–4pm)', value: time1, color: '#3b82f6' },
      { key: 'time2', label: 'Evening (4pm–8pm)', value: time2, color: '#8b5cf6' },
      { key: 'time3', label: 'Night / Emergency', value: time3, color: '#64748b' }
    ],
    centerValue: `${n}`,
    centerLabel: 'Visits'
  });

  // Donut 4: Doctor Care & Attentiveness
  const docYes = R.filter((r) => r.a?.q5 === 0).length;
  const docPart = R.filter((r) => r.a?.q5 === 1).length;
  const docNo = R.filter((r) => r.a?.q5 === 2).length;
  const docTotal = docYes + docPart + docNo;
  const docPct = docTotal > 0 ? Math.round((docYes / docTotal) * 100) : 0;
  const bigDonutDoctor = renderLargeVisualDonut({
    chartKey: 'doctor',
    title: `<i class='bx bx-heart' style="color:#e54b2b"></i> Doctor Care & Attentiveness`,
    subtitle: 'Did doctor listen attentively and answer your questions?',
    items: [
      { key: 'docYes', label: 'Yes, Attentive', value: docYes, color: '#10b981' },
      { key: 'docPart', label: 'Partially Attentive', value: docPart, color: '#f59e0b' },
      { key: 'docNo', label: 'Not Attentive', value: docNo, color: '#e54b2b' }
    ],
    centerValue: `${docPct}%`,
    centerLabel: 'Attentive'
  });

  // Visual Bar data helpers
  const tl = (f, lb) => {
    const m = {};
    R.forEach((r) => [].concat(f(r)).forEach((x) => {
      if (x != null && x !== '') m[x] = (m[x] || 0) + 1;
    }));
    return Object.entries(m).map(([k, v]) => [lb ? lb(k) : k, v]).sort((a, b) => b[1] - a[1]);
  };
  const q = (k, ex) => tl((r) => r.a[k], (v) => Q[k].o[+v][0]).filter((e) => !ex || e[0] !== Q[k].o[Q[k].o.length - 1][0]);
  const good = (k) => {
    const v = R.filter((r) => r.a[k] != null);
    return v.length ? Math.round(v.filter((r) => r.a[k] <= 1).length / v.length * 100) : 0;
  };

  const deptBars = tl((r) => r.dn).slice(0, 10).map(([k, v]) => [k, v, '#17263c']);
  const waitTimes = q('q3').map(([k, v]) => [k, v, k.toLowerCase().includes('less') || k.includes('15') ? '#10b981' : k.includes('30') ? '#0284c7' : k.includes('60') ? '#f59e0b' : '#e54b2b']);
  const delayHotspots = q('q4', 1).map(([k, v]) => [k, v, '#e54b2b']);
  const issueHotspots = q('q6', 1).map(([k, v]) => [k, v, '#ea580c']);
  const qualityScores = [
    ['Reception Staff Care & Courtesy', good('q1'), '#059669'],
    ['Cashier & Billing Efficiency', good('q2'), '#0284c7'],
    ['Hospital Cleanliness & Hygiene', good('q7'), '#10b981']
  ];
  const langBars = tl((r) => r.l, (v) => ({ en: 'English', fr: 'Français', rw: 'Kinyarwanda' }[v])).map(([k, v]) => [k, v, '#2563eb']);

  const filterBarHtml = `<div class="filter-bar">
    <div>
      <h3 style="margin:0"><i class='bx bx-filter-alt'></i> Patient Cohort Slice</h3>
      <p class="hint" style="margin:2px 0 0">Filter visual charts by patient visit type.</p>
    </div>
    <div class="filter-pills">
      <button class="filter-pill ${cohortFilter === 'all' ? 'active' : ''}" onclick="cohortFilter='all';admin()">All Patients (${dateFiltered.length})</button>
      <button class="filter-pill ${cohortFilter === 'new' ? 'active' : ''}" onclick="cohortFilter='new';admin()">First-Time (${newCount})</button>
      <button class="filter-pill ${cohortFilter === 'returning' ? 'active' : ''}" onclick="cohortFilter='returning';admin()">Returning (${retCount})</button>
    </div>
  </div>`;

  return dateBarHtml +
    filterBarHtml +
    `<div class="kpis">
      <div class="kpi"><b>${n}</b>${cohortFilter === 'new' ? 'New Patient' : cohortFilter === 'returning' ? 'Returning' : 'Total'} Responses</div>
      <div class="kpi"><b>${avg}/5</b>Avg Satisfaction</div>
      <div class="kpi"><b>${pos}%</b>Satisfied (4–5★)</div>
      <div class="kpi"><b>${neg}%</b>Dissatisfied (≤2★)</div>
    </div>` +
    `<div class="big-donut-grid">
      ${bigDonutSatisfaction}
      ${bigDonutCohorts}
      ${bigDonutVisitTimes}
      ${bigDonutDoctor}
    </div>` +
    `<div class="chart-card-full">
      <h3><i class='bx bx-buildings'></i> Visited Services & Review Volumes</h3>
      <p class="hint">Patient review counts by outpatient department or clinical service.</p>
      ${renderVisualBars(deptBars, deptBars[0]?.[1] || 1, ' reviews')}
    </div>` +
    `<div class="chart-card-full">
      <h3><i class='bx bx-timer'></i> Doctor Wait Time Breakdown</h3>
      <p class="hint">How long patients waited before being attended to by the doctor.</p>
      ${renderVisualBars(waitTimes, n)}
    </div>` +
    `<div class="chart-card-full">
      <h3><i class='bx bx-alarm-exclamation' style="color:#e54b2b"></i> Operational Delay Hotspots</h3>
      <p class="hint">Service points where patients encountered excessive waiting or bottlenecks.</p>
      ${renderVisualBars(delayHotspots, n)}
    </div>` +
    `<div class="chart-card-full">
      <h3><i class='bx bx-error-circle' style="color:#ea580c"></i> Service Friction & Incident Points</h3>
      <p class="hint">Specific hospital units where patients reported an unpleasant or unsatisfactory experience.</p>
      ${renderVisualBars(issueHotspots, n)}
    </div>` +
    `<div class="chart-card-full">
      <h3><i class='bx bx-shield-check' style="color:#059669"></i> Touchpoint Quality Benchmark (% Rated Good/Excellent)</h3>
      <p class="hint">Percentage of positive ratings across reception, billing, and general facility cleanliness.</p>
      ${renderVisualBars(qualityScores, 100, '%')}
    </div>` +
    `<div class="chart-card-full">
      <h3><i class='bx bx-globe'></i> Patient Preferred Survey Languages</h3>
      <p class="hint">Language distribution chosen by respondents for feedback submission.</p>
      ${renderVisualBars(langBars, n, ' patients')}
    </div>` +
    tools;
}

function admin() {
  const h = `<div class="wrap adm"><div class="adm-header">
    <div class="adm-brand">
      <img src="logo-optimized.jpg" alt="DMC" width="760" height="221" decoding="async">
      <div class="adm-title">
        <span>Executive Quality Dashboard</span>
        <h2>Patient Experience & OPD Performance</h2>
      </div>
    </div>
    <div class="adm-actions">
      <button class="adm-btn" onclick="location.hash=''"><i class='bx bx-arrow-back'></i> Patient App</button>
      ${adminSession ? `<span class="admin-user-name">${esc(adminSession.user.name || adminSession.user.username || '')}</span><button class="adm-btn" onclick="signOutAdmin()" ${adminSigningOut ? 'disabled' : ''}>${adminSigningOut ? "<i class='bx bx-loader-alt bx-spin'></i> Signing out…" : "<i class='bx bx-log-out'></i> Sign out"}</button>` : ''}
    </div>
  </div>`;
  if (!adminSession) {
    $('app').innerHTML = h + `<div class="card" style="max-width:400px;margin:30px auto;text-align:center"><h3>Dashboard Sign-in</h3><p class="hint">${esc(adminError || 'Sign in with your approved account to access the dashboard.')}</p><a class="btn" href="login.html?next=${encodeURIComponent('index.html#admin')}">Sign in</a></div></div>`;
    return;
  }
  if (adminLoading) {
    $('app').innerHTML = h + `<div class="card" role="status" style="max-width:520px;margin:30px auto;text-align:center"><p>Loading secure dashboard data…</p></div></div>`;
    return;
  }
  if (adminError && !adminDataLoaded) {
    $('app').innerHTML = h + `<div class="card" role="alert" style="max-width:520px;margin:30px auto;text-align:center"><p class="error">${esc(adminError)}</p><button class="btn" onclick="loadAdminData()">Try again</button></div></div>`;
    return;
  }
  if (!adminDataLoaded) {
    loadAdminData();
    return;
  }

  const tabs = [
    ['stats', `<i class='bx bx-bar-chart-alt-2'></i> Analytics & Cohorts`],
    ['charts', `<i class='bx bx-pie-chart-alt-2'></i> Statistics & Visual Charts`],
    ['depts_perf', `<i class='bx bx-buildings'></i> Department Matrix`],
    ['feedbacks', `<i class='bx bx-message-square-detail'></i> Feedback Records`],
    ['export', `<i class='bx bx-cloud-download'></i> Export Center`],
    ['depts', `<i class='bx bx-cog'></i> Manage Services`],
    ['audit', `<i class='bx bx-history'></i> Activity Log`]
  ];
  if (adminSession.isAdmin) tabs.push(['users', `<i class='bx bx-user-check'></i> User Management`]);
  if (!adminSession.isAdmin && tab === 'users') tab = 'stats';
  if (adminSession.isAdmin && tab === 'users' && !userManagementLoading && !userManagementLoaded && !userManagementError) {
    loadUserManagement();
  }
  if (tab === 'audit' && !auditLoading && !auditLoaded && !auditError) loadAuditEvents();
  $('app').innerHTML = h + `<div class="tabs">${tabs.map(([k, n]) => `<button class="tab ${tab === k ? 'on' : ''}" onclick="tab='${k}';admin()">${n}</button>`).join('')}</div>${adminError ? `<div class="card" role="alert"><p class="error">${esc(adminError)}</p></div>` : ''}${
    tab === 'stats' ? stats() :
    tab === 'charts' ? chartsUI() :
    tab === 'depts_perf' ? deptsPerfUI() :
    tab === 'feedbacks' ? feedbacksUI() :
    tab === 'export' ? exportUI() :
    tab === 'audit' ? auditUI() :
    tab === 'users' ? userManagementUI() :
    deptUI()
  }</div>`;
}

function userManagementUI() {
  if (userManagementLoading) {
    return `<section class="card user-management-loading" role="status" aria-live="polite">
      <div class="um-loading-header">
        <div class="um-loading-title">
          <span class="um-pulse-dot"></span>
          <h4>Synchronizing User Management</h4>
        </div>
        <span class="um-progress-pct">${userManagementProgressPct}%</span>
      </div>
      <div class="um-progress-bar-wrap" role="progressbar" aria-valuenow="${userManagementProgressPct}" aria-valuemin="0" aria-valuemax="100">
        <div class="um-progress-bar-fill" style="width: ${userManagementProgressPct}%;"></div>
      </div>
      <div class="um-loading-steps">
        <div class="um-loading-step ${userManagementStep > 1 ? 'completed' : userManagementStep === 1 ? 'active' : ''}">
          <div class="um-step-icon">${userManagementStep > 1 ? `<i class='bx bx-check'></i>` : `<i class='bx bx-shield-quarter ${userManagementStep === 1 ? 'bx-spin' : ''}'></i>`}</div>
          <div class="um-step-text">
            <strong>Admin Directory</strong>
            <span>Authorized administrators & supreme access</span>
          </div>
        </div>
        <div class="um-loading-step ${userManagementStep > 2 ? 'completed' : userManagementStep === 2 ? 'active' : ''}">
          <div class="um-step-icon">${userManagementStep > 2 ? `<i class='bx bx-check'></i>` : `<i class='bx bx-user-check ${userManagementStep === 2 ? 'bx-spin' : ''}'></i>`}</div>
          <div class="um-step-text">
            <strong>Active Accounts</strong>
            <span>Verified user roster & approval status</span>
          </div>
        </div>
        <div class="um-loading-step ${userManagementStep >= 3 && userManagementProgressPct >= 95 ? 'completed' : userManagementStep >= 3 ? 'active' : ''}">
          <div class="um-step-icon">${userManagementProgressPct >= 95 ? `<i class='bx bx-check'></i>` : `<i class='bx bx-slider-alt ${userManagementStep >= 3 ? 'bx-spin' : ''}'></i>`}</div>
          <div class="um-step-text">
            <strong>Roles & Permissions</strong>
            <span>Access control matrix & review queue</span>
          </div>
        </div>
      </div>
      <p class="um-status-note"><i class='bx bx-loader-alt bx-spin'></i> ${esc(userManagementStatusText)}</p>
    </section>`;
  }
  if (userManagementError) {
    return `<section class="card" role="alert"><p class="error">${esc(userManagementError)}</p><button class="btn" onclick="loadUserManagement()">Try again</button></section>`;
  }
  const refresh = `<button class="adm-btn" onclick="loadUserManagement()"><i class='bx bx-refresh'></i> Refresh</button>`;
  const approvedUsers = `<section class="card user-management"><div class="user-management-heading"><div><p class="eyebrow">Approved accounts</p><h3>Active users (${activeUsers.length})</h3></div>${refresh}</div>${
    activeUsers.length
      ? `<div class="pending-user-list">${activeUsers.map((user) => `<article class="pending-user"><div class="pending-user-details"><h4>${esc(user.name || 'Unnamed user')}</h4><p>@${esc(user.username || '')}</p></div><span class="user-role status-approved approved"><i class='bx bx-check-circle'></i> Active</span></article>`).join('')}</div>`
      : '<p class="hint">There are no approved users to display.</p>'
  }</section>`;
  const directory = `<section class="card user-management"><div class="user-management-heading"><div><p class="eyebrow">Authorized dashboard users</p><h3>Admin directory</h3></div>${refresh}</div>${
    adminDirectory.length
      ? `<div class="pending-user-list">${adminDirectory.map((user) => `<article class="pending-user"><div class="pending-user-details"><h4>${esc(user.name || 'Unnamed user')}</h4><p>@${esc(user.username || '')}</p></div><span class="user-role ${user.is_supreme_admin ? 'role-supreme' : 'role-admin'}"><i class='bx ${user.is_supreme_admin ? 'bx-crown' : 'bx-shield-quarter'}'></i> ${user.is_supreme_admin ? 'Supreme admin' : 'Admin'}</span></article>`).join('')}</div>`
      : '<p class="hint">There are no administrators to display.</p>'
  }</section>`;
  if (!adminSession.isSupremeAdmin) {
    const accounts = managedUsers.map((user) => `<tr>
      <td><b>${esc(user.name || 'Unnamed user')}</b><br><span class="hint">@${esc(user.username || '')}</span></td>
      <td><span class="user-role status-${esc(user.status)} ${esc(user.status)}">${user.status === 'approved' ? `<i class='bx bx-check-circle'></i> ` : user.status === 'pending' ? `<i class='bx bx-time'></i> ` : user.status === 'deactivated' ? `<i class='bx bx-block'></i> ` : ''}${esc(user.status)}</span></td>
      <td>${user.is_supreme_admin ? 'Supreme admin' : user.is_admin ? 'Admin' : 'User'}</td>
    </tr>`).join('');
    const accountList = `<section class="card user-management"><div class="user-management-heading"><div><p class="eyebrow">Registered accounts</p><h3>All accounts (${managedUsers.length})</h3></div>${refresh}</div>${
      managedUsers.length
        ? `<div class="admin-user-table-wrap"><table class="admin-user-table"><thead><tr><th>Account</th><th>Approval</th><th>Access</th></tr></thead><tbody>${accounts}</tbody></table></div>`
        : '<p class="hint">There are no accounts to display.</p>'
    }</section>`;
    return approvedUsers + directory + accountList;
  }
  const pendingUsers = managedUsers.filter((u) => u.status === 'pending');
  const pendingSection = `<section class="card user-management"><div class="user-management-heading"><div><p class="eyebrow">Review queue</p><h3>Pending review (${pendingUsers.length})</h3></div>${refresh}</div>${
    pendingUsers.length
      ? `<div class="pending-user-list">${pendingUsers.map((user) => {
          const safeId = /^[A-Za-z0-9_-]+$/.test(user.user_id) ? user.user_id : '';
          return `<article class="pending-user"><div class="pending-user-details"><h4>${esc(user.name || 'Unnamed user')}</h4><p>@${esc(user.username || '')}</p></div><div class="user-role-actions">${safeId ? `<button class="adm-btn primary" onclick="reviewUser('${safeId}','approved')"><i class='bx bx-check'></i> Approve</button><button class="adm-btn danger" onclick="reviewUser('${safeId}','rejected')"><i class='bx bx-x'></i> Decline</button>` : ''}</div></article>`;
        }).join('')}</div>`
      : '<p class="hint">There are no pending accounts awaiting review.</p>'
  }</section>`;
  const rows = managedUsers.map((user) => {
    const safeId = /^[A-Za-z0-9_-]+$/.test(user.user_id) ? user.user_id : '';
    const adminAction = `<button class="adm-btn" onclick="setUserRole('${safeId}','admin',${!user.is_admin})">${user.is_admin ? 'Remove admin' : 'Make admin'}</button>`;
    const supremeAction = `<button class="adm-btn" onclick="setUserRole('${safeId}','supreme',${!user.is_supreme_admin})">${user.is_supreme_admin ? 'Remove supreme' : 'Make supreme'}</button>`;
    const statusAction = user.status === 'deactivated'
      ? `<button class="adm-btn primary" onclick="setUserStatus('${safeId}','approved')"><i class='bx bx-check-shield'></i> Reactivate</button>`
      : user.status === 'approved' || user.is_admin
        ? `<button class="adm-btn danger" onclick="setUserStatus('${safeId}','deactivated')"><i class='bx bx-block'></i> Deactivate</button>`
        : '';
    const deleteAction = `<button class="adm-btn danger" onclick="deleteUser('${safeId}','${esc(user.username || user.name || '')}')"><i class='bx bx-trash'></i> Delete</button>`;
    const actions = safeId && user.user_id !== adminSession.user.id
      ? `<div class="user-role-actions">${
          user.status === 'pending'
            ? `<button class="adm-btn primary" onclick="reviewUser('${safeId}','approved')"><i class='bx bx-check'></i> Approve</button><button class="adm-btn danger" onclick="reviewUser('${safeId}','rejected')"><i class='bx bx-x'></i> Decline</button>`
            : ''
        }${user.is_supreme_admin ? supremeAction + adminAction : adminAction + supremeAction}${statusAction}${deleteAction}</div>`
      : '<span class="badge-current-user"><i class=\'bx bx-shield-quarter\'></i> Current account</span>';
    return `<tr><td><b>${esc(user.name || 'Unnamed user')}</b><br><span class="hint">@${esc(user.username || '')}</span></td><td><span class="user-role status-${esc(user.status)} ${esc(user.status)} ${user.status === 'deactivated' ? 'danger' : ''}">${user.status === 'approved' ? `<i class='bx bx-check-circle'></i> ` : user.status === 'pending' ? `<i class='bx bx-time'></i> ` : user.status === 'deactivated' ? `<i class='bx bx-block'></i> ` : ''}${esc(user.status)}</span></td><td>${user.is_supreme_admin ? 'Supreme admin' : user.is_admin ? 'Admin' : 'User'}</td><td>${actions}</td></tr>`;
  }).join('');
  const accounts = `<section class="card user-management"><div class="user-management-heading"><div><p class="eyebrow">Supreme admin controls</p><h3>Accounts & permissions</h3></div>${refresh}</div><p class="hint">Grant dashboard access and manage the supreme-admin role. At least one supreme admin must remain.</p>${
    managedUsers.length
      ? `<div class="admin-user-table-wrap"><table class="admin-user-table"><thead><tr><th>Account</th><th>Approval</th><th>Access</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>`
      : '<p class="hint">There are no accounts to display.</p>'
  }</section>`;
  return pendingSection + approvedUsers + directory + accounts;
}

function auditUI() {
  if (auditLoading) return `<section class="card" role="status"><p>Loading the activity log…</p></section>`;
  if (auditError) {
    return `<section class="card" role="alert"><p class="error">${esc(auditError)}</p><button class="adm-btn" onclick="loadAuditEvents()">Try again</button></section>`;
  }
  const rows = auditEntries.map((event) => {
    const occurredAt = new Date(event.created_at);
    const time = Number.isNaN(occurredAt.getTime()) ? 'Unknown time' : occurredAt.toLocaleString();
    return `<tr>
      <td><time datetime="${esc(event.created_at)}">${esc(time)}</time></td>
      <td>${esc(event.actor || 'Unknown')}</td>
      <td><span class="audit-action">${esc(event.action.replaceAll('.', ' '))}</span></td>
      <td>${esc(event.summary)}</td>
    </tr>`;
  }).join('');
  return `<section class="card audit-card">
    <div class="user-management-heading">
      <div><p class="eyebrow">Application history</p><h3>Activity Log</h3>
        <p class="hint">Latest ${auditEntries.length} recorded events. New activity refreshes automatically while this tab is open.</p>
      </div>
      <button class="adm-btn" onclick="loadAuditEvents()">Refresh</button>
    </div>
    ${auditEntries.length
      ? `<div class="admin-user-table-wrap"><table class="admin-user-table audit-table">
          <thead><tr><th>Time</th><th>Account</th><th>Action</th><th>Details</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>`
      : '<p class="hint">No activity has been recorded yet.</p>'}
  </section>`;
}

async function loadAuditEvents(showLoading = true) {
  if (auditRefreshInProgress) return;
  auditRefreshInProgress = true;
  let auditChanged = false;
  if (showLoading) {
    auditLoading = true;
    auditError = '';
    admin();
  }
  try {
    const updatedEntries = await apiRequest('/api/admin/audit');
    auditChanged = JSON.stringify(auditEntries) !== JSON.stringify(updatedEntries);
    auditEntries = updatedEntries;
    auditLoaded = true;
    auditError = '';
  } catch (error) {
    console.error('Could not load the activity log:', error);
    if (showLoading) auditError = 'The activity log could not be loaded. Please try again.';
  } finally {
    auditRefreshInProgress = false;
    if (showLoading) {
      auditLoading = false;
      admin();
    } else if (tab === 'audit' && auditChanged) {
      admin();
    }
  }
}

let userManagementStep = 1;
let userManagementProgressPct = 25;
let userManagementStatusText = 'Connecting to admin directory…';

async function loadUserManagement() {
  if (!adminSession?.isAdmin) return;
  userManagementLoading = true;
  userManagementError = '';
  userManagementStep = 1;
  userManagementProgressPct = 20;
  userManagementStatusText = 'Connecting to admin directory…';
  admin();
  try {
    const dirPromise = apiRequest('/api/admin/directory').then((res) => {
      userManagementStep = Math.max(userManagementStep, 2);
      userManagementProgressPct = Math.max(userManagementProgressPct, 55);
      userManagementStatusText = 'Fetching active accounts & approval roster…';
      admin();
      return res;
    });

    const activePromise = apiRequest('/api/admin/active-users').then((res) => {
      userManagementStep = Math.max(userManagementStep, 3);
      userManagementProgressPct = Math.max(userManagementProgressPct, 85);
      userManagementStatusText = 'Compiling security roles & permissions matrix…';
      admin();
      return res;
    });

    const usersPromise = adminSession.isAdmin
      ? apiRequest('/api/admin/users').then((res) => {
          userManagementProgressPct = 95;
          userManagementStatusText = 'Finalizing user accounts…';
          return res;
        })
      : Promise.resolve({ users: [] });

    const [directory, approved, users] = await Promise.all([dirPromise, activePromise, usersPromise]);
    adminDirectory = directory.admins || [];
    activeUsers = approved.users || [];
    managedUsers = users?.users || [];
    userManagementProgressPct = 100;
    userManagementStatusText = 'Ready';
    userManagementLoaded = true;
  } catch (error) {
    console.error('Could not load account management data:', error);
    userManagementError = 'Account management data could not be loaded. Check admin access and database setup.';
  } finally {
    userManagementLoading = false;
    admin();
  }
}

async function reviewUser(userId, status) {
  if (status === 'rejected' && !confirm('Decline this account request?')) return;
  userManagementLoading = true;
  userManagementError = '';
  admin();
  try {
    await apiRequest(`/api/admin/users/${encodeURIComponent(userId)}/approval`, 'PATCH', { status });
    userManagementLoaded = false;
    await loadUserManagement();
  } catch (error) {
    console.error('Could not review account request:', error);
    userManagementError = 'The account request could not be updated. Refresh and try again.';
  } finally {
    userManagementLoading = false;
    admin();
  }
}

async function setUserStatus(userId, status) {
  const isDeactivate = status === 'deactivated';
  const confirmMsg = isDeactivate
    ? 'Are you sure you want to deactivate this account? The user will immediately lose access.'
    : 'Reactivate this account and restore access?';
  if (!confirm(confirmMsg)) return;
  userManagementLoading = true;
  userManagementError = '';
  admin();
  try {
    await apiRequest(`/api/admin/users/${encodeURIComponent(userId)}/status`, 'PATCH', { status });
    userManagementLoaded = false;
    await loadUserManagement();
  } catch (error) {
    console.error(`Could not set status to ${status}:`, error);
    userManagementError = error.details?.error === 'last_admin_cannot_be_removed'
      ? 'The last admin cannot be deactivated.'
      : error.details?.error === 'supreme_admin_must_be_demoted_first'
        ? 'Remove the supreme-admin role before deactivating this account.'
        : error.details?.error === 'cannot_deactivate_own_account'
          ? 'You cannot deactivate your own account.'
          : 'The account status could not be updated. Refresh and try again.';
  } finally {
    userManagementLoading = false;
    admin();
  }
}

async function setUserRole(userId, role, enabled) {
  const targetUser = managedUsers.find((u) => u.user_id === userId);
  const action = enabled ? 'grant' : 'remove';
  if (!enabled && !confirm(`Are you sure you want to ${action} this ${role === 'supreme' ? 'supreme-admin' : 'administrator'} role?`)) return;
  userManagementLoading = true;
  userManagementError = '';
  admin();
  try {
    if (role === 'supreme' && enabled && targetUser && !targetUser.is_admin) {
      await apiRequest(`/api/admin/users/${encodeURIComponent(userId)}/admin`, 'PATCH', { enabled: true });
    }
    await apiRequest(`/api/admin/users/${encodeURIComponent(userId)}/${role}`, 'PATCH', { enabled });
    userManagementLoaded = false;
    await loadUserManagement();
  } catch (error) {
    console.error(`Could not ${action} the ${role} role:`, error);
    userManagementError = error.details?.error === 'last_supreme_admin_cannot_be_removed'
      ? 'The last supreme admin cannot be removed.'
      : error.details?.error === 'last_admin_cannot_be_removed'
        ? 'The last admin cannot be removed.'
        : error.details?.error === 'supreme_admin_must_be_demoted_first'
          ? 'Remove the supreme-admin role before removing this admin.'
          : error.details?.error === 'supreme_admin_must_be_an_admin'
            ? 'The account must be an administrator before becoming a supreme admin.'
            : 'The account role could not be updated. Refresh and try again.';
  } finally {
    userManagementLoading = false;
    admin();
  }
}

let pendingDeleteUserId = null;
let pendingDeleteUsername = '';

async function deleteUser(userId, username) {
  const dialog = $('user-delete-dialog');
  if (dialog && typeof dialog.showModal === 'function') {
    pendingDeleteUserId = userId;
    pendingDeleteUsername = username;
    const desc = $('user-delete-description');
    if (desc) desc.textContent = `Are you sure you want to permanently delete the account @${username || userId}? This action cannot be undone.`;
    dialog.showModal();
    return;
  }
  const label = username ? `@${username}` : 'this user';
  if (!confirm(`Are you sure you want to permanently delete the account ${label}? This cannot be undone.`)) return;
  await executeDeleteUser(userId);
}

async function confirmUserDelete() {
  const dialog = $('user-delete-dialog');
  if (dialog && typeof dialog.close === 'function') dialog.close();
  if (pendingDeleteUserId) {
    const id = pendingDeleteUserId;
    pendingDeleteUserId = null;
    await executeDeleteUser(id);
  }
}

function cancelUserDelete() {
  const dialog = $('user-delete-dialog');
  if (dialog && typeof dialog.close === 'function') dialog.close();
  pendingDeleteUserId = null;
}

async function executeDeleteUser(userId) {
  userManagementLoading = true;
  userManagementError = '';
  admin();
  try {
    await apiRequest(`/api/admin/users/${encodeURIComponent(userId)}`, 'DELETE');
    userManagementLoaded = false;
    await loadUserManagement();
  } catch (error) {
    console.error('Could not delete account:', error);
    userManagementError = error.details?.error === 'cannot_delete_own_account'
      ? 'You cannot delete your own account.'
      : error.details?.error === 'last_admin_cannot_be_removed'
        ? 'The last administrator account cannot be deleted.'
        : error.details?.error === 'last_supreme_admin_cannot_be_removed'
          ? 'The last supreme administrator cannot be deleted.'
          : error.details?.error === 'supreme_admin_must_be_demoted_first'
            ? 'Remove the supreme-admin role before deleting this account.'
            : 'The account could not be deleted. Refresh and try again.';
  } finally {
    userManagementLoading = false;
    admin();
  }
}

async function signOutAdmin() {
  if (adminSigningOut) return;
  adminSigningOut = true;
  admin();
  try {
    await apiRequest('/api/auth/sign-out', 'POST', {});
    stopDashboardFeedbackRefresh();
    adminSession = null;
    feedbackResponses = [];
    adminDataLoaded = false;
    adminError = '';
    adminSigningOut = false;
    location.assign('login.html');
  } catch (error) {
    adminSigningOut = false;
    console.error('Admin sign-out failed:', error);
    adminError = 'Sign-out failed. Please try again.';
    admin();
  }
}

function feedbacksUI() {
  const allR = feedbackResponses;
  if (!allR.length) return `<div class="card"><p class="hint">No feedbacks submitted yet. New submissions appear automatically.</p></div>`;

  const dateFiltered = getFilteredResponses();
  let R = cohortFilter === 'new' ? dateFiltered.filter((r) => r.a?.cat === 0) : cohortFilter === 'returning' ? dateFiltered.filter((r) => r.a?.cat === 1) : dateFiltered;

  if (feedbackServiceFilter !== 'all') {
    R = R.filter((r) => r.dn === feedbackServiceFilter);
  }

  if (feedbackRatingFilter === 'sat') {
    R = R.filter((r) => r.a?.q8 != null && (5 - r.a.q8) >= 4);
  } else if (feedbackRatingFilter === 'neu') {
    R = R.filter((r) => r.a?.q8 != null && (5 - r.a.q8) === 3);
  } else if (feedbackRatingFilter === 'diss') {
    R = R.filter((r) => r.a?.q8 != null && (5 - r.a.q8) <= 2);
  }

  if (feedbackSearchQuery.trim()) {
    const q = feedbackSearchQuery.trim().toLowerCase();
    R = R.filter((r) => {
      const matchDept = (r.dn || '').toLowerCase().includes(q);
      const matchQ9 = (r.a?.q9 || '').toLowerCase().includes(q);
      const matchQ10 = (r.a?.q10 || '').toLowerCase().includes(q);
      const matchId = (r.id || '').toLowerCase().includes(q);
      const matchLang = (r.l || '').toLowerCase().includes(q);
      return matchDept || matchQ9 || matchQ10 || matchId || matchLang;
    });
  }

  const totalItems = R.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / FEEDBACK_PAGE_SIZE));
  if (feedbackPage > totalPages) feedbackPage = totalPages;
  if (feedbackPage < 1) feedbackPage = 1;
  const startIndex = (feedbackPage - 1) * FEEDBACK_PAGE_SIZE;
  const pageItems = R.slice().reverse().slice(startIndex, startIndex + FEEDBACK_PAGE_SIZE);

  const uniqueDepts = Array.from(new Set(allR.map((r) => r.dn).filter(Boolean))).sort();
  const deptOptions = `<option value="all"${feedbackServiceFilter === 'all' ? ' selected' : ''}>All Visited Services</option>` +
    uniqueDepts.map((d) => `<option value="${esc(d)}"${feedbackServiceFilter === d ? ' selected' : ''}>${esc(d)}</option>`).join('');

  const startDisplay = totalItems === 0 ? 0 : startIndex + 1;
  const endDisplay = Math.min(totalItems, startIndex + FEEDBACK_PAGE_SIZE);
  const paginationHtml = totalItems > FEEDBACK_PAGE_SIZE ? `
    <div class="fb-pagination">
      <span class="fb-pagination-info">Showing <b>${startDisplay}–${endDisplay}</b> of <b>${totalItems}</b> submissions</span>
      <div class="fb-pagination-btns">
        <button class="pg-btn" ${feedbackPage <= 1 ? 'disabled' : ''} onclick="feedbackPage--;admin()"><i class='bx bx-chevron-left'></i> Prev</button>
        <span style="font-size:12.5px;font-weight:600;padding:0 6px">Page ${feedbackPage} of ${totalPages}</span>
        <button class="pg-btn" ${feedbackPage >= totalPages ? 'disabled' : ''} onclick="feedbackPage++;admin()">Next <i class='bx bx-chevron-right'></i></button>
      </div>
    </div>` : '';

  const dateBarHtml = renderDateFilterBar('Feedback Records');

  const controlsHtml = `
    <div class="fb-controls-bar">
      <div class="fb-search-wrap">
        <i class='bx bx-search'></i>
        <input type="search" placeholder="Search comments, service, or submission ID…" value="${esc(feedbackSearchQuery)}" oninput="feedbackSearchQuery=this.value;feedbackPage=1;admin()">
      </div>
      <select class="fb-select" onchange="feedbackServiceFilter=this.value;feedbackPage=1;admin()" aria-label="Filter by department">
        ${deptOptions}
      </select>
      <div class="fb-chips-row">
        <button class="date-pill ${feedbackRatingFilter === 'all' ? 'active' : ''}" onclick="feedbackRatingFilter='all';feedbackPage=1;admin()">All Ratings</button>
        <button class="date-pill ${feedbackRatingFilter === 'sat' ? 'active' : ''}" onclick="feedbackRatingFilter='sat';feedbackPage=1;admin()">4-5★ Satisfied</button>
        <button class="date-pill ${feedbackRatingFilter === 'neu' ? 'active' : ''}" onclick="feedbackRatingFilter='neu';feedbackPage=1;admin()">3★ Neutral</button>
        <button class="date-pill ${feedbackRatingFilter === 'diss' ? 'active' : ''}" onclick="feedbackRatingFilter='diss';feedbackPage=1;admin()">1-2★ Issues</button>
      </div>
    </div>`;

  const itemsHtml = pageItems.length ? pageItems.map((r, idx) => {
    const timeStr = r.t ? new Date(r.t).toLocaleString() : 'N/A';
    const sScore = r.a?.q8 != null ? 5 - r.a.q8 : null;
    const scoreBadge = sScore != null
      ? `<span class="badge-score ${sScore <= 2 ? 'badge-low' : sScore >= 4 ? 'badge-high' : 'badge-mid'}">${sScore}/5 – ${esc(Q.q8.o[r.a.q8][0])}</span>`
      : '';
    const cat = r.a?.cat === 0 ? 'New Patient' : r.a?.cat === 1 ? 'Returning Patient' : '';
    const catBadge = cat ? `<span class="cohort-badge ${r.a?.cat === 0 ? 'new' : 'ret'}" style="margin-left:6px">${cat}</span>` : '';
    const timeSlot = r.a?.time != null ? Q.time.o[r.a.time]?.[0] : '';
    const delays = (r.a?.q4 || []).map((i) => Q.q4.o[i]?.[0]).filter(Boolean).join(', ');
    const issues = (r.a?.q6 || []).map((i) => Q.q6.o[i]?.[0]).filter(Boolean).join(', ');
    const safeId = adminSession?.isAdmin && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(r.id)
      ? r.id
      : '';
    const globalIdx = totalItems - (startIndex + idx);
    return `<div class="fb-item">
      <div class="fb-meta">
        <span><b>#${globalIdx} • ${esc(r.dn || 'OPD Service')}</b> ${catBadge} ${timeSlot ? `• <small>${esc(timeSlot)}</small>` : ''}</span>
        <span><i class='bx bx-calendar'></i> ${esc(timeStr)} ${safeId ? `<button class="adm-btn danger" onclick="deleteFeedback('${safeId}')">Delete feedback</button>` : ''}</span>
      </div>
      <div style="margin:8px 0">${scoreBadge} <span class="hint" style="margin-left:8px;font-size:12px">Lang: ${esc(r.l || 'en')}</span></div>
      ${delays ? `<div class="hint" style="margin:4px 0"><b>Delays noted:</b> ${esc(delays)}</div>` : ''}
      ${issues ? `<div class="hint" style="margin:4px 0"><b>Unpleasant experience / issues:</b> ${esc(issues)}</div>` : ''}
      ${r.a?.q9 ? `<div class="cm" style="margin-top:6px"><b>Requested additional services:</b> ${esc(r.a.q9)}</div>` : ''}
      ${r.a?.q10 ? `<div class="cm" style="margin-top:6px"><b>Comments / Suggestions:</b> ${esc(r.a.q10)}</div>` : ''}
    </div>`;
  }).join('') : `<div style="text-align:center;padding:32px 16px"><p class="hint">No feedback submissions match your active filter criteria.</p><button class="adm-btn" onclick="feedbackSearchQuery='';feedbackServiceFilter='all';feedbackRatingFilter='all';cohortFilter='all';setDateFilter('all');">Reset all filters</button></div>`;

  return dateBarHtml + `<div class="card">
    <div class="filter-bar">
      <div>
        <h3 style="margin:0">Feedback Submissions (${totalItems} of ${allR.length})</h3>
        <p class="hint" style="margin:2px 0 0">Showing submissions in reverse chronological order. New feedback appears automatically every few seconds.</p>
      </div>
      <div class="filter-pills">
        <button class="filter-pill ${cohortFilter === 'all' ? 'active' : ''}" onclick="cohortFilter='all';feedbackPage=1;admin()">All (${dateFiltered.length})</button>
        <button class="filter-pill ${cohortFilter === 'new' ? 'active' : ''}" onclick="cohortFilter='new';feedbackPage=1;admin()">New (${dateFiltered.filter((r) => r.a?.cat === 0).length})</button>
        <button class="filter-pill ${cohortFilter === 'returning' ? 'active' : ''}" onclick="cohortFilter='returning';feedbackPage=1;admin()">Returning (${dateFiltered.filter((r) => r.a?.cat === 1).length})</button>
      </div>
    </div>
    ${controlsHtml}
    ${itemsHtml}
    ${paginationHtml}
  </div>`;
}

async function deleteFeedback(id) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    adminError = 'The feedback record ID is invalid.';
    admin();
    return;
  }
  const dialog = $('feedback-delete-dialog');
  if (!dialog || typeof dialog.showModal !== 'function') {
    adminError = 'The feedback deletion dialog is unavailable. Reload the page and try again.';
    admin();
    return;
  }
  pendingFeedbackDeleteId = id;
  $('feedback-delete-title').textContent = g(U.feedbackDeleteTitle);
  $('feedback-delete-description').textContent = g(U.feedbackDeleteDescription);
  $('feedback-delete-cancel').textContent = g(U.feedbackDeleteCancel);
  $('feedback-delete-confirm').textContent = g(U.feedbackDeleteConfirm);
  dialog.showModal();
}

function cancelFeedbackDelete() {
  pendingFeedbackDeleteId = null;
  const dialog = $('feedback-delete-dialog');
  if (dialog?.open) dialog.close();
}

async function confirmFeedbackDelete() {
  const id = pendingFeedbackDeleteId;
  if (!id) return;
  pendingFeedbackDeleteId = null;
  const dialog = $('feedback-delete-dialog');
  if (dialog?.open) dialog.close();
  try {
    await apiRequest(`/api/responses/${encodeURIComponent(id)}`, 'DELETE');
    feedbackResponses = feedbackResponses.filter((response) => response.id !== id);
    adminError = '';
    admin();
  } catch (error) {
    console.error('Could not delete feedback:', error);
    adminError = 'The feedback could not be deleted. Refresh and try again.';
    admin();
  }
}

function deptUI() {
  if (!adminSession?.isAdmin) {
    return `<section class="card"><h3>Services</h3>${cfg.depts.map((d) => `<article class="pending-user"><div class="pending-user-details"><h4>${esc(d.n[0])}</h4></div><span class="user-role">${d.active ? 'Active' : 'Inactive'}</span></article>`).join('')}</section>`;
  }
  return `<div class=card><h3>Add visited service</h3><input type=text id=nd placeholder="Service name"><button class=btn onclick="add()"><i class='bx bx-plus'></i> Add</button></div>` +
    cfg.depts.map((d) => `<div class=card><b>${esc(d.n[0])}</b><button class=ghost onclick="setDepartmentActive('${d.id}',${!d.active})">${d.active ? 'Deactivate' : 'Restore'}</button></div>`).join('');
}

async function setDepartmentActive(id, active) {
  if (!active && !confirm('Deactivate this service? It will no longer appear in the survey.')) return;
  adminLoading = true;
  admin();
  try {
    await apiRequest(`/api/admin/departments/${encodeURIComponent(id)}`, 'PATCH', { active });
    await loadAdminData();
  } catch (error) {
    console.error('Could not update the service:', error);
    adminLoading = false;
    adminError = 'The service could not be updated. Please try again.';
    admin();
  }
}

async function add() {
  const n = $('nd').value.trim();
  if (!n) return;
  adminLoading = true;
  admin();
  try {
    await apiRequest('/api/admin/departments', 'POST', { name: n });
    await loadAdminData();
  } catch (error) {
    console.error('Could not add the service:', error);
    adminLoading = false;
    adminError = 'The service could not be added. Please try again.';
    admin();
  }
}

function deptsPerfUI() {
  const allR = feedbackResponses;
  if (!allR.length) return `<div class="card"><p class="hint">No responses yet to calculate department performance.</p></div>`;

  const dateFiltered = getFilteredResponses();
  const dMap = {};
  dateFiltered.forEach((r) => {
    const name = r.dn || 'Unknown';
    if (!dMap[name]) dMap[name] = { total: 0, newP: 0, retP: 0, scores: [], delays: 0, issues: 0 };
    const d = dMap[name];
    d.total += 1;
    if (r.a?.cat === 0) d.newP += 1;
    else if (r.a?.cat === 1) d.retP += 1;
    if (r.a?.q8 != null) d.scores.push(5 - r.a.q8);
    if (r.a?.q4?.length && !r.a.q4.includes(Q.q4.o.length - 1)) d.delays += 1;
    if (r.a?.q6?.length && !r.a.q6.includes(Q.q6.o.length - 1)) d.issues += 1;
  });

  let list = Object.entries(dMap).map(([name, d]) => {
    const avg = d.scores.length ? (d.scores.reduce((a, b) => a + b, 0) / d.scores.length).toFixed(1) : '–';
    const num = d.scores.length ? (d.scores.reduce((a, b) => a + b, 0) / d.scores.length) : 5;
    const satPct = d.scores.length ? Math.round(d.scores.filter((s) => s >= 4).length / d.scores.length * 100) : 0;
    const dissPct = d.scores.length ? Math.round(d.scores.filter((s) => s <= 2).length / d.scores.length * 100) : 0;
    const delayPct = Math.round(d.delays / d.total * 100);
    const issuePct = Math.round(d.issues / d.total * 100);
    return { name, ...d, avg, num, satPct, dissPct, delayPct, issuePct };
  });

  if (deptSearchQuery.trim()) {
    const q = deptSearchQuery.trim().toLowerCase();
    list = list.filter((d) => d.name.toLowerCase().includes(q));
  }

  if (deptIssueFilter === 'delay') {
    list = list.filter((d) => d.delayPct > 20);
  } else if (deptIssueFilter === 'dissatisfied') {
    list = list.filter((d) => d.dissPct > 15);
  } else if (deptIssueFilter === 'top') {
    list = list.filter((d) => d.num >= 4.0);
  }

  list.sort((a, b) => {
    if (deptSortKey === 'avg') return b.num - a.num;
    if (deptSortKey === 'diss') return b.dissPct - a.dissPct;
    if (deptSortKey === 'delay') return b.delayPct - a.delayPct;
    return b.total - a.total;
  });

  const rows = list.length ? list.map((d, i) => {
    const scoreCls = d.num < 3 ? 'badge-low' : d.num >= 4 ? 'badge-high' : 'badge-mid';
    return `<tr>
      <td><b>#${i + 1}</b></td>
      <td><b>${esc(d.name)}</b></td>
      <td><b>${d.total}</b></td>
      <td><span class="cohort-badge new">${d.newP}</span></td>
      <td><span class="cohort-badge ret">${d.retP}</span></td>
      <td><span class="badge-score ${scoreCls}">${d.avg} / 5</span></td>
      <td><span style="color:#03543f;font-weight:600">${d.satPct}%</span></td>
      <td><span style="color:${d.dissPct > 15 ? '#c81e1e' : 'inherit'};font-weight:600">${d.dissPct}%</span></td>
      <td>${d.delayPct > 25 ? `<span style="color:#c81e1e;font-weight:600">${d.delayPct}%</span>` : `${d.delayPct}%`}</td>
      <td>${d.issuePct > 15 ? `<span style="color:#c81e1e;font-weight:600">${d.issuePct}%</span>` : `${d.issuePct}%`}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="10" style="text-align:center;padding:24px"><span class="hint">No services match the active matrix filter.</span></td></tr>`;

  const dateBarHtml = renderDateFilterBar('Department Matrix');

  return dateBarHtml + `<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px">
      <div>
        <h3 style="margin:0"><i class='bx bx-buildings'></i> Department Performance Matrix (${list.length} Services)</h3>
        <p class="hint" style="margin:2px 0 0">Comparative volume, patient cohort splits, satisfaction ratings, and delay incidence.</p>
      </div>
      <button class="adm-btn primary" onclick="exportExcel('departments')"><i class='bx bx-download'></i> Export Matrix XLSX</button>
    </div>
    <div class="fb-controls-bar">
      <div class="dept-search-wrap">
        <i class='bx bx-search'></i>
        <input type="search" placeholder="Search department name…" value="${esc(deptSearchQuery)}" oninput="deptSearchQuery=this.value;admin()">
      </div>
      <div class="filter-pills">
        <button class="filter-pill ${deptIssueFilter === 'all' ? 'active' : ''}" onclick="deptIssueFilter='all';admin()">All Services</button>
        <button class="filter-pill ${deptIssueFilter === 'delay' ? 'active' : ''}" onclick="deptIssueFilter='delay';admin()">High Delay (&gt;20%)</button>
        <button class="filter-pill ${deptIssueFilter === 'dissatisfied' ? 'active' : ''}" onclick="deptIssueFilter='dissatisfied';admin()">Needs Attention (&gt;15% Dissatisfied)</button>
        <button class="filter-pill ${deptIssueFilter === 'top' ? 'active' : ''}" onclick="deptIssueFilter='top';admin()">Top Rated (&ge;4.0★)</button>
      </div>
    </div>
    <div class="dept-table-wrap">
      <table class="dept-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Department / Service</th>
            <th style="cursor:pointer" onclick="deptSortKey='total';admin()">Reviews <i class='bx bx-sort'></i></th>
            <th>New</th>
            <th>Returning</th>
            <th style="cursor:pointer" onclick="deptSortKey='avg';admin()">Avg Score <i class='bx bx-sort'></i></th>
            <th>Satisfied (4-5★)</th>
            <th style="cursor:pointer" onclick="deptSortKey='diss';admin()">Dissatisfied (&le;2★) <i class='bx bx-sort'></i></th>
            <th style="cursor:pointer" onclick="deptSortKey='delay';admin()">Delay Rate <i class='bx bx-sort'></i></th>
            <th>Issue Rate</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
}

function exportUI() {
  const filtered = getFilteredResponses();
  const dateLabel = getDateFilterLabel();
  const dateBarHtml = renderDateFilterBar('Export Center');
  return dateBarHtml + `<div class="card">
    <div class="export-banner">
      <img src="logo-optimized.jpg" alt="DMC" width="760" height="221" decoding="async">
      <div>
        <h3>DMC Hospital — Data Export Center</h3>
        <p>Download executive Excel workbooks with the official DMC logo, brand colors, and active date filters applied (${filtered.length} records • ${esc(dateLabel)}).</p>
      </div>
    </div>
    <div class="export-grid">
      <div class="export-card">
        <div>
          <i class='bx bx-file-blank export-icon'></i>
          <h4>Complete Survey Dataset</h4>
          <p>Export raw patient feedback records including all 18 questionnaire variables, exact timestamps, visited departments, patient cohort, and full comments for ${esc(dateLabel)}.</p>
        </div>
        <div class="report-actions"><button class="btn" onclick="exportExcel('full')"><i class='bx bx-download'></i> Download XLSX (${filtered.length})</button></div>
      </div>
      <div class="export-card">
        <div>
          <i class='bx bx-buildings export-icon'></i>
          <h4>Department Performance Report</h4>
          <p>Aggregated department statistics: review counts, patient split (new vs returning), average satisfaction rating, satisfaction rate, and delay frequency.</p>
        </div>
        <div class="report-actions"><button class="btn" onclick="exportExcel('departments')"><i class='bx bx-download'></i> Download XLSX</button></div>
      </div>
      <div class="export-card">
        <div>
          <i class='bx bx-user-check export-icon'></i>
          <h4>Patient Cohort Summary</h4>
          <p>Comparative analytics and loyalty breakdown comparing First-Time / New Patients versus Returning Patients across satisfaction, delays, and care quality.</p>
        </div>
        <div class="report-actions"><button class="btn" onclick="exportExcel('patients')"><i class='bx bx-download'></i> Download XLSX</button></div>
      </div>
    </div>
  </div>`;
}

function stats() {
  const allR = feedbackResponses;
  const tools = `<div class=card><h3>${adminSession?.isAdmin ? 'Management Tools' : 'Reports'}</h3><div class=tools>${adminSession?.isAdmin ? `<button onclick="seed()"><i class='bx bx-data'></i> Load demo data (60 reviews)</button><button onclick="unseed()"><i class='bx bx-eraser'></i> Remove demo data</button>` : ''}<button class="adm-btn primary" onclick="exportExcel('full')"><i class='bx bx-download'></i> Export Full Dataset XLSX</button>${adminSession?.isAdmin ? '<button onclick="clearResponses()"><i class=\'bx bx-trash\'></i> Clear all</button>' : ''}</div></div>`;
  if (!allR.length) return `<div class="card"><p class="hint">No responses recorded yet.</p></div>` + tools;

  const dateFiltered = getFilteredResponses();
  const dateBarHtml = renderDateFilterBar('Analytics & Cohorts');
  if (!dateFiltered.length) {
    return dateBarHtml + `<div class="card"><p class="hint">No responses recorded for ${esc(getDateFilterLabel())}. Try selecting "All Time" or adjusting the date range.</p></div>` + tools;
  }

  const newCount = dateFiltered.filter((r) => r.a?.cat === 0).length;
  const retCount = dateFiltered.filter((r) => r.a?.cat === 1).length;
  const R = cohortFilter === 'new' ? dateFiltered.filter((r) => r.a?.cat === 0) : cohortFilter === 'returning' ? dateFiltered.filter((r) => r.a?.cat === 1) : dateFiltered;
  const n = R.length;

  // Cohort deep-dive stats
  const cohortCalc = (sub) => {
    const scores = sub.filter((r) => r.a?.q8 != null).map((r) => 5 - r.a.q8);
    const avg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : '–';
    const sat = scores.length ? Math.round(scores.filter((s) => s >= 4).length / scores.length * 100) : 0;
    const diss = scores.length ? Math.round(scores.filter((s) => s <= 2).length / scores.length * 100) : 0;
    const delays = sub.length ? Math.round(sub.filter((r) => r.a?.q4?.length && !r.a.q4.includes(Q.q4.o.length - 1)).length / sub.length * 100) : 0;
    const docGood = sub.length ? Math.round(sub.filter((r) => r.a?.q5 === 0).length / sub.length * 100) : 0;
    return { count: sub.length, avg, sat, diss, delays, docGood };
  };
  const newStats = cohortCalc(dateFiltered.filter((r) => r.a?.cat === 0));
  const retStats = cohortCalc(dateFiltered.filter((r) => r.a?.cat === 1));

  // Current view stats
  const s8 = R.filter((r) => r.a.q8 != null).map((r) => 5 - r.a.q8);
  const avg = s8.length ? (s8.reduce((a, b) => a + b, 0) / s8.length).toFixed(1) : '–';
  const pos = s8.length ? Math.round(s8.filter((x) => x >= 4).length / s8.length * 100) : 0;
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
  const cd = (t, b) => `<div class=card><h3>${t}</h3>${b}</div>`;

  // Donut 1: Satisfaction distribution
  const star5 = R.filter((r) => r.a?.q8 === 0).length;
  const star4 = R.filter((r) => r.a?.q8 === 1).length;
  const star3 = R.filter((r) => r.a?.q8 === 2).length;
  const star2 = R.filter((r) => r.a?.q8 === 3).length;
  const star1 = R.filter((r) => r.a?.q8 === 4).length;
  const donutSatisfaction = renderDonutChart({
    title: `<i class='bx bx-pie-chart-alt-2' style="color:#10b981"></i> Overall Satisfaction Breakdown`,
    subtitle: '5-point star rating distribution from patient reviews',
    items: [
      { label: '5★ Very Satisfied', value: star5, color: '#10b981' },
      { label: '4★ Satisfied', value: star4, color: '#0284c7' },
      { label: '3★ Neutral', value: star3, color: '#f59e0b' },
      { label: '2★ Dissatisfied', value: star2, color: '#ea580c' },
      { label: '1★ Very Dissatisfied', value: star1, color: '#e54b2b' }
    ],
    centerValue: `${pos}%`,
    centerLabel: 'Satisfied'
  });

  // Donut 2: Cohorts
  const donutCohorts = renderDonutChart({
    title: `<i class='bx bx-user-pin' style="color:#0284c7"></i> Patient Cohort Ratio`,
    subtitle: 'First-time vs. returning patient volume split',
    items: [
      { label: 'New / First-Time', value: newCount, color: '#0284c7' },
      { label: 'Returning Patients', value: retCount, color: '#d97706' }
    ],
    centerValue: `${dateFiltered.length}`,
    centerLabel: 'Submissions'
  });

  // Donut 3: Visit times
  const time0 = R.filter((r) => r.a?.time === 0).length;
  const time1 = R.filter((r) => r.a?.time === 1).length;
  const time2 = R.filter((r) => r.a?.time === 2).length;
  const time3 = R.filter((r) => r.a?.time === 3).length;
  const donutTimeOfDay = renderDonutChart({
    title: `<i class='bx bx-time-five' style="color:#8b5cf6"></i> Visit Times Distribution`,
    subtitle: 'Patient arrivals across operating shifts',
    items: [
      { label: 'Morning (8am–12pm)', value: time0, color: '#06b6d4' },
      { label: 'Afternoon (12pm–4pm)', value: time1, color: '#3b82f6' },
      { label: 'Evening (4pm–8pm)', value: time2, color: '#8b5cf6' },
      { label: 'Night / Emergency', value: time3, color: '#64748b' }
    ],
    centerValue: `${n}`,
    centerLabel: 'Visits'
  });

  // Department rankings in current cohort view
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
  }).sort((a, b) => a.num - b.num);

  const rankHtml = rankings.map((d, idx) => {
    const cls = d.num < 3 ? 'badge-low' : d.num >= 4 ? 'badge-high' : 'badge-mid';
    return `<div class="rank-row">
      <span><b>#${idx + 1}</b> ${esc(d.name)} <small style="opacity:.7">(${d.total} reviews)</small></span>
      <span>
        ${d.diss > 0 ? `<small style="color:#c81e1e;margin-right:8px">${d.diss}% dissatisfied</small>` : ''}
        <span class="badge-score ${cls}">${d.score} / 5</span>
      </span>
    </div>`;
  }).join('');

  const filterBarHtml = `<div class="filter-bar">
    <div>
      <h3 style="margin:0"><i class='bx bx-filter-alt'></i> Patient Cohort View</h3>
      <p class="hint" style="margin:2px 0 0">Filter analytics by patient visit category.</p>
    </div>
    <div class="filter-pills">
      <button class="filter-pill ${cohortFilter === 'all' ? 'active' : ''}" onclick="cohortFilter='all';admin()">All Patients (${dateFiltered.length})</button>
      <button class="filter-pill ${cohortFilter === 'new' ? 'active' : ''}" onclick="cohortFilter='new';admin()">New Patients (${newCount})</button>
      <button class="filter-pill ${cohortFilter === 'returning' ? 'active' : ''}" onclick="cohortFilter='returning';admin()">Returning (${retCount})</button>
    </div>
  </div>`;

  const cohortCardHtml = `<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <h3 style="margin:0"><i class='bx bx-user-pin'></i> Cohort Performance: New vs. Returning Patients</h3>
      <span class="hint" style="margin:0">Submissions in range: ${dateFiltered.length}</span>
    </div>
    <div class="cohort-grid">
      <div class="cohort-card">
        <div class="cohort-header">
          <h4><i class='bx bx-user-plus' style="color:#0369a1"></i> New Patients</h4>
          <span class="cohort-badge new">${newStats.count} visits (${dateFiltered.length ? Math.round(newStats.count / dateFiltered.length * 100) : 0}%)</span>
        </div>
        <div class="cohort-metrics">
          <div class="cohort-metric"><span>Avg Score</span><b>${newStats.avg}/5</b></div>
          <div class="cohort-metric"><span>Satisfied</span><b>${newStats.sat}%</b></div>
          <div class="cohort-metric"><span>Delay Rate</span><b>${newStats.delays}%</b></div>
          <div class="cohort-metric"><span>Doctor Care</span><b>${newStats.docGood}%</b></div>
        </div>
      </div>
      <div class="cohort-card">
        <div class="cohort-header">
          <h4><i class='bx bx-user-check' style="color:#92400e"></i> Returning Patients</h4>
          <span class="cohort-badge ret">${retStats.count} visits (${dateFiltered.length ? Math.round(retStats.count / dateFiltered.length * 100) : 0}%)</span>
        </div>
        <div class="cohort-metrics">
          <div class="cohort-metric"><span>Avg Score</span><b>${retStats.avg}/5</b></div>
          <div class="cohort-metric"><span>Satisfied</span><b>${retStats.sat}%</b></div>
          <div class="cohort-metric"><span>Delay Rate</span><b>${retStats.delays}%</b></div>
          <div class="cohort-metric"><span>Doctor Care</span><b>${retStats.docGood}%</b></div>
        </div>
      </div>
    </div>
  </div>`;

  // Visual Bar data formatting
  const deptBars = tl((r) => r.dn).slice(0, 10).map(([k, v]) => [k, v, '#17263c']);
  const waitTimes = q('q3').map(([k, v]) => [k, v, k.toLowerCase().includes('less') || k.includes('15') ? '#10b981' : k.includes('30') ? '#0284c7' : k.includes('60') ? '#f59e0b' : '#e54b2b']);
  const delayHotspots = q('q4', 1).map(([k, v]) => [k, v, '#e54b2b']);
  const issueHotspots = q('q6', 1).map(([k, v]) => [k, v, '#ea580c']);
  const qualityScores = [['Reception Staff Care', good('q1'), '#059669'], ['Cashier & Billing Experience', good('q2'), '#0284c7'], ['Hospital Cleanliness Rating', good('q7'), '#10b981']];
  const doctorCare = q('q5').map(([k, v]) => [k, v, k.toLowerCase().startsWith('yes') ? '#10b981' : k.toLowerCase().startsWith('part') ? '#f59e0b' : '#e54b2b']);

  const cm = R.flatMap((r) => [r.a?.q10, r.a?.q9]).filter((x) => x && x.trim()).slice(-8).reverse();

  return dateBarHtml +
    filterBarHtml +
    `<div class=kpis>
      <div class=kpi><b>${n}</b>${cohortFilter === 'new' ? 'New Patient' : cohortFilter === 'returning' ? 'Returning' : 'Total'} Responses</div>
      <div class=kpi><b>${avg}/5</b>Avg Satisfaction</div>
      <div class=kpi><b>${pos}%</b>Satisfied (4–5★)</div>
      <div class=kpi><b>${neg}%</b>Dissatisfied (≤2★)</div>
    </div>` +
    `<div class="donut-charts-grid">
      ${donutSatisfaction}
      ${donutCohorts}
      ${donutTimeOfDay}
    </div>` +
    cohortCardHtml +
    cd("<i class='bx bx-trending-down' style='color:#c81e1e'></i> Service Satisfaction Ranking (Lowest / Needs Attention First)", `<p class="hint" style="margin-bottom:8px">Sorted from lowest satisfaction rating to highest in active view.</p>` + (rankHtml || '–')) +
    cd('Responses by Visited Service', renderVisualBars(deptBars, deptBars[0]?.[1] || 1, ' reviews')) +
    cd('Wait Time Before Seeing Doctor', renderVisualBars(waitTimes, n)) +
    cd('Where Delays Occurred (Delay Hotspots)', renderVisualBars(delayHotspots, n)) +
    cd('Where Unpleasant Experience Was Reported', renderVisualBars(issueHotspots, n)) +
    cd('Cleanliness & Reception Quality (Rated Excellent/Good)', renderVisualBars(qualityScores, 100, '%')) +
    cd('Doctor Care & Attentiveness (Listened Carefully)', renderVisualBars(doctorCare, n)) +
    cd('Languages Used', bars(tl((r) => r.l, (v) => ({ en: 'English', fr: 'Français', rw: 'Kinyarwanda' }[v])))) +
    cd('Recent Comments & Improvement Suggestions', cm.map((x) => `<div class=cm>${esc(x)}</div>`).join('') || '–') +
    tools;
}

async function seed() {
  adminLoading = true;
  admin();
  try {
    await apiRequest('/api/admin/demo', 'POST', {});
    await loadAdminData();
  } catch (error) {
    console.error('Could not add demo feedback:', error);
    adminLoading = false;
    adminError = 'Demo feedback could not be added. Please try again.';
    admin();
  }
}

async function unseed() {
  adminLoading = true;
  admin();
  try {
    await apiRequest('/api/admin/demo', 'DELETE');
    await loadAdminData();
  } catch (error) {
    console.error('Could not remove demo feedback:', error);
    adminLoading = false;
    adminError = 'Demo feedback could not be removed. Please try again.';
    admin();
  }
}

async function clearResponses() {
  if (!confirm('Delete ALL responses? This cannot be undone.')) return;
  adminLoading = true;
  admin();
  try {
    await apiRequest('/api/responses', 'DELETE');
    await loadAdminData();
  } catch (error) {
    console.error('Could not clear feedback:', error);
    adminLoading = false;
    adminError = 'Feedback could not be cleared. Please try again.';
    admin();
  }
}

function buildReportData(type, R, dateStr) {
  let headers = [];
  let rows = [];
  let title = 'DMC Hospital — Patient Feedback';
  let filename = `DMC-Patient-Feedback-${type}-${dateStr}.xlsx`;

  if (type === 'full') {
    title = 'DMC Hospital — Complete Survey Dataset';
    const fullHeaders = [
      'Submission ID',
      'Timestamp (ISO)',
      'Date & Time',
      'Language',
      'Department / Visited Service',
      'Patient Category',
      'Visit Time',
      '1. Reception Experience',
      '2. Cashier Experience',
      '3. Doctor Wait Time',
      '4. Delay Locations',
      '5. Doctor Listened Carefully',
      '6. Unpleasant Experience Locations',
      '7. Cleanliness Rating',
      '8. Overall Satisfaction',
      '8. Score (1-5)',
      '9. Additional Services Requested',
      '10. Suggestions & Comments'
    ];
    headers = fullHeaders;
    rows = R.map((r) => {
      const sScore = r.a?.q8 != null ? 5 - r.a.q8 : '';
      const cat = r.a?.cat === 0 ? 'New Patient' : r.a?.cat === 1 ? 'Returning Patient' : '';
      const timeSlot = r.a?.time != null ? Q.time.o[r.a.time]?.[0] || '' : '';
      const q1 = r.a?.q1 != null ? Q.q1.o[r.a.q1]?.[0] || '' : '';
      const q2 = r.a?.q2 != null ? Q.q2.o[r.a.q2]?.[0] || '' : '';
      const q3 = r.a?.q3 != null ? Q.q3.o[r.a.q3]?.[0] || '' : '';
      const q4 = (r.a?.q4 || []).map((x) => Q.q4.o[x]?.[0]).filter(Boolean).join('; ');
      const q5 = r.a?.q5 != null ? Q.q5.o[r.a.q5]?.[0] || '' : '';
      const q6 = (r.a?.q6 || []).map((x) => Q.q6.o[x]?.[0]).filter(Boolean).join('; ');
      const q7 = r.a?.q7 != null ? Q.q7.o[r.a.q7]?.[0] || '' : '';
      const q8 = r.a?.q8 != null ? Q.q8.o[r.a.q8]?.[0] || '' : '';
      const q9 = (r.a?.q9 || '').replace(/\r?\n/g, ' ');
      const q10 = (r.a?.q10 || '').replace(/\r?\n/g, ' ');
      return [
        r.id || '',
        new Date(r.t).toISOString(),
        new Date(r.t).toLocaleString(),
        r.l || 'en',
        r.dn || '',
        cat,
        timeSlot,
        q1,
        q2,
        q3,
        q4,
        q5,
        q6,
        q7,
        q8,
        sScore,
        q9,
        q10
      ];
    });
  } else if (type === 'departments') {
    title = 'DMC Hospital — Department Performance';
    filename = `DMC-Department-Performance-${dateStr}.xlsx`;
    headers = [
      'Department / Service',
      'Total Reviews',
      'New Patients',
      'Returning Patients',
      'Average Score (1-5)',
      'Satisfied Reviews (4-5 Star)',
      'Satisfaction Rate (%)',
      'Dissatisfied Reviews (1-2 Star)',
      'Dissatisfaction Rate (%)',
      'Delays Reported Count',
      'Delay Incidence (%)',
      'Unpleasant Experience Count',
      'Issue Incidence (%)'
    ];
    const dMap = {};
    R.forEach((r) => {
      const name = r.dn || 'Unknown';
      if (!dMap[name]) dMap[name] = { total: 0, newP: 0, retP: 0, scores: [], delays: 0, issues: 0 };
      const d = dMap[name];
      d.total += 1;
      if (r.a?.cat === 0) d.newP += 1;
      else if (r.a?.cat === 1) d.retP += 1;
      if (r.a?.q8 != null) d.scores.push(5 - r.a.q8);
      if (r.a?.q4?.length && !r.a.q4.includes(Q.q4.o.length - 1)) d.delays += 1;
      if (r.a?.q6?.length && !r.a.q6.includes(Q.q6.o.length - 1)) d.issues += 1;
    });
    rows = Object.entries(dMap).map(([name, d]) => {
      const avg = d.scores.length ? (d.scores.reduce((a, b) => a + b, 0) / d.scores.length).toFixed(2) : 'N/A';
      const satCount = d.scores.filter((s) => s >= 4).length;
      const satPct = d.scores.length ? Math.round((satCount / d.scores.length) * 100) + '%' : 'N/A';
      const disCount = d.scores.filter((s) => s <= 2).length;
      const disPct = d.scores.length ? Math.round((disCount / d.scores.length) * 100) + '%' : 'N/A';
      const delayPct = Math.round((d.delays / d.total) * 100) + '%';
      const issuePct = Math.round((d.issues / d.total) * 100) + '%';
      return [
        name,
        d.total,
        d.newP,
        d.retP,
        avg,
        satCount,
        satPct,
        disCount,
        disPct,
        d.delays,
        delayPct,
        d.issues,
        issuePct
      ];
    }).sort((a, b) => b[1] - a[1]);
  } else if (type === 'patients') {
    title = 'DMC Hospital — Patient Cohort Analytics';
    filename = `DMC-Patient-Cohort-Analytics-${dateStr}.xlsx`;
    headers = [
      'Patient Cohort',
      'Total Reviews',
      'Share of Patient Population (%)',
      'Average Score (1-5)',
      'Satisfied Count (4-5 Star)',
      'Satisfaction Rate (%)',
      'Dissatisfied Count (1-2 Star)',
      'Dissatisfaction Rate (%)',
      'Patients Experiencing Delay (%)',
      'Patients Reporting Attitude Issue (%)'
    ];
    const cohorts = [
      { name: 'New Patients (First-Time)', filter: (r) => r.a?.cat === 0 },
      { name: 'Returning Patients', filter: (r) => r.a?.cat === 1 }
    ];
    rows = cohorts.map(({ name, filter }) => {
      const sub = R.filter(filter);
      const scores = sub.filter((r) => r.a?.q8 != null).map((r) => 5 - r.a.q8);
      const avg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2) : 'N/A';
      const sat = scores.filter((s) => s >= 4).length;
      const satRate = scores.length ? Math.round((sat / scores.length) * 100) + '%' : 'N/A';
      const dis = scores.filter((s) => s <= 2).length;
      const disRate = scores.length ? Math.round((dis / scores.length) * 100) + '%' : 'N/A';
      const delayCount = sub.filter((r) => r.a?.q4?.length && !r.a.q4.includes(Q.q4.o.length - 1)).length;
      const delayRate = sub.length ? Math.round((delayCount / sub.length) * 100) + '%' : 'N/A';
      const issueCount = sub.filter((r) => r.a?.q6?.length && !r.a.q6.includes(Q.q6.o.length - 1)).length;
      const issueRate = sub.length ? Math.round((issueCount / sub.length) * 100) + '%' : 'N/A';
      return [
        name,
        sub.length,
        Math.round((sub.length / R.length) * 100) + '%',
        avg,
        sat,
        satRate,
        dis,
        disRate,
        delayRate,
        issueRate
      ];
    });
  }

  return {
    headers,
    rows,
    title,
    filename,
    subtitle: `Confidential quality-improvement report | Generated ${dateStr} | ${R.length} feedback submissions`
  };
}

function getReportData(type) {
  if (!['full', 'departments', 'patients'].includes(type)) {
    alert('The selected report is not supported.');
    return null;
  }
  const filtered = getFilteredResponses();
  if (!filtered.length) {
    alert(`No feedback records available to export for ${getDateFilterLabel()}.`);
    return null;
  }
  const dateStr = new Date().toISOString().slice(0, 10);
  const filterLabel = getDateFilterLabel();
  const report = buildReportData(type, filtered, dateStr);
  report.subtitle = `Confidential quality-improvement report | Filter: ${filterLabel} | Generated ${dateStr} | ${filtered.length} feedback submissions`;
  return report;
}

async function recordReportExport(type, format) {
  try {
    await apiRequest('/api/admin/audit', 'POST', { type, format });
  } catch (error) {
    console.error('Could not record the report export:', error);
    adminError = 'The report was downloaded, but its export could not be recorded in the activity log.';
    admin();
  }
}

async function exportExcel(type = 'full') {
  const report = getReportData(type);
  if (!report) return;
  try {
    const logoResponse = await fetch(new URL('logo-optimized.jpg', document.baseURI));
    if (!logoResponse.ok) throw new Error(`Could not load the DMC logo (${logoResponse.status}).`);
    await DMCExcelExport.downloadWorkbook({
      ...report,
      logoBytes: new Uint8Array(await logoResponse.arrayBuffer())
    });
    await recordReportExport(type, 'xlsx');
  } catch (error) {
    console.error('Could not create Excel export:', error);
    alert('The Excel workbook could not be created. Check your connection and try again.');
  }
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
  hideSplash(() => renderIntro());
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
}

/* ---------- Boot ---------- */
async function boot() {
  const adm = location.hash === '#admin', s = $('splash');
  if (welcomeTimer) {
    clearTimeout(welcomeTimer);
    welcomeTimer = null;
  }
  splashAnimTimers.forEach(clearTimeout);
  splashAnimTimers = [];

  if (adm) {
    if (s) s.remove();
    adminLoading = true;
    admin();
    await initializeAdmin();
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

function startApp() {
  boot().catch((error) => {
    console.error('Could not start the app:', error);
    const app = $('app');
    if (app) app.innerHTML = `<main class="card" role="alert"><p class="error">The app could not start. Check the server connection and try again.</p></main>`;
  });
}

addEventListener('hashchange', () => {
  if (location.hash !== '#admin') stopDashboardFeedbackRefresh();
  startApp();
});
addEventListener('focus', refreshDashboardFeedback);
addEventListener('dmc-auth-state-change', (event) => {
if (event.detail.event === 'SIGNED_OUT') {
  adminSession = null;
  stopDashboardFeedbackRefresh();
  feedbackResponses = [];
  adminDataLoaded = false;
  if (location.hash === '#admin') location.assign('login.html');
}
});
startApp();

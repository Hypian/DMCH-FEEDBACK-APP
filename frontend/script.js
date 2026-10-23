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
    'Your feedback is important to us and will help improve our services. Please complete this short survey. Responses are confidential; if you are signed in, your response is linked to your account, otherwise it is anonymous.',
    'Votre avis nous aidera à améliorer nos services. Merci de répondre à ce court questionnaire. Les réponses sont confidentielles ; si vous êtes connecté(e), votre réponse sera associée à votre compte ; sinon, elle restera anonyme.',
    'Ibitekerezo byanyu bizadufasha kunoza serivisi zacu. Turabasaba kuzuza aka kabazo gato. Ibitekerezo bibikwa mu ibanga; niba winjiye muri konti, igitekerezo cyawe gihuzwa na konti yawe, bitabaye ibyo kikaguma kitagaragaza umwirondoro.'
  ],
  startSurvey: ['Start survey', 'Commencer le questionnaire', 'Tangira ibibazo'],
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
    q: T3("9. What additional services would you like Dream Medical Center to offer?~9. Quels services supplémentaires souhaiteriez-vous que Dream Medical Center propose?~9. Ni izihe serivisi z'inyongera wifuza ko ibitaro bya Dream Medical Center (DMC) byatanga?")
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
    adminSession = await apiRequest('/api/admin/session');
    await loadAdminData();
  } catch (error) {
    console.error('Could not initialize the admin dashboard:', error);
    adminLoading = false;
    if (error.status === 401) {
      location.assign(`login.html?next=${encodeURIComponent('index.html#admin')}`);
      return;
    }
    adminError = error.status === 403
      ? 'This account is not authorized to access the admin dashboard.'
      : 'Admin access could not be verified. Check server setup and account permissions.';
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
      ${adminSession ? `<span class="admin-user-name">${esc(adminSession.user.name || adminSession.user.username || '')}</span><button class="adm-btn" onclick="signOutAdmin()"><i class='bx bx-log-out'></i> Sign out</button><button class="adm-btn primary" onclick="exportCSV('full')"><i class='bx bx-download'></i> Quick Export CSV</button>` : ''}
    </div>
  </div>`;
  if (!adminSession) {
    $('app').innerHTML = h + `<div class="card" style="max-width:400px;margin:30px auto;text-align:center"><h3>Admin Sign-in</h3><p class="hint">${esc(adminError || 'Sign in with your authorized account to access the dashboard.')}</p><a class="btn" href="login.html?next=${encodeURIComponent('index.html#admin')}">Sign in</a></div></div>`;
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
    ['depts_perf', `<i class='bx bx-buildings'></i> Department Matrix`],
    ['feedbacks', `<i class='bx bx-message-square-detail'></i> Feedback Records`],
    ['export', `<i class='bx bx-cloud-download'></i> Export Center`],
    ['depts', `<i class='bx bx-cog'></i> Manage Services`],
    ['audit', `<i class='bx bx-history'></i> Activity Log`]
  ];
  tabs.push(['users', `<i class='bx bx-user-check'></i> User Management`]);
  if (tab === 'users' && !userManagementLoading && !userManagementLoaded && !userManagementError) {
    loadUserManagement();
  }
  if (tab === 'audit' && !auditLoading && !auditLoaded && !auditError) loadAuditEvents();
  $('app').innerHTML = h + `<div class="tabs">${tabs.map(([k, n]) => `<button class="tab ${tab === k ? 'on' : ''}" onclick="tab='${k}';admin()">${n}</button>`).join('')}</div>${adminError ? `<div class="card" role="alert"><p class="error">${esc(adminError)}</p></div>` : ''}${
    tab === 'stats' ? stats() :
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
    return `<section class="card" role="status"><p>Loading account management…</p></section>`;
  }
  if (userManagementError) {
    return `<section class="card" role="alert"><p class="error">${esc(userManagementError)}</p><button class="btn" onclick="loadUserManagement()">Try again</button></section>`;
  }
  const refresh = `<button class="adm-btn" onclick="loadUserManagement()">Refresh</button>`;
  const approvedUsers = `<section class="card user-management"><div class="user-management-heading"><div><p class="eyebrow">Approved accounts</p><h3>Active users (${activeUsers.length})</h3></div>${refresh}</div>${
    activeUsers.length
      ? `<div class="pending-user-list">${activeUsers.map((user) => `<article class="pending-user"><div class="pending-user-details"><h4>${esc(user.name || 'Unnamed user')}</h4><p>@${esc(user.username || '')}</p></div><span class="user-role">Active</span></article>`).join('')}</div>`
      : '<p class="hint">There are no approved users to display.</p>'
  }</section>`;
  const directory = `<section class="card user-management"><div class="user-management-heading"><div><p class="eyebrow">Authorized dashboard users</p><h3>Admin directory</h3></div>${refresh}</div>${
    adminDirectory.length
      ? `<div class="pending-user-list">${adminDirectory.map((user) => `<article class="pending-user"><div class="pending-user-details"><h4>${esc(user.name || 'Unnamed user')}</h4><p>@${esc(user.username || '')}</p></div><span class="user-role">${user.is_supreme_admin ? 'Supreme admin' : 'Admin'}</span></article>`).join('')}</div>`
      : '<p class="hint">There are no administrators to display.</p>'
  }</section>`;
  if (!adminSession.isSupremeAdmin) return approvedUsers + directory;
  const rows = managedUsers.map((user) => {
    const safeId = /^[A-Za-z0-9_-]+$/.test(user.user_id) ? user.user_id : '';
    const adminAction = `<button class="adm-btn" onclick="setUserRole('${safeId}','admin',${!user.is_admin})">${user.is_admin ? 'Remove admin' : 'Make admin'}</button>`;
    const supremeAction = user.is_admin
      ? `<button class="adm-btn" onclick="setUserRole('${safeId}','supreme',${!user.is_supreme_admin})">${user.is_supreme_admin ? 'Remove supreme' : 'Make supreme'}</button>`
      : '';
    const actions = safeId && user.user_id !== adminSession.user.id
      ? `<div class="user-role-actions">${
          user.status === 'pending'
            ? `<button class="adm-btn primary" onclick="reviewUser('${safeId}','approved')">Approve</button><button class="adm-btn danger" onclick="reviewUser('${safeId}','rejected')">Decline</button>`
            : ''
        }${user.is_supreme_admin ? supremeAction + adminAction : adminAction + supremeAction}</div>`
      : '<span class="hint">Current account</span>';
    return `<tr><td><b>${esc(user.name || 'Unnamed user')}</b><br><span class="hint">@${esc(user.username || '')}</span></td><td><span class="user-role">${esc(user.status)}</span></td><td>${user.is_supreme_admin ? 'Supreme admin' : user.is_admin ? 'Admin' : 'User'}</td><td>${actions}</td></tr>`;
  }).join('');
  const accounts = `<section class="card user-management"><div class="user-management-heading"><div><p class="eyebrow">Supreme admin controls</p><h3>Accounts & permissions</h3></div>${refresh}</div><p class="hint">Grant dashboard access and manage the supreme-admin role. At least one supreme admin must remain.</p>${
    managedUsers.length
      ? `<div class="admin-user-table-wrap"><table class="admin-user-table"><thead><tr><th>Account</th><th>Approval</th><th>Access</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>`
      : '<p class="hint">There are no accounts to display.</p>'
  }</section>`;
  return approvedUsers + directory + accounts;
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

async function loadUserManagement() {
  userManagementLoading = true;
  userManagementError = '';
  admin();
  try {
    const requests = [
      apiRequest('/api/admin/directory'),
      apiRequest('/api/admin/active-users')
    ];
    if (adminSession.isSupremeAdmin) {
      requests.push(apiRequest('/api/admin/users'));
    }
    const [directory, approved, users] = await Promise.all(requests);
    adminDirectory = directory.admins;
    activeUsers = approved.users;
    managedUsers = users?.users || [];
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

async function setUserRole(userId, role, enabled) {
  const action = enabled ? 'grant' : 'remove';
  if (!enabled && !confirm(`Are you sure you want to ${action} this ${role === 'supreme' ? 'supreme-admin' : 'administrator'} role?`)) return;
  userManagementLoading = true;
  userManagementError = '';
  admin();
  try {
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
          : 'The account role could not be updated. Refresh and try again.';
  } finally {
    userManagementLoading = false;
    admin();
  }
}

async function signOutAdmin() {
  try {
    await apiRequest('/api/auth/sign-out', 'POST', {});
    stopDashboardFeedbackRefresh();
    adminSession = null;
    feedbackResponses = [];
    adminDataLoaded = false;
    adminError = '';
    location.assign('login.html');
  } catch (error) {
    console.error('Admin sign-out failed:', error);
    adminError = 'Sign-out failed. Please try again.';
    admin();
  }
}

function feedbacksUI() {
  const allR = feedbackResponses;
  if (!allR.length) return `<div class="card"><p class="hint">No feedbacks submitted yet. New submissions appear automatically.</p></div>`;
  const R = cohortFilter === 'new' ? allR.filter((r) => r.a?.cat === 0) : cohortFilter === 'returning' ? allR.filter((r) => r.a?.cat === 1) : allR;
  return `<div class="card">
    <div class="filter-bar">
      <div>
        <h3 style="margin:0">Feedback Submissions (${R.length} of ${allR.length})</h3>
        <p class="hint" style="margin:2px 0 0">Showing submissions in reverse chronological order. New feedback appears automatically every few seconds.</p>
      </div>
      <div class="filter-pills">
        <button class="filter-pill ${cohortFilter === 'all' ? 'active' : ''}" onclick="cohortFilter='all';admin()">All (${allR.length})</button>
        <button class="filter-pill ${cohortFilter === 'new' ? 'active' : ''}" onclick="cohortFilter='new';admin()">New (${allR.filter((r) => r.a?.cat === 0).length})</button>
        <button class="filter-pill ${cohortFilter === 'returning' ? 'active' : ''}" onclick="cohortFilter='returning';admin()">Returning (${allR.filter((r) => r.a?.cat === 1).length})</button>
      </div>
    </div>` +
    R.slice().reverse().map((r, idx) => {
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
      const safeId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(r.id)
        ? r.id
        : '';
      return `<div class="fb-item">
        <div class="fb-meta">
          <span><b>#${R.length - idx} • ${esc(r.dn || 'OPD Service')}</b> ${catBadge} ${timeSlot ? `• <small>${esc(timeSlot)}</small>` : ''}</span>
          <span><i class='bx bx-calendar'></i> ${esc(timeStr)} ${safeId ? `<button class="adm-btn danger" onclick="deleteFeedback('${safeId}')">Delete feedback</button>` : ''}</span>
        </div>
        <div style="margin:8px 0">${scoreBadge} <span class="hint" style="margin-left:8px;font-size:12px">Lang: ${esc(r.l || 'en')}</span></div>
        ${delays ? `<div class="hint" style="margin:4px 0"><b>Delays noted:</b> ${esc(delays)}</div>` : ''}
        ${issues ? `<div class="hint" style="margin:4px 0"><b>Unpleasant experience / issues:</b> ${esc(issues)}</div>` : ''}
        ${r.a?.q9 ? `<div class="cm" style="margin-top:6px"><b>Requested additional services:</b> ${esc(r.a.q9)}</div>` : ''}
        ${r.a?.q10 ? `<div class="cm" style="margin-top:6px"><b>Comments / Suggestions:</b> ${esc(r.a.q10)}</div>` : ''}
      </div>`;
    }).join('') + `</div>`;
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

  const dMap = {};
  allR.forEach((r) => {
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

  const list = Object.entries(dMap).map(([name, d]) => {
    const avg = d.scores.length ? (d.scores.reduce((a, b) => a + b, 0) / d.scores.length).toFixed(1) : '–';
    const num = d.scores.length ? (d.scores.reduce((a, b) => a + b, 0) / d.scores.length) : 5;
    const satPct = d.scores.length ? Math.round(d.scores.filter((s) => s >= 4).length / d.scores.length * 100) : 0;
    const dissPct = d.scores.length ? Math.round(d.scores.filter((s) => s <= 2).length / d.scores.length * 100) : 0;
    const delayPct = Math.round(d.delays / d.total * 100);
    const issuePct = Math.round(d.issues / d.total * 100);
    return { name, ...d, avg, num, satPct, dissPct, delayPct, issuePct };
  }).sort((a, b) => b.total - a.total);

  const rows = list.map((d, i) => {
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
  }).join('');

  return `<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px">
      <div>
        <h3 style="margin:0"><i class='bx bx-buildings'></i> Department Performance Matrix (${list.length} Services)</h3>
        <p class="hint" style="margin:2px 0 0">Comparative volume, patient cohort splits, satisfaction ratings, and delay incidence.</p>
      </div>
      <button class="adm-btn primary" onclick="exportCSV('departments')"><i class='bx bx-download'></i> Export Matrix CSV</button>
    </div>
    <div class="dept-table-wrap">
      <table class="dept-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Department / Service</th>
            <th>Reviews</th>
            <th>New</th>
            <th>Returning</th>
            <th>Avg Score</th>
            <th>Satisfied (4-5★)</th>
            <th>Dissatisfied (≤2★)</th>
            <th>Delay Rate</th>
            <th>Issue Rate</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
}

function exportUI() {
  const allR = feedbackResponses;
  return `<div class="card">
    <div class="export-banner">
      <img src="logo-optimized.jpg" alt="DMC" width="760" height="221" decoding="async">
      <div>
        <h3>DMC Hospital — Data Export Center</h3>
        <p>Download CSV files for each report.</p>
      </div>
    </div>
    <div class="export-grid">
      <div class="export-card">
        <div>
          <i class='bx bx-file-blank export-icon'></i>
          <h4>Complete Survey Dataset</h4>
          <p>Export raw patient feedback records including all 18 questionnaire variables, exact timestamps, visited departments, patient cohort, and full comments.</p>
        </div>
        <div class="report-actions"><button class="btn" onclick="exportCSV('full')"><i class='bx bx-download'></i> CSV (${allR.length})</button></div>
      </div>
      <div class="export-card">
        <div>
          <i class='bx bx-buildings export-icon'></i>
          <h4>Department Performance Report</h4>
          <p>Aggregated department statistics: review counts, patient split (new vs returning), average satisfaction rating, satisfaction rate, and delay frequency.</p>
        </div>
        <div class="report-actions"><button class="btn" onclick="exportCSV('departments')"><i class='bx bx-download'></i> CSV</button></div>
      </div>
      <div class="export-card">
        <div>
          <i class='bx bx-user-check export-icon'></i>
          <h4>Patient Cohort Summary</h4>
          <p>Comparative analytics and loyalty breakdown comparing First-Time / New Patients versus Returning Patients across satisfaction, delays, and care quality.</p>
        </div>
        <div class="report-actions"><button class="btn" onclick="exportCSV('patients')"><i class='bx bx-download'></i> CSV</button></div>
      </div>
    </div>
  </div>`;
}

function stats() {
  const allR = feedbackResponses;
  const tools = `<div class=card><h3>Management Tools</h3><div class=tools><button onclick="seed()"><i class='bx bx-data'></i> Load demo data (60 reviews)</button><button onclick="unseed()"><i class='bx bx-eraser'></i> Remove demo data</button><button class="adm-btn primary" onclick="exportCSV('full')"><i class='bx bx-download'></i> Export Full Dataset CSV</button><button onclick="clearResponses()"><i class='bx bx-trash'></i> Clear all</button></div></div>`;
  if (!allR.length) return `<div class="card"><p class="hint">No responses recorded yet.</p></div>` + tools;

  const newCount = allR.filter((r) => r.a?.cat === 0).length;
  const retCount = allR.filter((r) => r.a?.cat === 1).length;
  const R = cohortFilter === 'new' ? allR.filter((r) => r.a?.cat === 0) : cohortFilter === 'returning' ? allR.filter((r) => r.a?.cat === 1) : allR;
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
  const newStats = cohortCalc(allR.filter((r) => r.a?.cat === 0));
  const retStats = cohortCalc(allR.filter((r) => r.a?.cat === 1));

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
      <button class="filter-pill ${cohortFilter === 'all' ? 'active' : ''}" onclick="cohortFilter='all';admin()">All Patients (${allR.length})</button>
      <button class="filter-pill ${cohortFilter === 'new' ? 'active' : ''}" onclick="cohortFilter='new';admin()">New Patients (${newCount})</button>
      <button class="filter-pill ${cohortFilter === 'returning' ? 'active' : ''}" onclick="cohortFilter='returning';admin()">Returning (${retCount})</button>
    </div>
  </div>`;

  const cohortCardHtml = `<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <h3 style="margin:0"><i class='bx bx-user-pin'></i> Cohort Performance: New vs. Returning Patients</h3>
      <span class="hint" style="margin:0">Total Submissions: ${allR.length}</span>
    </div>
    <div class="cohort-grid">
      <div class="cohort-card">
        <div class="cohort-header">
          <h4><i class='bx bx-user-plus' style="color:#0369a1"></i> New Patients</h4>
          <span class="cohort-badge new">${newStats.count} visits (${allR.length ? Math.round(newStats.count / allR.length * 100) : 0}%)</span>
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
          <span class="cohort-badge ret">${retStats.count} visits (${allR.length ? Math.round(retStats.count / allR.length * 100) : 0}%)</span>
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

  const cm = R.flatMap((r) => [r.a?.q10, r.a?.q9]).filter((x) => x && x.trim()).slice(-8).reverse();

  return filterBarHtml +
    `<div class=kpis>
      <div class=kpi><b>${n}</b>${cohortFilter === 'new' ? 'New Patient' : cohortFilter === 'returning' ? 'Returning' : 'Total'} Responses</div>
      <div class=kpi><b>${avg}/5</b>Avg Satisfaction</div>
      <div class=kpi><b>${pos}%</b>Satisfied (4–5★)</div>
      <div class=kpi><b>${neg}%</b>Dissatisfied (≤2★)</div>
    </div>` +
    cohortCardHtml +
    cd("<i class='bx bx-trending-down' style='color:#c81e1e'></i> Service Satisfaction Ranking (Lowest / Needs Attention First)", `<p class="hint" style="margin-bottom:8px">Sorted from lowest satisfaction rating to highest in active view.</p>` + (rankHtml || '–')) +
    cd('Responses by Visited Service', bars(tl((r) => r.dn))) +
    cd('Overall Satisfaction Rating', bars(q('q8'))) +
    cd('Wait Time Before Seeing Doctor', bars(q('q3'))) +
    cd('Where Delays Occurred', bars(q('q4', 1))) +
    cd('Where Unpleasant Experience Was Reported', bars(q('q6', 1))) +
    cd('Cleanliness & Reception Quality (Rated Excellent/Good)', bars([['Reception', good('q1')], ['Cashier', good('q2')], ['Cleanliness', good('q7')]], 100, '%')) +
    cd('Doctor Listened Carefully', bars(q('q5'))) +
    cd('Visit Time of Day', bars(tl((r) => r.a?.time != null ? Q.time.o[r.a.time]?.[0] : null))) +
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
  let filename = `DMC-Patient-Feedback-${type}-${dateStr}.csv`;

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
    filename = `DMC-Department-Performance-${dateStr}.csv`;
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
    filename = `DMC-Patient-Cohort-Analytics-${dateStr}.csv`;
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
  if (!feedbackResponses.length) {
    alert('No feedback records available to export.');
    return null;
  }
  return buildReportData(type, feedbackResponses, new Date().toISOString().slice(0, 10));
}

function csvField(value) {
  let text = String(value ?? '');
  if (/^[\t\r ]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(report) {
  const contents = `\uFEFF${report.headers.map(csvField).join(',')}\r\n${report.rows
    .map((row) => row.map(csvField).join(','))
    .join('\r\n')}`;
  const url = URL.createObjectURL(new Blob([contents], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = report.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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

function exportCSV(type = 'full') {
  const report = getReportData(type);
  if (!report) return;
  try {
    downloadCsv(report);
    void recordReportExport(type, 'csv');
  } catch (error) {
    console.error('Could not create CSV export:', error);
    alert('The CSV report could not be created. Please try again.');
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
adminSession = event.detail.session;
if (event.detail.event === 'SIGNED_OUT') {
  stopDashboardFeedbackRefresh();
  feedbackResponses = [];
  adminDataLoaded = false;
  if (location.hash === '#admin') location.assign('login.html');
}
});
startApp();

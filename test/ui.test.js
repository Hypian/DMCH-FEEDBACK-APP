'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const frontendPath = (...parts) => path.join(__dirname, '..', 'frontend', ...parts);
const backendPath = (...parts) => path.join(__dirname, '..', 'backend', ...parts);
const script = fs.readFileSync(frontendPath('script.js'), 'utf8');
const styles = fs.readFileSync(frontendPath('styles.css'), 'utf8');

class FakeClassList {
  constructor(classes = []) {
    this.values = new Set(classes);
  }

  add(name) {
    this.values.add(name);
  }

  remove(name) {
    this.values.delete(name);
  }

  toggle(name, force) {
    if (force) this.values.add(name);
    else this.values.delete(name);
  }

  contains(name) {
    return this.values.has(name);
  }
}

class FakeElement {
  constructor(attributes = {}) {
    this.attributes = { ...attributes };
    this.dataset = {};
    for (const [name, value] of Object.entries(attributes)) {
      if (name.startsWith('data-')) {
        const key = name.slice(5).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
        this.dataset[key] = value;
      }
    }
    this.classList = new FakeClassList((attributes.class || '').split(/\s+/).filter(Boolean));
    this.style = {};
    this.disabled = false;
    this.textContent = '';
    this.parentElement = { setAttribute: (name, value) => this.parentAttributes[name] = value };
    this.parentAttributes = {};
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  getAttribute(name) {
    return this.attributes[name] || null;
  }

  remove() {
    this.removed = true;
  }
}

function makeApiFetch(state) {
  state.responses ||= [];
  state.departments ||= [{
    id: 'o0',
    labels: ['General medicine', 'Médecine générale', 'Ubuvuzi Rusange'],
    is_active: true,
    sort_order: 0
  }];

  state.calls ||= [];
  return async (url, options = {}) => {
    state.calls.push({ url, options });
    const pathname = new URL(url, 'http://localhost').pathname;
    const method = options.method || 'GET';
    let status = 200;
    let data = {};
    if (pathname === '/api/check') {
      status = state.checkStatus || 200;
      data = state.checkResult || { available: true };
    } else if (pathname === '/api/departments') {
      data = state.departments;
    } else if (pathname === '/api/admin/session') {
      if (!state.session) {
        status = 401;
        data = { error: 'authentication_required' };
      } else if (state.isAdmin === false) {
        status = 403;
        data = { error: 'admin_access_required' };
      } else {
        data = { user: state.session.user };
      }
    } else if (pathname === '/api/admin/users/pending' && method === 'GET') {
      if (!state.session) {
        status = 401;
        data = { error: 'authentication_required' };
      } else if (state.isAdmin === false) {
        status = 403;
        data = { error: 'admin_access_required' };
      } else {
        data = { users: state.pendingUsers || [] };
      }
    } else if (/^\/api\/admin\/users\/[^/]+\/approval$/.test(pathname) && method === 'PATCH') {
      if (!state.session) {
        status = 401;
        data = { error: 'authentication_required' };
      } else if (state.isAdmin === false) {
        status = 403;
        data = { error: 'admin_access_required' };
      } else {
        const userId = decodeURIComponent(pathname.split('/')[4]);
        const body = JSON.parse(options.body);
        state.pendingUsers = (state.pendingUsers || []).filter((user) => user.user_id !== userId);
        state.reviewedUsers ||= [];
        state.reviewedUsers.push({ user_id: userId, status: body.status });
        data = { user: { user_id: userId, status: body.status } };
      }
    } else if (pathname === '/api/responses' && method === 'GET') {
      data = state.responses;
    } else if (pathname === '/api/responses' && method === 'DELETE') {
      state.responses.splice(0);
      data = { ok: true };
    } else if (pathname === '/api/submit') {
      if (state.failInsert) {
        status = 500;
        data = { error: 'database_error' };
      } else {
        const body = JSON.parse(options.body);
        state.responses.push({
          id: `test-${state.responses.length + 1}`,
          submitted_at: new Date().toISOString(),
          language: body.language,
          department_id: body.departmentId,
          department_name: state.departments.find((department) => department.id === body.departmentId)?.labels[0],
          answers: body.answers,
          is_demo: false,
          user_id: null
        });
        data = { ok: true };
        status = 201;
      }
    }
    return {
      ok: status >= 200 && status < 300,
      status,
      async json() { return data; }
    };
  };
}

function makeContext(fetchImplementation, storage = new Map(), backendState = {}) {
  const timers = new Map();
  const options = [];
  const app = {
    renderCount: 0,
    elements: new Map(),
    children: [],
    set innerHTML(value) {
      this.html = value;
      this.renderCount += 1;
      this.elements.clear();
      const tags = value.matchAll(/<[a-z][\w-]*\b([^>]*)>/gi);
      for (const [, source] of tags) {
        const attributes = {};
        for (const [, name, rawValue] of source.matchAll(/([\w-]+)="([^"]*)"/g)) {
          attributes[name] = rawValue;
        }
        const element = new FakeElement(attributes);
        if (attributes.id) this.elements.set(attributes.id, element);
        if (attributes['data-question']) options.push(element);
      }
      const progress = this.elements.get('submit-progress');
      if (progress) progress.parentElement = new FakeElement();
    },
    get innerHTML() {
      return this.html || '';
    },
    querySelector(selector) {
      if (selector === '.btn') {
        const match = this.html && this.html.match(/<button\b[^>]*class="[^"]*\bbtn\b[^"]*"[^>]*>/);
        if (!match) return null;
        const attrs = {};
        for (const [, name, value] of match[0].matchAll(/([\w-]+)="([^"]*)"/g)) attrs[name] = value;
        return new FakeElement(attrs);
      }
      return null;
    },
    append(node) {
      this.children.push(node);
    }
  };
  let nextTimerId = 1;
  const splash = new FakeElement();
  const welcome = new FakeElement();
  const document = {
    getElementById(id) {
      if (id === 'app') return app;
      if (id === 'splash') return splash.removed ? null : splash;
      if (id === 'wl') return welcome;
      return app.elements.get(id) || null;
    },
    querySelectorAll(selector) {
      if (selector === '.intro-language') {
        return [...app.elements.values()].filter((element) => element.dataset.language);
      }
      if (selector === '#app .opt.lang') return [];
      const match = selector.match(/^\.opt\[data-question="([^"]+)"\]$/);
      return match ? options.filter((option) => option.dataset.question === match[1]) : [];
    },
    createElement() {
      return new FakeElement();
    }
  };
  const location = {
    hash: backendState.routeHash || '',
    replace(value) { this.href = value; },
    assign(value) { this.href = value; }
  };
  const context = vm.createContext({
    document,
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) {
        if (storage.failWritesFor?.has(key)) throw new Error(`Storage write failed for ${key}.`);
        storage.set(key, value);
      },
      removeItem(key) { storage.delete(key); }
    },
    fetch: fetchImplementation || makeApiFetch(backendState),
    crypto: { randomUUID: () => '7ac62bf0-f9e4-4c87-9eb9-6bc5c840fd31' },
    setTimeout(callback, delay = 0) {
      const id = nextTimerId++;
      timers.set(id, { callback, delay, interval: false });
      if (delay >= 850 && delay <= 1000) {
        Promise.resolve().then(() => {
          if (!timers.has(id)) return;
          timers.delete(id);
          callback();
        });
      }
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    setInterval(callback, delay) {
      const id = nextTimerId++;
      timers.set(id, { callback, delay, interval: true });
      return id;
    },
    clearInterval(id) { timers.delete(id); },
    addEventListener() {},
    scrollTo() {},
    location,
    console: { error() {}, log() {} },
    alert() {},
    confirm() { return true; },
    URL: { createObjectURL() { return ''; } },
    Blob: class {}
  });
  vm.runInContext(script, context);

  return { app, context, options, storage, timers, backendState };
}

test('single-choice selection updates in place and advances only once', () => {
  const { app, context, options, timers } = makeContext();
  vm.runInContext("S={lang:'en',dept:'o0',a:{}}; i=3;", context);
  options.push(...[0, 1, 2, 3].map((option) => {
    const element = new FakeElement({ 'data-question': 'q1', 'data-option': String(option) });
    return element;
  }));

  const rendersBeforeSelection = app.renderCount;
  vm.runInContext("ans('q1',0); ans('q1',1);", context);

  assert.equal(app.renderCount, rendersBeforeSelection);
  assert.equal(vm.runInContext('S.a.q1', context), 0);
  assert.equal(options[0].classList.contains('on'), true);
  assert.equal(options[1].classList.contains('on'), false);
  assert.equal(options[0].attributes['aria-pressed'], 'true');

  const timerId = vm.runInContext('answerTimer', context);
  timers.get(timerId).callback();
  assert.equal(vm.runInContext('i', context), 4);
  assert.equal(app.renderCount, rendersBeforeSelection + 1);
});

test('survey screen entrance animation leaves the top logo outside the animation', () => {
  assert.match(styles, /\.wrap\.screen-enter\s*\{\s*animation:\s*none\s*;/);
  assert.match(styles, /\.wrap\.screen-enter\s*>\s*:not\(\.top\)\s*\{\s*animation:\s*screen-enter/);
  assert.doesNotMatch(styles, /\.screen-enter\{animation:screen-enter/);
  assert.match(styles, /\.top img\s*\{[^}]*width:\s*124px;\s*height:\s*36px;[^}]*flex:\s*none;\s*object-fit:\s*contain/);
});

test('welcome splash logo preserves its aspect ratio within the viewport', () => {
  assert.match(styles, /#splash img\s*\{[^}]*width:\s*min\(76vw,\s*360px\);[^}]*height:\s*auto;[^}]*aspect-ratio:\s*760\/221;[^}]*object-fit:\s*contain/);
});

test('survey asks for visit time before Visited Services', () => {
  const { app, context } = makeContext();
  vm.runInContext("S={lang:'en',dept:null,a:{}}; i=0; render(false)", context);

  assert.match(app.innerHTML, /Visit Time/);
  assert.equal(vm.runInContext("flow().indexOf('time') < flow().indexOf('dept')", context), true);
  assert.doesNotMatch(app.innerHTML, /Are you an inpatient or outpatient/);
});

test('admin portal offers shared username sign-in and has no default PIN', () => {
  const { app, context } = makeContext();
  vm.runInContext('admin()', context);

  assert.match(app.innerHTML, /login\.html\?next=/);
  assert.doesNotMatch(app.innerHTML, /1234|administration PIN/);
});

test('logged-out direct access to the admin route redirects to the login page', async () => {
  const { context } = makeContext(null, new Map(), { routeHash: '#admin' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    vm.runInContext('location.href', context),
    'login.html?next=index.html%23admin'
  );
});

test('signup page collects full name, username, and passwords without collecting email or phone', () => {
  const signup = fs.readFileSync(frontendPath('signup.html'), 'utf8');
  const login = fs.readFileSync(frontendPath('login.html'), 'utf8');
  const auth = fs.readFileSync(frontendPath('auth.js'), 'utf8');
  const authBackend = fs.readFileSync(backendPath('neon-auth.mjs'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
  const schema = fs.readFileSync(backendPath('neon', 'schema.sql'), 'utf8');
  const phoneMigration = fs.readFileSync(backendPath('neon', 'phone-optional-migration.sql'), 'utf8');
  const usernameMigration = fs.readFileSync(backendPath('neon', 'username-auth-migration.sql'), 'utf8');
  const backend = fs.readFileSync(backendPath('neon-backend.mjs'), 'utf8');
  assert.match(signup, /name="full_name"/);
  assert.match(signup, /name="username"/);
  assert.match(signup, /name="password"/);
  assert.match(signup, /name="confirm_password"/);
  assert.doesNotMatch(signup, /name="email"|name="phone"/);
  assert.match(login, /name="username"/);
  assert.doesNotMatch(login, /name="email"|forgot-password\.html/);
  assert.match(auth, /sign-up\/email/);
  assert.match(auth, /sign-in\/username/);
  assert.match(auth, /accounts\.dmc\.invalid/);
  assert.match(authBackend, /email: `\$\{user\.username\.toLowerCase\(\)\}@accounts\.dmc\.invalid`/);
  assert.match(authBackend, /requireEmailVerification: false/);
  assert.doesNotMatch(authBackend, /sendResetPassword|sendVerificationEmail/);
  assert.match(server, /\/api\/auth\/sign-in\/email/);
  assert.match(server, /\/api\/auth\/request-password-reset/);
  assert.match(server, /\/api\/auth\/reset-password/);
  assert.equal(fs.existsSync(frontendPath('forgot-password.html')), false);
  assert.equal(fs.existsSync(frontendPath('reset-password.html')), false);
  assert.match(phoneMigration, /alter column phone drop not null/i);
  assert.match(usernameMigration, /add column if not exists username text/i);
  assert.match(usernameMigration, /create unique index if not exists user_username_unique/i);
  assert.match(schema, /create table if not exists public\.feedback_admins/);
  assert.match(backend, /where user_id = \$1/);
  assert.doesNotMatch(backend, /service_role|supabase/i);
});

test('signup offers a themed approval dialog and admin user management loads and approves requests', async () => {
  const signup = fs.readFileSync(frontendPath('signup.html'), 'utf8');
  const authPages = fs.readFileSync(frontendPath('auth-pages.js'), 'utf8');
  assert.match(styles, /\.account-approval-dialog\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0;[^}]*margin:\s*auto;/);
  assert.match(signup, /data-account-dialog/);
  assert.match(authPages, /Please wait for an administrator to approve it before signing in/);

  const backendState = {
    session: { user: { id: 'sandra-user', name: 'Sandra', username: 'sandra' } },
    pendingUsers: [{
      user_id: 'new-user',
      name: 'New Applicant',
      username: 'new_applicant',
      created_at: '2026-10-21T10:00:00Z'
    }]
  };
  const { app, context } = makeContext(undefined, new Map(), backendState);
  vm.runInContext(
    "adminSession={user:{id:'sandra-user',name:'Sandra',username:'sandra'}};adminDataLoaded=true;admin()",
    context
  );
  assert.equal(vm.runInContext('tab', context), 'users');
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(app.innerHTML, /New Applicant/);
  assert.match(app.innerHTML, /@new_applicant/);
  assert.equal(backendState.calls.some((call) => call.url === '/api/admin/users/pending'), true);

  await vm.runInContext("reviewUser('new-user','approved')", context);
  assert.deepEqual(backendState.reviewedUsers, [{ user_id: 'new-user', status: 'approved' }]);
  assert.doesNotMatch(app.innerHTML, /New Applicant/);
});

test('intro language changes in place and loads departments from the Node API', async () => {
  const { app, context, storage, backendState } = makeContext();
  vm.runInContext('renderIntro(false)', context);
  assert.match(app.innerHTML, /<img class="intro-logo" src="logo-optimized\.jpg" alt="Dream Medical Center Hospital" width="760" height="221" loading="lazy" decoding="async">/);
  assert.doesNotMatch(app.innerHTML, /✦/);
  const rendersBeforeLanguageChange = app.renderCount;

  vm.runInContext("S.lang='fr'", context);
  assert.equal(app.renderCount, rendersBeforeLanguageChange);
  assert.match(vm.runInContext('g(U.introTitle)', context), /QUESTIONNAIRE SUR LA SATISFACTION DU SERVICE DES CONSULTATIONS EXTERNES/);

  await vm.runInContext('startSurvey()', context);

  assert.equal(vm.runInContext('i', context), 0);
  assert.match(app.innerHTML, /Heure de la Visite/);
  assert.equal(storage.has('dmc_storage_check'), false);
  assert.equal(storage.has('dmc_device_id'), true);
  assert.equal(backendState.calls.filter((call) => call.url === '/api/check').length, 1);
  assert.equal(backendState.calls.filter((call) => call.url === '/api/departments').length, 1);
  assert.equal(vm.runInContext('departmentsLoaded', context), true);
  assert.equal(vm.runInContext("'phone' in S", context), false);
  assert.equal(vm.runInContext("flow().includes('phone')", context), false);
});

test('language selection shows the translated intro heading and subtitle before the survey', () => {
  const expectedIntro = {
    rw: [
      'GUKUSANYA IBITEKEREZO BY&#39;ABARWAYI BAJE KWIVUZA BATAHA (OPD)',
      'Ibitekerezo byanyu bizadufasha kunoza serivisi zacu.'
    ],
    en: [
      'OUT PATIENT DEPARTMENT FEEDBACK QUESTIONNAIRE',
      'Your feedback is important to us and will help improve our services.'
    ],
    fr: [
      'QUESTIONNAIRE SUR LA SATISFACTION DU SERVICE DES CONSULTATIONS EXTERNES (OPD)',
      'Votre avis nous aidera à améliorer nos services.'
    ]
  };

  for (const [language, [heading, subtitle]] of Object.entries(expectedIntro)) {
    const { app, context } = makeContext();
    vm.runInContext(`selectSplashLang('${language}')`, context);

    assert.equal(vm.runInContext('S.lang', context), language);
    assert.ok(app.innerHTML.includes(heading), `${language} heading should be translated`);
    assert.ok(app.innerHTML.includes(subtitle), `${language} subtitle should be translated`);
    assert.match(app.innerHTML, /id="start-survey"/);
    assert.equal(vm.runInContext('i', context), 0);
  }
});

test('a device with a recent response cannot start another survey', async () => {
  const backendState = {
    checkStatus: 409,
    checkResult: { error: 'duplicate_submission', retryAfterSeconds: 3600 }
  };
  const { app, context, storage } = makeContext(undefined, new Map(), backendState);
  vm.runInContext('renderIntro(false)', context);

  await vm.runInContext('startSurvey()', context);

  assert.match(app.innerHTML, /THANK YOU FOR CHOOSING/);
  assert.equal(storage.has('dmc_completed'), true);
  assert.equal(storage.has('dmc_device_id'), true);
});

test('survey startup explains how to restore the feedback server connection', async () => {
  const { app, context } = makeContext(async () => {
    throw new TypeError('Failed to fetch');
  });
  vm.runInContext('renderIntro(false)', context);

  await vm.runInContext('startSurvey()', context);

  const message = vm.runInContext("$('intro-error').textContent", context);
  assert.match(message, /Run npm start in the project folder/);
  assert.match(message, /configure the required Neon settings in \.env/);
});

test('a local submission within 24 hours restores the completion screen without network access', () => {
  const storage = new Map([['dmc_completed', JSON.stringify({ submittedAt: Date.now(), lang: 'fr' })]]);
  let fetchCalls = 0;
  const { app, context } = makeContext(async () => {
    fetchCalls += 1;
    throw new Error('The local demo must not make network requests.');
  }, storage);
  vm.runInContext('renderIntro(false)', context);
  vm.runInContext("S.lang='fr'", context);

  vm.runInContext('startSurvey()', context);

  assert.match(app.innerHTML, /MERCI D(&#39;|')AVOIR CHOISI DREAM MEDICAL CENTER HOSPITAL!/);
  assert.doesNotMatch(app.innerHTML, /Bienvenue à DMC Hospital/);
  assert.match(app.innerHTML, /Envoyé/);
  assert.equal(fetchCalls, 0);
});

test('successful feedback submission stores the response and restores completion after refresh', async () => {
  const { app, context, storage, backendState } = makeContext();
  vm.runInContext(`Date.now = () => ${Date.now()}`, context);
  const submission = vm.runInContext(
    "clearTimeout(welcomeTimer); welcomeTimer=null; S={lang:'en',dept:'o0',a:{q1:1}}; submit()",
    context
  );
  await Promise.resolve();
  assert.match(app.innerHTML, /submit-progress/);
  await submission;
  assert.equal(backendState.calls.filter((call) => call.url === '/api/submit').length, 1);
  assert.match(app.innerHTML, /THANK YOU FOR CHOOSING DREAM MEDICAL CENTER HOSPITAL!!!!!!!/);
  assert.doesNotMatch(app.innerHTML, /Welcome to DMC Hospital/);
  assert.match(app.innerHTML, /Submitted/);
  assert.equal(backendState.responses.length, 1);
  assert.equal(backendState.responses[0].language, 'en');
  assert.equal(backendState.responses[0].department_id, 'o0');
  assert.equal(backendState.responses[0].answers.q1, 1);
  assert.equal(storage.has('dmc_r'), false);
  assert.equal(JSON.parse(storage.get('dmc_completed')).lang, 'en');

  const refreshed = makeContext(null, storage);
  assert.match(refreshed.app.innerHTML, /THANK YOU FOR CHOOSING DREAM MEDICAL CENTER HOSPITAL!!!!!!!/);
  assert.equal(refreshed.timers.size, 0);
});

test('failed feedback save keeps answers and offers a successful retry', async () => {
  const storage = new Map();
  const backendState = { failInsert: true };
  const { app, context } = makeContext(null, storage, backendState);
  vm.runInContext(
    "clearTimeout(welcomeTimer); welcomeTimer=null; S={lang:'en',dept:'o0',a:{q1:1}}",
    context
  );

  await vm.runInContext('submit()', context);
  assert.match(app.innerHTML, /Your answers are still here/);
  assert.equal(vm.runInContext('S.a.q1', context), 1);
  backendState.failInsert = false;
  await vm.runInContext('submit()', context);

  assert.equal(backendState.responses.length, 1);
  assert.match(app.innerHTML, /THANK YOU FOR CHOOSING DREAM MEDICAL CENTER HOSPITAL!!!!!!!/);
});

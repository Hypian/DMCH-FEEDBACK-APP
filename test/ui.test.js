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
const html = fs.readFileSync(frontendPath('index.html'), 'utf8');

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

  click() {
    this.clicked = true;
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
    } else if (pathname === '/api/dashboard/session') {
      if (!state.session) {
        status = 401;
        data = { error: 'authentication_required' };
      } else {
        data = {
          user: state.session.user,
          isAdmin: state.isAdmin !== false,
          isSupremeAdmin: state.isSupremeAdmin === true
        };
      }
    } else if (pathname === '/api/admin/directory' && method === 'GET') {
      data = { admins: state.adminDirectory || [] };
    } else if (pathname === '/api/admin/active-users' && method === 'GET') {
      data = { users: state.activeUsers || [] };
    } else if (pathname === '/api/admin/audit' && method === 'GET') {
      data = state.auditEvents || [];
    } else if (pathname === '/api/admin/audit' && method === 'POST') {
      state.reportExports ||= [];
      state.reportExports.push(JSON.parse(options.body));
      data = { ok: true };
    } else if (pathname === '/api/admin/users' && method === 'GET') {
      if (state.isAdmin === false) {
        status = 403;
        data = { error: 'admin_access_required' };
      } else {
        data = { users: state.managedUsers || [] };
      }
    } else if (pathname === '/api/admin/users/pending' && method === 'GET') {
      if (!state.session) {
        status = 401;
        data = { error: 'authentication_required' };
      } else if (state.isSupremeAdmin !== true) {
        status = 403;
        data = { error: 'supreme_admin_access_required' };
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
        const user = (state.managedUsers || []).find((item) => item.user_id === userId);
        if (user) user.status = body.status;
        state.reviewedUsers ||= [];
        state.reviewedUsers.push({ user_id: userId, status: body.status });
        data = { user: { user_id: userId, status: body.status } };
      }
    } else if (/^\/api\/admin\/users\/[^/]+\/status$/.test(pathname) && method === 'PATCH') {
      const userId = decodeURIComponent(pathname.split('/')[4]);
      const body = JSON.parse(options.body);
      const user = (state.managedUsers || []).find((item) => item.user_id === userId);
      if (user) user.status = body.status;
      state.statusChanges ||= [];
      state.statusChanges.push({ user_id: userId, status: body.status });
      data = { user: { user_id: userId, status: body.status } };
    } else if (/^\/api\/admin\/users\/[^/]+\/(admin|supreme)$/.test(pathname) && method === 'PATCH') {
      const userId = decodeURIComponent(pathname.split('/')[4]);
      const role = pathname.split('/')[5] === 'admin' ? 'is_admin' : 'is_supreme_admin';
      const user = (state.managedUsers || []).find((item) => item.user_id === userId);
      if (user) {
        user[role] = JSON.parse(options.body).enabled;
        if (role === 'is_admin' && user.is_admin) user.status = 'approved';
      }
      data = { user: { user_id: userId, [role]: JSON.parse(options.body).enabled } };
    } else if (/^\/api\/admin\/users\/[^/]+$/.test(pathname) && method === 'DELETE') {
      const userId = decodeURIComponent(pathname.split('/')[4]);
      state.managedUsers = (state.managedUsers || []).filter((item) => item.user_id !== userId);
      state.deletedUsers ||= [];
      state.deletedUsers.push(userId);
      data = { deleted: true, userId };
    } else if (pathname === '/api/responses' && method === 'GET') {
      data = state.responses;
    } else if (/^\/api\/responses\/[0-9a-f-]+$/i.test(pathname) && method === 'DELETE') {
      const id = pathname.split('/').at(-1);
      state.responses = state.responses.filter((response) => response.id !== id);
      state.deletedResponses ||= [];
      state.deletedResponses.push(id);
      data = { ok: true, id };
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
  const feedbackDeleteDialog = new FakeElement();
  const feedbackDeleteDialogElements = new Map([
    ['feedback-delete-title', new FakeElement()],
    ['feedback-delete-description', new FakeElement()],
    ['feedback-delete-cancel', new FakeElement()],
    ['feedback-delete-confirm', new FakeElement()]
  ]);
  feedbackDeleteDialog.showModal = function () { this.open = true; };
  feedbackDeleteDialog.close = function () { this.open = false; };
  const document = {
    baseURI: 'https://dmc.example/',
    body: { appendChild(node) { app.append(node); } },
    getElementById(id) {
      if (id === 'app') return app;
      if (id === 'splash') return splash.removed ? null : splash;
      if (id === 'wl') return welcome;
      if (id === 'feedback-delete-dialog') return feedbackDeleteDialog;
      if (feedbackDeleteDialogElements.has(id)) return feedbackDeleteDialogElements.get(id);
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
    URL: Object.assign(class extends URL {}, {
      createObjectURL(blob) {
        backendState.downloadedBlob = blob;
        return 'blob:dmc-report';
      },
      revokeObjectURL() {}
    }),
    Blob: class {
      constructor(parts, options) {
        this.parts = parts;
        this.options = options;
      }
    }
  });
  vm.runInContext(script, context);

  return { app, context, options, storage, timers, backendState, feedbackDeleteDialog, feedbackDeleteDialogElements };
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
  assert.match(styles, /\.top\s*\{[^}]*border-radius:\s*var\(--radius-md\);/);
  assert.match(styles, /\.top img\s*\{[^}]*width:\s*124px;\s*height:\s*36px;[^}]*flex:\s*none;\s*object-fit:\s*contain/);
});

test('welcome splash logo preserves its aspect ratio within the viewport', () => {
  assert.match(styles, /#splash img\s*\{[^}]*width:\s*min\(76vw,\s*360px\);[^}]*height:\s*auto;[^}]*aspect-ratio:\s*760\/221;[^}]*object-fit:\s*contain/);
});

test('survey asks for visit time before Visited Services', () => {
  const { app, context } = makeContext();
  vm.runInContext("S={lang:'en',dept:null,a:{}}; i=0; render(false)", context);

  assert.match(app.innerHTML, /Visit time/);
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
  const authPages = fs.readFileSync(frontendPath('auth-pages.js'), 'utf8');
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
  assert.match(signup, /<form data-auth-form method="post" novalidate>/);
  assert.doesNotMatch(signup, /name="email"|name="phone"/);
  assert.match(login, /name="username"/);
  assert.match(login, /<form data-auth-form method="post" novalidate>/);
  assert.doesNotMatch(login, /name="email"|forgot-password\.html/);
  assert.match(authPages, /if \(requested === 'index\.html#admin'\) return requested;\s*return 'index\.html#admin';/);
  assert.match(authPages, /page === 'login' \? 'index\.html#admin' : 'index\.html'/);
  assert.ok(authPages.indexOf("if (account.status !== 'approved')") < authPages.indexOf('window.location.replace(nextPage())'));
  assert.match(authPages, /if \(account\.status !== 'approved'\) \{\s*await signOut\(\);/);
  assert.ok(authPages.indexOf("form?.addEventListener('submit'") < authPages.indexOf('async function initialize()'));
  assert.match(authPages, /event\.preventDefault\(\);\s*if \(!authPageReady\)/);
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

test('signup offers a themed approval dialog and supreme admins manage accounts and roles', async () => {
  const signup = fs.readFileSync(frontendPath('signup.html'), 'utf8');
  const authPages = fs.readFileSync(frontendPath('auth-pages.js'), 'utf8');
  assert.match(styles, /\.account-approval-dialog\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0;[^}]*margin:\s*auto;/);
  assert.match(signup, /data-account-dialog/);
  assert.match(authPages, /Please wait for an administrator to approve it before signing in/);

  const backendState = {
    session: { user: { id: 'sandra-user', name: 'Sandra', username: 'sandra' } },
    isSupremeAdmin: true,
    adminDirectory: [{ name: 'Sandra', username: 'sandra', is_supreme_admin: true }],
    activeUsers: [
      { name: 'Sandra', username: 'sandra' },
      { name: 'Approved Patient', username: 'patient' }
    ],
    pendingUsers: [{
      user_id: 'new-user',
      name: 'New Applicant',
      username: 'new_applicant',
      created_at: '2026-10-21T10:00:00Z'
    }],
    managedUsers: [{
      user_id: 'new-user',
      name: 'New Applicant',
      username: 'new_applicant',
      status: 'pending',
      is_admin: false,
      is_supreme_admin: false
    }]
  };
  const { app, context } = makeContext(undefined, new Map(), backendState);
  vm.runInContext(
    "adminSession={user:{id:'sandra-user',name:'Sandra',username:'sandra'},isAdmin:true,isSupremeAdmin:true};adminDataLoaded=true;admin()",
    context
  );
  assert.equal(vm.runInContext('tab', context), 'users');
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(app.innerHTML, /New Applicant/);
  assert.match(app.innerHTML, /@new_applicant/);
  assert.match(app.innerHTML, /Active users \(2\)/);
  assert.match(app.innerHTML, /Approved Patient/);
  assert.equal(backendState.calls.some((call) => call.url === '/api/admin/users'), true);

  await vm.runInContext("reviewUser('new-user','approved')", context);
  assert.deepEqual(backendState.reviewedUsers, [{ user_id: 'new-user', status: 'approved' }]);
  assert.match(app.innerHTML, /New Applicant/);
  assert.doesNotMatch(app.innerHTML, />Approve</);

  await vm.runInContext("setUserRole('new-user','admin',true)", context);
  assert.equal(backendState.managedUsers[0].is_admin, true);
  assert.match(app.innerHTML, /Make supreme/);

  await vm.runInContext("setUserRole('new-user','supreme',true)", context);
  assert.equal(backendState.managedUsers[0].is_supreme_admin, true);
  assert.match(app.innerHTML, /Supreme admin/);

  await vm.runInContext("setUserRole('new-user','supreme',false)", context);
  await vm.runInContext("setUserRole('new-user','admin',false)", context);
  assert.match(app.innerHTML, /Deactivate/);
  await vm.runInContext("setUserStatus('new-user','deactivated')", context);
  assert.equal(backendState.managedUsers[0].status, 'deactivated');
  assert.match(app.innerHTML, /Reactivate/);
  await vm.runInContext("setUserStatus('new-user','approved')", context);
  assert.equal(backendState.managedUsers[0].status, 'approved');

  assert.match(app.innerHTML, /Delete/);
  await vm.runInContext("deleteUser('new-user','new_applicant')", context);
  assert.deepEqual(backendState.deletedUsers, ['new-user']);
});

test('regular admins can open User Management without supreme-admin controls', async () => {
  const backendState = {
    session: { user: { id: 'regular-admin', name: 'Regular Admin', username: 'regular_admin' } },
    isAdmin: true,
    isSupremeAdmin: false,
    adminDirectory: [{ name: 'Regular Admin', username: 'regular_admin' }],
    activeUsers: [{ name: 'Approved Patient', username: 'patient' }],
    managedUsers: [{
      user_id: 'pending-user',
      name: 'Pending User',
      username: 'pending_user',
      status: 'pending',
      is_admin: false,
      is_supreme_admin: false
    }]
  };
  const { app, context } = makeContext(undefined, new Map(), backendState);
  vm.runInContext(
    "adminSession={user:{id:'regular-admin',name:'Regular Admin',username:'regular_admin'},isAdmin:true,isSupremeAdmin:false};adminDataLoaded=true;tab='users';admin()",
    context
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(vm.runInContext('tab', context), 'users');
  assert.match(app.innerHTML, /User Management/);
  assert.ok(app.innerHTML.indexOf('Activity Log') < app.innerHTML.indexOf('User Management'));
  assert.doesNotMatch(app.innerHTML, /class="wrap adm s"/);
  assert.match(app.innerHTML, /Approved Patient/);
  assert.match(app.innerHTML, /Admin directory/);
  assert.doesNotMatch(app.innerHTML, /Accounts &amp; permissions/);
  assert.match(app.innerHTML, /All accounts \(1\)/);
  assert.match(app.innerHTML, /Pending User/);
  assert.equal(backendState.calls.some((call) => call.url === '/api/admin/users'), true);
});

test('approved regular users see dashboard tabs but not account management or write controls', () => {
  const backendState = {
    session: { user: { id: 'approved-user', name: 'Approved User', username: 'approved_user' } },
    isAdmin: false,
    isSupremeAdmin: false,
    responses: []
  };
  const { app, context } = makeContext(undefined, new Map(), backendState);
  vm.runInContext(
    "adminSession={user:{id:'approved-user',name:'Approved User',username:'approved_user'},isAdmin:false,isSupremeAdmin:false};adminDataLoaded=true;tab='users';admin()",
    context
  );

  assert.equal(vm.runInContext('tab', context), 'stats');
  assert.match(app.innerHTML, /Analytics & Cohorts/);
  assert.match(app.innerHTML, /Department Matrix/);
  assert.match(app.innerHTML, /Feedback Records/);
  assert.match(app.innerHTML, /Export Center/);
  assert.match(app.innerHTML, /Activity Log/);
  assert.doesNotMatch(app.innerHTML, /User Management/);

  vm.runInContext("tab='depts';admin()", context);
  assert.match(app.innerHTML, /Services/);
  assert.doesNotMatch(app.innerHTML, /Add visited service|Deactivate|Restore/);

  vm.runInContext("tab='stats';admin()", context);
  assert.match(app.innerHTML, /Export Full Dataset XLSX/);
  assert.doesNotMatch(app.innerHTML, /Load demo data|Remove demo data|Clear all/);
});

test('dashboard feedback refreshes automatically and individual records can be deleted', async () => {
  const feedback = {
    id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    submitted_at: '2026-10-21T18:00:00.000Z',
    language: 'en',
    department_id: 'o0',
    department_name: 'General medicine',
    answers: { cat: 0 },
    is_demo: false,
    user_id: null
  };
  const backendState = {
    routeHash: '#admin',
    session: { user: { id: 'sandra-user', name: 'Sandra', username: 'sandra' } },
    responses: []
  };
  const { app, context, timers, feedbackDeleteDialog, feedbackDeleteDialogElements } = makeContext(undefined, new Map(), backendState);
  vm.runInContext(
    "location.hash='#admin';adminSession={user:{id:'sandra-user',name:'Sandra',username:'sandra'},isAdmin:true,isSupremeAdmin:true};adminDataLoaded=true;tab='feedbacks';admin();startDashboardFeedbackRefresh()",
    context
  );
  backendState.responses.push(feedback);

  const refreshTimer = timers.get(vm.runInContext('dashboardFeedbackTimer', context));
  assert.equal(refreshTimer.interval, true);
  refreshTimer.callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(app.innerHTML, /General medicine/);
  assert.equal(vm.runInContext('feedbackResponses.length', context), 1);

  vm.runInContext("S.lang='fr'", context);
  await vm.runInContext(`deleteFeedback('${feedback.id}')`, context);
  assert.equal(feedbackDeleteDialog.open, true);
  assert.equal(feedbackDeleteDialogElements.get('feedback-delete-title').textContent, 'Supprimer cet avis ?');
  assert.equal(feedbackDeleteDialogElements.get('feedback-delete-cancel').textContent, 'Annuler');
  assert.equal(backendState.deletedResponses, undefined);

  vm.runInContext('cancelFeedbackDelete()', context);
  assert.equal(feedbackDeleteDialog.open, false);
  assert.equal(vm.runInContext('feedbackResponses.length', context), 1);

  await vm.runInContext(`deleteFeedback('${feedback.id}')`, context);
  await vm.runInContext('confirmFeedbackDelete()', context);
  assert.deepEqual(backendState.deletedResponses, [feedback.id]);
  assert.equal(vm.runInContext('feedbackResponses.length', context), 0);
  assert.match(backendState.calls.find((call) => call.url === `/api/responses/${feedback.id}`).options.method, /DELETE/);
});

test('feedback deletion uses one accessible custom dialog', () => {
  assert.equal((html.match(/id="feedback-delete-dialog"/g) || []).length, 1);
  assert.match(html, /<dialog[^>]*aria-labelledby="feedback-delete-title"[^>]*aria-describedby="feedback-delete-description"/);
  assert.equal((styles.match(/\.feedback-delete-dialog\s*\{/g) || []).length, 1);
});

test('admins can view a refreshed activity log and report exports contain feedback data', async () => {
  const backendState = {
    routeHash: '#admin',
    session: { user: { id: 'regular-admin', name: 'Regular Admin', username: 'regular_admin' } },
    auditEvents: [{
      id: 1,
      created_at: '2026-10-23T07:00:00.000Z',
      action: 'feedback.submitted',
      summary: 'Feedback submitted for General medicine.',
      actor: 'Anonymous patient'
    }],
    responses: [{
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      submitted_at: '2026-10-23T07:00:00.000Z',
      language: 'en',
      department_id: 'o0',
      department_name: 'General medicine',
      answers: { cat: 0, q8: 1, q10: '=HYPERLINK("https://example.invalid")' },
      is_demo: false,
      user_id: null
    }]
  };
  const { app, context } = makeContext(undefined, new Map(), backendState);
  vm.runInContext(
    "location.hash='#admin';adminSession={user:{id:'regular-admin',name:'Regular Admin'},isAdmin:true,isSupremeAdmin:false};adminDataLoaded=true;tab='audit';admin()",
    context
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(app.innerHTML, /Activity Log/);
  assert.match(app.innerHTML, /Feedback submitted for General medicine/);
  assert.match(app.innerHTML, /Anonymous patient/);

  const rendersBeforeUnchangedRefresh = app.renderCount;
  await vm.runInContext('refreshDashboardFeedback()', context);
  assert.equal(app.renderCount, rendersBeforeUnchangedRefresh);

  await vm.runInContext('loadAdminData()', context);
  const excelReports = [];
  const apiFetch = context.fetch;
  context.fetch = async (url, options) => {
    if (new URL(url, 'https://dmc.example/').pathname === '/logo-optimized.jpg') {
      return {
        ok: true,
        status: 200,
        async arrayBuffer() { return new Uint8Array([0xFF, 0xD8, 0xFF, 0xD9]).buffer; }
      };
    }
    return apiFetch(url, options);
  };
  context.DMCExcelExport = {
    async downloadWorkbook(report) { excelReports.push(report); }
  };
  await vm.runInContext("exportExcel('full')", context);
  assert.equal(excelReports.length, 1);
  assert.equal(excelReports[0].rows.length, 1);
  assert.equal(excelReports[0].rows[0][0], 'f47ac10b-58cc-4372-a567-0e02b2c3d479');
  assert.equal(excelReports[0].rows[0][4], 'General medicine');
  assert.equal(excelReports[0].rows[0][17], '=HYPERLINK("https://example.invalid")');
  assert.equal(excelReports[0].filename.endsWith('.xlsx'), true);
  assert.equal(excelReports[0].logoBytes.length, 4);
  assert.equal(backendState.reportExports[0].format, 'xlsx');
});

test('activity log prints user full names on frontend while keeping account hashes in background', async () => {
  const accountId = '0iIbRgTQOXUXxpbPi4e6VSNYWfluAnbY';
  const backendState = {
    routeHash: '#admin',
    session: { user: { id: 'admin-1', name: 'Admin One', username: 'admin_one' } },
    auditEvents: [
      {
        id: 1,
        created_at: '2026-10-24T10:00:00.000Z',
        action: 'account.approved',
        summary: `Approved account ${accountId}.`,
        target_type: 'account',
        target_id: accountId,
        target_name: 'Dr. Jane Smith',
        target_username: 'jsmith',
        actor: 'Admin One'
      },
      {
        id: 2,
        created_at: '2026-10-24T09:30:00.000Z',
        action: 'account.deactivated',
        summary: 'Deactivated account old_user_hash_123.',
        target_type: 'account',
        target_id: 'old_user_hash_123',
        metadata: { name: 'John Miller', username: 'jmiller' },
        actor: 'Admin One'
      }
    ]
  };
  const { app, context } = makeContext(undefined, new Map(), backendState);
  vm.runInContext(
    "location.hash='#admin';adminSession={user:{id:'admin-1',name:'Admin One'},isAdmin:true,isSupremeAdmin:true};adminDataLoaded=true;tab='audit';admin()",
    context
  );
  await new Promise((resolve) => setImmediate(resolve));

  // Frontend displays the full names
  assert.match(app.innerHTML, /Approved account Dr\. Jane Smith\./);
  assert.match(app.innerHTML, /Deactivated account John Miller\./);

  // Background hash is not printed in the user-visible details cell
  assert.doesNotMatch(app.innerHTML, /Approved account 0iIbRgTQOXUXxpbPi4e6VSNYWfluAnbY/);
  assert.doesNotMatch(app.innerHTML, /Deactivated account old_user_hash_123/);
});

test('intro language changes in place and loads departments from the Node API', async () => {
  const { app, context, storage, backendState } = makeContext();
  vm.runInContext('renderIntro(false)', context);
  assert.match(app.innerHTML, /<img class="intro-logo" src="logo-optimized\.jpg" alt="Dream Medical Center Hospital" width="760" height="221" loading="lazy" decoding="async">/);
  assert.doesNotMatch(app.innerHTML, /✦/);
  const rendersBeforeLanguageChange = app.renderCount;

  vm.runInContext("S.lang='fr'", context);
  assert.equal(app.renderCount, rendersBeforeLanguageChange);
  assert.match(vm.runInContext('g(U.introTitle)', context), /QUESTIONNAIRE DE SATISFACTION DU SERVICE DES CONSULTATIONS EXTERNES/);

  await vm.runInContext('startSurvey()', context);

  assert.equal(vm.runInContext('i', context), 0);
  assert.match(app.innerHTML, /Heure de la visite/);
  assert.equal(storage.has('dmc_storage_check'), false);
  assert.equal(storage.has('dmc_device_id'), true);
  assert.equal(backendState.calls.filter((call) => call.url === '/api/check').length, 1);
  assert.equal(backendState.calls.filter((call) => call.url === '/api/departments').length, 1);
  assert.equal(vm.runInContext('departmentsLoaded', context), true);
  assert.equal(vm.runInContext("'phone' in S", context), false);
  assert.equal(vm.runInContext("flow().includes('phone')", context), false);
});

test('language selection shows the translated intro heading, subtitle, and N.B. caution notice before the survey', () => {
  const expectedIntro = {
    rw: [
      'GUKUSANYA IBITEKEREZO BY&#39;ABARWAYI BAJE KWIVUZA BATAHA (OPD)',
      'Ibitekerezo byanyu n’ingirakamaro kuri twe kandi bizadufasha kunoza serivisi zacu.',
      'Icyitonderwa:',
      'Ibitekerezo byanyu n’ibanga kandi ntankurikizi cyangwa ingaruka bibagiraho'
    ],
    en: [
      'OUTPATIENT DEPARTMENT FEEDBACK QUESTIONNAIRE',
      'Your feedback is important to us and will help us improve the quality of our services.',
      'N.B.:',
      'Your responses are anonymous and confidential'
    ],
    fr: [
      'QUESTIONNAIRE DE SATISFACTION DU SERVICE DES CONSULTATIONS EXTERNES (OPD)',
      'Votre avis compte pour nous et nous aidera à améliorer la qualité de nos services.',
      'N.B. :',
      'Vos réponses sont anonymes et confidentielles'
    ]
  };

  for (const [language, [heading, subtitle, noticePrefix, noticeBody]] of Object.entries(expectedIntro)) {
    const { app, context } = makeContext();
    vm.runInContext(`selectSplashLang('${language}')`, context);

    assert.equal(vm.runInContext('S.lang', context), language);
    assert.ok(app.innerHTML.includes(heading), `${language} heading should be translated`);
    assert.ok(app.innerHTML.includes(subtitle), `${language} subtitle should be translated`);
    assert.match(app.innerHTML, /id="intro-notice"/);
    assert.match(app.innerHTML, /bx-error-circle/);
    assert.ok(app.innerHTML.includes(noticePrefix), `${language} notice prefix should match`);
    assert.ok(app.innerHTML.includes(noticeBody), `${language} notice body should match`);
    assert.match(app.innerHTML, /id="start-survey"/);
    if (language === 'rw') {
      assert.match(app.innerHTML, /Tangira/);
    }
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

  assert.match(app.innerHTML, /Thank you for choosing/);
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

  assert.match(app.innerHTML, /Merci d’avoir choisi Dream Medical Center Hospital !/);
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
  assert.match(app.innerHTML, /Thank you for choosing Dream Medical Center Hospital!/);
  assert.match(app.innerHTML, /<p class="intro-copy completion-body">Your feedback has been received\.<\/p>/);
  assert.doesNotMatch(app.innerHTML, /Your feedback has been received\. Thank you for choosing/);
  assert.doesNotMatch(app.innerHTML, /Welcome to DMC Hospital/);
  assert.match(app.innerHTML, /Submitted/);
  assert.equal(backendState.responses.length, 1);
  assert.equal(backendState.responses[0].language, 'en');
  assert.equal(backendState.responses[0].department_id, 'o0');
  assert.equal(backendState.responses[0].answers.q1, 1);
  assert.equal(storage.has('dmc_r'), false);
  assert.equal(JSON.parse(storage.get('dmc_completed')).lang, 'en');

  const refreshed = makeContext(null, storage);
  assert.match(refreshed.app.innerHTML, /Thank you for choosing Dream Medical Center Hospital!/);
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
  assert.match(app.innerHTML, /Thank you for choosing Dream Medical Center Hospital!/);
});

test('Statistics & Visual Charts tab renders large donut graphs and proportional bars', () => {
  const backendState = {
    session: { user: { id: 'admin-user', name: 'Admin', username: 'admin' } },
    isAdmin: true,
    isSupremeAdmin: false,
    responses: []
  };
  const { app, context } = makeContext(undefined, new Map(), backendState);
  vm.runInContext(
    "adminSession={user:{id:'admin-user',name:'Admin',username:'admin'},isAdmin:true,isSupremeAdmin:false};adminDataLoaded=true;feedbackResponses=[{id:'f-1',submitted_at:'2026-10-21T18:00:00.000Z',language:'en',department_id:'o0',department_name:'General medicine',dn:'General medicine',a:{cat:0,time:0,q1:0,q2:0,q3:0,q4:[],q5:0,q6:[],q7:0,q8:0},is_demo:false,user_id:null}];tab='charts';admin()",
    context
  );

  assert.equal(vm.runInContext('tab', context), 'charts');
  assert.match(app.innerHTML, /Statistics & Visual Charts/);
  assert.match(app.innerHTML, /big-donut-grid/);
  assert.match(app.innerHTML, /Overall Satisfaction Spectrum/);
  assert.match(app.innerHTML, /Patient Cohort Ratio/);
  assert.match(app.innerHTML, /Doctor Care & Attentiveness/);
  assert.match(app.innerHTML, /Doctor Wait Time &amp; Delays|Doctor Wait Time & Delays/);
  assert.match(app.innerHTML, /Doctor Wait Time Breakdown/);
  assert.match(app.innerHTML, /Operational Delay Hotspots/);
  assert.match(app.innerHTML, /openChartDetailModal/);
  assert.match(app.innerHTML, /View Details/);

  vm.runInContext("openChartDetailModal('satisfaction', 'star5')", context);
  assert.equal(vm.runInContext("activeSliceNavigation?.rating", context), 'sat');
  vm.runInContext("openChartDetailModal('cohorts', 'new')", context);
  assert.equal(vm.runInContext("activeSliceNavigation?.cohort", context), 'new');
  vm.runInContext("openChartDetailModal('wait', 'wait0')", context);
  assert.equal(vm.runInContext("typeof activeSliceNavigation", context), 'object');
});


test('visual and stats tabs support global and per-card switching between Bar Charts and Donuts', () => {
  const backendState = {
    session: { user: { id: 'admin-user', name: 'Admin', username: 'admin' } },
    isAdmin: true,
    isSupremeAdmin: false,
    responses: []
  };
  const { app, context } = makeContext(undefined, new Map(), backendState);
  vm.runInContext(
    "adminSession={user:{id:'admin-user',name:'Admin',username:'admin'},isAdmin:true,isSupremeAdmin:false};adminDataLoaded=true;feedbackResponses=[{id:'f-1',t:Date.now(),submitted_at:'2026-10-21T18:00:00.000Z',l:'en',language:'en',department_id:'o0',department_name:'General medicine',dn:'General medicine',a:{cat:0,time:0,q1:0,q2:0,q3:0,q4:[0],q5:0,q6:[0],q7:0,q8:0},is_demo:false,user_id:null}];tab='charts';admin()",
    context
  );

  assert.match(app.innerHTML, /big-donut-svg-wrap/);
  assert.match(app.innerHTML, /Switch Between Bar Charts &amp; Donuts/);

  vm.runInContext("setVisualChartMode('bar')", context);
  assert.equal(vm.runInContext('visualChartMode', context), 'bar');
  assert.match(app.innerHTML, /vertical-bar-stage/);
  assert.match(app.innerHTML, /vcol-chart-grid/);

  vm.runInContext("toggleCardChartMode('satisfaction', 'bar')", context);
  assert.equal(vm.runInContext("cardChartModes.satisfaction", context), 'donut');
  assert.match(app.innerHTML, /big-donut-svg-wrap/);
  assert.match(app.innerHTML, /vertical-bar-stage/);

  vm.runInContext("tab='stats';admin()", context);
  assert.match(app.innerHTML, /Analytics &#38; Cohorts Visuals|Analytics &amp; Cohorts Visuals/);
  vm.runInContext("setStatsChartMode('donut')", context);
  assert.equal(vm.runInContext('statsChartMode', context), 'donut');
  assert.match(app.innerHTML, /donut-svg/);

  vm.runInContext("setStatsChartMode('bar')", context);
  assert.equal(vm.runInContext('statsChartMode', context), 'bar');
  assert.match(app.innerHTML, /visual-bar-row/);
});

test('Presentation Mode opens, navigates slides, switches chart styles, and exports PPTX decks', async () => {
  const backendState = {
    session: { user: { id: 'admin-user', name: 'Admin', username: 'admin' } },
    isAdmin: true,
    isSupremeAdmin: false,
    responses: [{
      id: 'f-101',
      submitted_at: '2026-10-25T12:00:00.000Z',
      language: 'en',
      department_id: 'o0',
      department_name: 'General medicine',
      answers: { cat: 0, time: 0, q1: 0, q2: 0, q3: 0, q4: [0], q5: 0, q6: [], q7: 0, q8: 0, q10: 'Very attentive doctor' },
      is_demo: false,
      user_id: null
    }]
  };
  const { app, context } = makeContext(undefined, new Map(), backendState);
  vm.runInContext(
    "location.hash='#admin';adminSession={user:{id:'admin-user',name:'Admin'},isAdmin:true,isSupremeAdmin:false};adminDataLoaded=true",
    context
  );
  await vm.runInContext('loadAdminData()', context);

  vm.runInContext('openPresentationMode()', context);
  assert.equal(vm.runInContext('presentationModeActive', context), true);
  assert.equal(vm.runInContext('presentationSlideIndex', context), 0);
  assert.match(app.innerHTML, /PRESENTATION MODE/);
  assert.match(app.innerHTML, /Slide 1 • Executive Summary/);

  vm.runInContext('nextPresentationSlide(7)', context);
  assert.equal(vm.runInContext('presentationSlideIndex', context), 1);
  assert.match(app.innerHTML, /Slide 2 • Satisfaction &amp; Cohorts|Slide 2 • Satisfaction & Cohorts/);

  vm.runInContext('goToPresentationSlide(5)', context);
  assert.equal(vm.runInContext('presentationSlideIndex', context), 5);
  assert.match(app.innerHTML, /Slide 6 • Department Matrix/);

  vm.runInContext('prevPresentationSlide(7)', context);
  assert.equal(vm.runInContext('presentationSlideIndex', context), 4);
  assert.match(app.innerHTML, /Slide 5 • Facility Quality/);

  vm.runInContext('closePresentationMode()', context);
  assert.equal(vm.runInContext('presentationModeActive', context), false);

  const pptxReports = [];
  const apiFetch = context.fetch;
  context.fetch = async (url, options) => {
    if (new URL(url, 'https://dmc.example/').pathname === '/logo-optimized.jpg') {
      return {
        ok: true,
        status: 200,
        async arrayBuffer() { return new Uint8Array([0xFF, 0xD8, 0xFF, 0xD9]).buffer; }
      };
    }
    return apiFetch(url, options);
  };
  context.DMCPptxExport = {
    async downloadPresentation(report) { pptxReports.push(report); }
  };

  await vm.runInContext("exportPptx('visuals')", context);
  await vm.runInContext("exportPptx('full')", context);
  await vm.runInContext("exportPptx('departments')", context);
  await vm.runInContext("exportPptx('patients')", context);

  assert.equal(pptxReports.length, 4);
  assert.equal(pptxReports[0].filename.endsWith('.pptx'), true);
  assert.equal(pptxReports[0].chartSlides.length, 4);
  assert.equal(pptxReports[1].rows.length, 1);
  assert.equal(pptxReports[2].rows[0][0], 'General medicine');
  assert.equal(pptxReports[3].rows.length, 2);
  assert.equal(backendState.reportExports.filter((e) => e.format === 'pptx').length, 4);
});

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const appScript = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'script.js'), 'utf8');
const appHtml = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'index.html'), 'utf8');

test('all dashboard export controls use the orange CSV actions', () => {
  assert.doesNotMatch(appHtml, /xlsx-export\.js/);
  assert.doesNotMatch(appScript, /exportExcel|\.xlsx|DMCExcelExport|Export [^`]*Excel|Excel \(/);
  assert.match(appScript, /Quick Export CSV/);
  assert.match(appScript, /Export Matrix CSV/);
  assert.match(appScript, /class="btn" onclick="exportCSV\('full'\)"/);
  assert.match(appScript, /class="btn" onclick="exportCSV\('departments'\)"/);
  assert.match(appScript, /class="btn" onclick="exportCSV\('patients'\)"/);
  assert.match(appScript, /function exportCSV\(type = 'full'\)/);
  assert.match(appScript, /link\.download = report\.filename/);
});

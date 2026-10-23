'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createWorkbook } = require('../frontend/xlsx-export.js');

const logoBytes = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'logo-optimized.jpg'));
const appScript = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'script.js'), 'utf8');
const appHtml = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'index.html'), 'utf8');

function storedFiles(workbookBytes) {
  const view = new DataView(workbookBytes.buffer, workbookBytes.byteOffset, workbookBytes.byteLength);
  const decoder = new TextDecoder();
  const files = new Map();
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034B50) {
    const checksum = view.getUint32(offset + 14, true);
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = decoder.decode(workbookBytes.subarray(nameStart, nameStart + nameLength));
    const data = workbookBytes.subarray(dataStart, dataStart + size);
    files.set(name, { checksum, data });
    offset = dataStart + size;
  }
  assert.equal(view.getUint32(offset, true), 0x02014B50);
  assert.equal(view.getUint32(workbookBytes.length - 22, true), 0x06054B50);
  return files;
}

function crc32(data) {
  let checksum = 0xFFFFFFFF;
  for (const byte of data) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      checksum = (checksum >>> 1) ^ (0xEDB88320 & -(checksum & 1));
    }
  }
  return (checksum ^ 0xFFFFFFFF) >>> 0;
}

test('builds a branded, color-formatted XLSX with summary and filterable report data', () => {
  const workbook = createWorkbook({
    headers: ['Department', 'Total Reviews', 'Satisfaction Rate (%)', 'Dissatisfaction Rate (%)', 'Comments'],
    rows: [['General & Family Care', 12, '84%', '8%', '=not-a-formula']],
    title: 'DMC Hospital — Department Performance',
    filename: 'dmc-report.xlsx',
    subtitle: 'Confidential quality-improvement report | Generated 2026-10-23 | 1 feedback submission',
    logoBytes: new Uint8Array(logoBytes)
  });
  const files = storedFiles(workbook);
  const decoder = new TextDecoder();
  const summary = decoder.decode(files.get('xl/worksheets/sheet1.xml').data);
  const report = decoder.decode(files.get('xl/worksheets/sheet2.xml').data);
  const styles = decoder.decode(files.get('xl/styles.xml').data);
  const workbookXml = decoder.decode(files.get('xl/workbook.xml').data);

  assert.equal(Buffer.compare(Buffer.from(files.get('xl/media/image1.jpg').data), logoBytes), 0);
  assert.match(workbookXml, /name="Executive Summary"/);
  assert.match(workbookXml, /name="Report Data"/);
  assert.match(summary, /DMC HOSPITAL  \|  EXECUTIVE REPORT/);
  assert.match(summary, /FEEDBACK RECORDS/);
  assert.match(report, /General &amp; Family Care/);
  assert.match(report, /t="inlineStr"><is><t xml:space="preserve">=not-a-formula/);
  assert.doesNotMatch(report, /<f>/);
  assert.match(report, /state="frozen"/);
  assert.match(report, /autoFilter ref="A6:E7"/);
  assert.match(decoder.decode(files.get('xl/drawings/drawing1.xml').data), /DMC Hospital Logo/);
  assert.match(decoder.decode(files.get('xl/drawings/drawing1.xml').data), /cx="2190750" cy="638175"/);
  assert.match(styles, /FF17263C/);
  assert.match(styles, /FFE54B2B/);
  assert.match(report, /s="9"/);
  assert.match(report, /s="10"/);
  for (const { checksum, data } of files.values()) assert.equal(crc32(data), checksum);
});

test('rejects missing report columns and a missing DMC JPEG logo', () => {
  assert.throws(() => createWorkbook({
    headers: [],
    rows: [],
    title: 'Report',
    filename: 'report.xlsx',
    subtitle: 'Subtitle',
    logoBytes: new Uint8Array(logoBytes)
  }), /column headers/);
  assert.throws(() => createWorkbook({
    headers: ['Report'],
    rows: [],
    title: 'Report',
    filename: 'report.xlsx',
    subtitle: 'Subtitle',
    logoBytes: new Uint8Array([1, 2, 3])
  }), /valid JPEG DMC logo/);
});

test('all dashboard export actions download XLSX workbooks', () => {
  assert.match(appHtml, /<script src="xlsx-export\.js"><\/script>\s*<script src="script\.js"><\/script>/);
  assert.match(appScript, /function exportExcel\(type = 'full'\)/);
  assert.match(appScript, /onclick="exportExcel\('full'\)"/);
  assert.match(appScript, /onclick="exportExcel\('departments'\)"/);
  assert.match(appScript, /onclick="exportExcel\('patients'\)"/);
  assert.match(appScript, /Quick Export XLSX/);
  assert.match(appScript, /Export Matrix XLSX/);
  assert.doesNotMatch(appScript, /exportCSV|\.csv/);
});

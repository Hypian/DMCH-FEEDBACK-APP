'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createWorkbook } = require('../frontend/xlsx-export.js');

const logoBytes = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'logo-optimized.jpg'));
const appScript = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'script.js'), 'utf8');
const appHtml = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'index.html'), 'utf8');

function readStoredZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const entries = new Map();
  let offset = 0;

  while (view.getUint32(offset, true) === 0x04034B50) {
    const checksum = view.getUint32(offset + 14, true);
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength));
    const data = bytes.subarray(dataStart, dataStart + size);
    entries.set(name, { checksum, data });
    offset = dataStart + size;
  }

  assert.equal(view.getUint32(offset, true), 0x02014B50);
  assert.equal(view.getUint32(bytes.length - 22, true), 0x06054B50);
  return entries;
}

function crc32(bytes) {
  let checksum = 0xFFFFFFFF;
  for (const byte of bytes) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      checksum = (checksum >>> 1) ^ (0xEDB88320 & -(checksum & 1));
    }
  }
  return (checksum ^ 0xFFFFFFFF) >>> 0;
}

test('creates a branded Excel workbook with readable, safely encoded report cells', () => {
  const workbook = createWorkbook({
    headers: ['Department', 'Reviews', 'Comment', 'Language', 'Cohort'],
    rows: [['General & Family Care', 12, '=HYPERLINK("https://example.com")', 'en', 'New']],
    title: 'DMC Hospital — Department Report',
    subtitle: 'Confidential quality report',
    generatedAt: 'Generated 2026-10-21',
    logoBytes
  });
  const entries = readStoredZip(workbook);
  const sheet = new TextDecoder().decode(entries.get('xl/worksheets/sheet1.xml').data);
  const drawing = new TextDecoder().decode(entries.get('xl/drawings/drawing1.xml').data);

  assert.equal(entries.get('xl/media/image1.jpg').data.length, logoBytes.length);
  assert.equal(Buffer.compare(Buffer.from(entries.get('xl/media/image1.jpg').data), logoBytes), 0);
  assert.match(sheet, /DMC Hospital — Department Report/);
  assert.match(sheet, /General &amp; Family Care/);
  assert.match(sheet, /t="inlineStr"><is><t xml:space="preserve">=HYPERLINK/);
  assert.doesNotMatch(sheet, /<f>/);
  assert.match(sheet, /state="frozen"/);
  assert.match(sheet, /dimension ref="A1:E6"/);
  assert.match(sheet, /<c r="D1" s="1"/);
  assert.ok(sheet.indexOf('<autoFilter') < sheet.indexOf('<mergeCells'));
  assert.match(sheet, /mergeCell ref="D1:E1"/);
  assert.match(sheet, /autoFilter ref="A5:E6"/);
  assert.match(drawing, /DMC Hospital Logo/);

  for (const { checksum, data } of entries.values()) {
    assert.equal(crc32(data), checksum);
  }
});

test('rejects missing or non-JPEG logos rather than producing an unbranded workbook', () => {
  assert.throws(() => createWorkbook({
    headers: ['Report'],
    rows: [],
    title: 'Report',
    subtitle: 'Subtitle',
    generatedAt: 'Today',
    logoBytes: new Uint8Array([1, 2, 3])
  }), /JPEG/);
});

test('wires all admin export actions to Excel workbooks', () => {
  assert.match(appHtml, /<script src="xlsx-export\.js"><\/script>\s*<script src="script\.js"><\/script>/);
  assert.match(appScript, /function exportExcel\(type = 'full'\)/);
  assert.match(appScript, /onclick="exportExcel\('full'\)"/);
  assert.match(appScript, /onclick="exportExcel\('departments'\)"/);
  assert.match(appScript, /onclick="exportExcel\('patients'\)"/);
  assert.match(appScript, /onclick="exportCSV\('full'\)"/);
  assert.match(appScript, /function exportCSV\(type = 'full'\)/);
  assert.match(appScript, /downloadWorkbook\(\{/);
  assert.match(appScript, /logoUrl: new URL\('logo-optimized\.jpg', document\.baseURI\)\.href/);
  assert.match(appScript, /rows = R\.map\(\(r\) =>/);
});

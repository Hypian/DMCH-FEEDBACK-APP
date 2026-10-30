'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createPresentation } = require('../frontend/pptx-export.js');

const logoBytes = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'logo-optimized.jpg'));
const appScript = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'script.js'), 'utf8');
const appHtml = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'index.html'), 'utf8');

function storedFiles(archiveBytes) {
  const view = new DataView(archiveBytes.buffer, archiveBytes.byteOffset, archiveBytes.byteLength);
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
    const name = decoder.decode(archiveBytes.subarray(nameStart, nameStart + nameLength));
    const data = archiveBytes.subarray(dataStart, dataStart + size);
    files.set(name, { checksum, data });
    offset = dataStart + size;
  }
  assert.equal(view.getUint32(offset, true), 0x02014B50);
  assert.equal(view.getUint32(archiveBytes.length - 22, true), 0x06054B50);
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

test('builds a branded 16:9 PPTX presentation with KPI overview, Donut & Bar visual slides, and data tables', () => {
  const pptxBytes = createPresentation({
    title: 'DMC Hospital — Visual Analytics & Executive Presentation',
    subtitle: 'Confidential executive presentation | Filter: All Time | Generated 2026-10-30 | 25 submissions',
    filename: 'dmc-visuals.pptx',
    logoBytes: new Uint8Array(logoBytes),
    kpis: [
      { label: 'Total Feedback', value: '25', sub: '15 New • 10 Returning', color: '#17263c' },
      { label: 'Avg Satisfaction', value: '4.4 / 5', sub: '88% Positive (4-5★)', color: '#10b981' },
      { label: 'Dissatisfied Rate', value: '8%', sub: 'Rated 1-2★', color: '#e54b2b' },
      { label: 'Delay Incidence', value: '12%', sub: '92% Full Doctor Care', color: '#f59e0b' }
    ],
    chartSlides: [
      {
        title: 'Overall Satisfaction & Patient Cohort Visuals',
        subtitle: 'Visual representation • 25 responses',
        charts: [
          {
            title: 'Overall Satisfaction Spectrum',
            subtitle: 'Distribution of 1 to 5 star patient ratings',
            chartType: 'donut',
            centerValue: '4.4/5',
            centerLabel: 'Avg Score',
            items: [
              { label: '5 ★ Very Satisfied', value: 14, color: '#10b981' },
              { label: '4 ★ Satisfied', value: 8, color: '#34d399' },
              { label: '3 ★ Neutral', value: 1, color: '#f59e0b' },
              { label: '2 ★ Dissatisfied', value: 1, color: '#f97316' },
              { label: '1 ★ Very Dissatisfied', value: 1, color: '#e54b2b' }
            ]
          },
          {
            title: 'Patient Cohort Ratio',
            subtitle: 'First-time visitors vs returning patients',
            chartType: 'bar',
            centerValue: '25',
            centerLabel: 'Total Visits',
            items: [
              { label: 'New Patients (First-Time)', value: 15, color: '#0284c7' },
              { label: 'Returning Patients', value: 10, color: '#f59e0b' }
            ]
          }
        ]
      }
    ],
    headers: ['Department / Service', 'Total Reviews', 'Satisfaction Rate (%)', 'Dissatisfaction Rate (%)'],
    rows: [
      ['General medicine', 15, '87%', '7%'],
      ['Pediatrics', 10, '90%', '10%']
    ]
  });

  const files = storedFiles(pptxBytes);
  const decoder = new TextDecoder();

  assert.equal(Buffer.compare(Buffer.from(files.get('ppt/media/image1.jpg').data), logoBytes), 0);

  const presXml = decoder.decode(files.get('ppt/presentation.xml').data);
  assert.match(presXml, /cx="12192000" cy="6858000"/);
  assert.match(presXml, /r:id="rId3"/);
  assert.match(presXml, /r:id="rId4"/);
  assert.match(presXml, /r:id="rId5"/);

  const slide1Xml = decoder.decode(files.get('ppt/slides/slide1.xml').data);
  const slide2Xml = decoder.decode(files.get('ppt/slides/slide2.xml').data);
  const slide3Xml = decoder.decode(files.get('ppt/slides/slide3.xml').data);

  assert.match(slide1Xml, /DREAM MEDICAL CENTER HOSPITAL/);
  assert.match(slide1Xml, /4\.4 \/ 5/);
  assert.match(slide2Xml, /Overall Satisfaction Spectrum/);
  assert.match(slide2Xml, /Patient Cohort Ratio/);
  assert.match(slide2Xml, /prst="pie"/);
  assert.match(slide2Xml, /prst="ellipse"/);
  assert.match(slide3Xml, /General medicine/);
  assert.match(slide3Xml, /Pediatrics/);

  for (const { checksum, data } of files.values()) {
    assert.equal(crc32(data), checksum);
  }
});

test('rejects invalid logo or empty PPTX content', () => {
  assert.throws(() => createPresentation({
    title: 'Deck',
    logoBytes: new Uint8Array([1, 2, 3]),
    kpis: [{ label: 'Total', value: '1' }]
  }), /valid JPEG DMC logo/);

  assert.throws(() => createPresentation({
    title: 'Deck',
    logoBytes: new Uint8Array(logoBytes),
    kpis: [],
    chartSlides: [],
    headers: []
  }), /at least one KPI, chart slide, or data table/);
});

test('dashboard scripts wire PPTX export and Presentation Mode controls', () => {
  assert.match(appHtml, /<script src="pptx-export\.js"><\/script>/);
  assert.match(appScript, /function exportPptx\(type = 'visuals'\)/);
  assert.match(appScript, /onclick="exportPptx\('visuals'\)"/);
  assert.match(appScript, /onclick="exportPptx\('full'\)"/);
  assert.match(appScript, /onclick="exportPptx\('departments'\)"/);
  assert.match(appScript, /onclick="exportPptx\('patients'\)"/);
  assert.match(appScript, /onclick="openPresentationMode\(\)"/);
});

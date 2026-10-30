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

test('all PPTX slide shapes, cards, legends, bars, and tables stay strictly within slide and card boundaries', () => {
  const pptxBytes = createPresentation({
    title: 'DMC Hospital — Boundary Verification Presentation With Very Long Title Text To Test Truncation',
    subtitle: 'Confidential executive presentation | Filter: Custom Range | 120 feedback submissions across 10 departments',
    badge: '120 records • All Cohorts',
    logoBytes: new Uint8Array(logoBytes),
    kpis: [
      { label: 'Total Feedback', value: '120', sub: '70 New • 50 Returning', color: '#17263c' },
      { label: 'Avg Satisfaction', value: '4.5 / 5', sub: '90% Positive (4-5★)', color: '#10b981' },
      { label: 'Dissatisfied Rate', value: '5%', sub: 'Rated 1-2★', color: '#e54b2b' },
      { label: 'Delay Incidence', value: '14%', sub: '94% Full Doctor Care', color: '#f59e0b' }
    ],
    overviewCharts: [
      {
        title: 'Overall Satisfaction Spectrum',
        subtitle: 'Distribution of 1 to 5 star patient ratings',
        chartType: 'donut',
        centerValue: '4.5/5',
        centerLabel: 'Avg Score',
        items: [
          { label: '5 ★ Very Satisfied', value: 70, color: '#10b981' },
          { label: '4 ★ Satisfied', value: 38, color: '#34d399' },
          { label: '3 ★ Neutral', value: 6, color: '#f59e0b' },
          { label: '2 ★ Dissatisfied', value: 4, color: '#f97316' },
          { label: '1 ★ Very Dissatisfied', value: 2, color: '#e54b2b' }
        ]
      },
      {
        title: 'Responses by Visited Service',
        subtitle: 'Top visited hospital departments',
        chartType: 'bar',
        centerValue: '8',
        centerLabel: 'Services',
        items: [
          { label: 'General & Family Medicine Outpatient Clinic', value: 42, color: '#10b981' },
          { label: 'Pediatrics & Child Wellness Department', value: 28, color: '#0284c7' },
          { label: 'Obstetrics & Gynecology Services', value: 19, color: '#8b5cf6' },
          { label: 'Laboratory & Diagnostic Imaging', value: 14, color: '#f59e0b' },
          { label: 'Pharmacy & Medication Dispensing', value: 10, color: '#e54b2b' },
          { label: 'Dental & Maxillofacial Surgery', value: 7, color: '#06b6d4' }
        ]
      }
    ],
    chartSlides: [
      {
        title: 'Doctor Wait Times & Clinical Care Quality',
        subtitle: 'Wait duration and doctor attentiveness',
        charts: [
          {
            title: 'Doctor Wait Time & Delays',
            subtitle: 'Duration waited prior to seeing a physician',
            chartType: 'bar',
            items: [
              { label: 'Under 15 minutes', value: 60, color: '#10b981' },
              { label: '15–30 minutes', value: 40, color: '#0284c7' },
              { label: '30–60 minutes', value: 15, color: '#f59e0b' },
              { label: 'Over 1 hour', value: 5, color: '#e54b2b' }
            ]
          },
          {
            title: 'Doctor Care & Attentiveness',
            subtitle: 'Did the doctor listen carefully?',
            chartType: 'donut',
            items: [
              { label: 'Yes, completely', value: 108, color: '#10b981' },
              { label: 'Partially', value: 8, color: '#f59e0b' },
              { label: 'No', value: 4, color: '#e54b2b' }
            ]
          }
        ]
      }
    ],
    headers: ['Department / Service', 'Reviews', 'New', 'Returning', 'Avg Score', 'Satisfied (%)', 'Dissatisfied (%)', 'Delay Rate (%)', 'Issue Rate (%)'],
    rows: Array.from({ length: 12 }, (_, idx) => [
      `Department #${idx + 1} With Long Service Name`,
      20 - idx,
      10,
      10 - idx,
      '4.50',
      '90%',
      '5%',
      '10%',
      '5%'
    ])
  });

  const files = storedFiles(pptxBytes);
  const decoder = new TextDecoder();
  const SLIDE_W = 12192000;
  const SLIDE_H = 6858000;

  for (const [fileName, fileEntry] of files.entries()) {
    if (!/^ppt\/slides\/slide\d+\.xml$/.test(fileName)) continue;
    const xml = decoder.decode(fileEntry.data);

    // Extract every named shape or graphic frame with its bounding box
    const shapeRegex = /<p:(?:cNvPr) id="\d+" name="([^"]+)"[\s\S]*?<a:xfrm><a:off x="(\d+)" y="(\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/><\/a:xfrm>/g;
    const shapes = [];
    let match;
    while ((match = shapeRegex.exec(xml)) !== null) {
      const [, name, xStr, yStr, cxStr, cyStr] = match;
      const x = Number(xStr);
      const y = Number(yStr);
      const cx = Number(cxStr);
      const cy = Number(cyStr);
      if (cx === 0 && cy === 0) continue; // root group transform
      shapes.push({ name, x, y, cx, cy });

      // 1. Every shape must be strictly within the 16:9 slide boundaries
      assert.ok(x >= 0, `${fileName} [${name}] x=${x} < 0`);
      assert.ok(y >= 0, `${fileName} [${name}] y=${y} < 0`);
      assert.ok(cx > 0, `${fileName} [${name}] cx=${cx} <= 0`);
      assert.ok(cy > 0, `${fileName} [${name}] cy=${cy} <= 0`);
      assert.ok(x + cx <= SLIDE_W, `${fileName} [${name}] x+cx=${x + cx} exceeds SLIDE_W=${SLIDE_W}`);
      assert.ok(y + cy <= SLIDE_H, `${fileName} [${name}] y+cy=${y + cy} exceeds SLIDE_H=${SLIDE_H}`);

      // 2. Body content shapes must stay within horizontal margins [320000, 11872000] and body vertical zone [1040000, 6280000]
      const isFrameShape = /^(Slide Canvas|Header Banner|Brand Accent Stripe|Logo Plate|DMC Hospital Logo|Header Title|Filter Badge|Footer Divider|Footer Banner)$/.test(name);
      if (!isFrameShape) {
        assert.ok(x >= 320000, `${fileName} [${name}] x=${x} violates left margin 320000`);
        assert.ok(x + cx <= SLIDE_W - 320000, `${fileName} [${name}] right edge ${x + cx} violates right margin ${SLIDE_W - 320000}`);
        assert.ok(y >= 1040000, `${fileName} [${name}] y=${y} overlaps header zone (< 1040000)`);
        assert.ok(y + cy <= 6280000, `${fileName} [${name}] bottom edge ${y + cy} overlaps footer zone (> 6280000)`);
      }
    }

    // 3. Verify card headings never collide with Mode Tag badges
    for (const heading of shapes.filter((s) => s.name.endsWith(' Heading'))) {
      const prefix = heading.name.slice(0, -' Heading'.length);
      const modeTag = shapes.find((s) => s.name === `${prefix} Mode Tag`);
      if (modeTag) {
        assert.ok(
          heading.x + heading.cx <= modeTag.x,
          `${fileName} [${heading.name}] right edge (${heading.x + heading.cx}) overlaps [${modeTag.name}] left edge (${modeTag.x})`
        );
      }
    }

    // 4. Verify Bar Fill never exceeds Bar Track width
    for (const fill of shapes.filter((s) => s.name.startsWith('Bar Fill '))) {
      const label = fill.name.slice('Bar Fill '.length);
      const track = shapes.find((s) => s.name === `Bar Track ${label}`);
      assert.ok(track, `Missing Bar Track for ${label}`);
      assert.equal(fill.x, track.x);
      assert.equal(fill.y, track.y);
      assert.ok(fill.cx <= track.cx, `${fileName} [${fill.name}] width ${fill.cx} > track width ${track.cx}`);
    }
  }
});


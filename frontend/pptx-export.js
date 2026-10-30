'use strict';

(function registerPresentationApi(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.DMCPptxExport = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function createPresentationApi() {
  const encoder = new TextEncoder();
  const SLIDE_W = 12192000; // 13.333 in (16:9 widescreen)
  const SLIDE_H = 6858000;  // 7.5 in
  const MARGIN_X = 320000;  // 0.35 in horizontal margin
  const CONTENT_W = SLIDE_W - MARGIN_X * 2; // 11,552,000 EMUs
  const BODY_TOP = 1040000;
  const BODY_BOTTOM = 6280000;
  const BODY_H = BODY_BOTTOM - BODY_TOP; // 5,240,000 EMUs

  const truncateText = (value, maxLen = 60) => {
    const str = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (str.length <= maxLen) return str;
    return str.slice(0, Math.max(1, maxLen - 1)).trimEnd() + '…';
  };

  const clampBox = (box) => {
    const x = Math.max(0, Math.min(SLIDE_W - 50000, Math.round(box.x || 0)));
    const y = Math.max(0, Math.min(SLIDE_H - 50000, Math.round(box.y || 0)));
    const cx = Math.max(10000, Math.min(SLIDE_W - x, Math.round(box.cx || 0)));
    const cy = Math.max(10000, Math.min(SLIDE_H - y, Math.round(box.cy || 0)));
    return { x, y, cx, cy };
  };

  const xmlEscape = (value) => String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

  const cleanHex = (color, fallback = '17263C') => {
    const raw = String(color || '').trim().replace(/^#/, '');
    if (/^[0-9A-Fa-f]{6}$/.test(raw)) return raw.toUpperCase();
    if (/^[0-9A-Fa-f]{3}$/.test(raw)) {
      return raw.split('').map((c) => c + c).join('').toUpperCase();
    }
    return fallback;
  };

  const bytes = (...parts) => {
    const output = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
    let offset = 0;
    for (const part of parts) {
      output.set(part, offset);
      offset += part.length;
    }
    return output;
  };
  const text = (value) => encoder.encode(value);
  const write16 = (view, offset, value) => view.setUint16(offset, value, true);
  const write32 = (view, offset, value) => view.setUint32(offset, value >>> 0, true);

  function crc32(data) {
    let crc = 0xFFFFFFFF;
    for (const byte of data) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) {
        crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
      }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function createZip(files) {
    const localParts = [];
    const centralParts = [];
    let localOffset = 0;
    for (const [filename, content] of files) {
      const name = text(filename);
      const data = typeof content === 'string' ? text(content) : content;
      const checksum = crc32(data);
      const localHeader = new Uint8Array(30);
      const localView = new DataView(localHeader.buffer);
      write32(localView, 0, 0x04034B50);
      write16(localView, 4, 20);
      write16(localView, 6, 0x0800);
      write16(localView, 8, 0);
      write16(localView, 10, 0);
      write16(localView, 12, 0x0021);
      write32(localView, 14, checksum);
      write32(localView, 18, data.length);
      write32(localView, 22, data.length);
      write16(localView, 26, name.length);
      localParts.push(localHeader, name, data);

      const centralHeader = new Uint8Array(46);
      const centralView = new DataView(centralHeader.buffer);
      write32(centralView, 0, 0x02014B50);
      write16(centralView, 4, 20);
      write16(centralView, 6, 20);
      write16(centralView, 8, 0x0800);
      write16(centralView, 10, 0);
      write16(centralView, 12, 0);
      write16(centralView, 14, 0x0021);
      write32(centralView, 16, checksum);
      write32(centralView, 20, data.length);
      write32(centralView, 24, data.length);
      write16(centralView, 28, name.length);
      write32(centralView, 42, localOffset);
      centralParts.push(centralHeader, name);
      localOffset += localHeader.length + name.length + data.length;
    }
    const centralDirectory = bytes(...centralParts);
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    write32(endView, 0, 0x06054B50);
    write16(endView, 8, files.length);
    write16(endView, 10, files.length);
    write32(endView, 12, centralDirectory.length);
    write32(endView, 16, localOffset);
    return bytes(bytes(...localParts), centralDirectory, end);
  }

  function shapeXml({
    id,
    name,
    x,
    y,
    cx,
    cy,
    geom = 'rect',
    adj = null,
    fill = null,
    stroke = null,
    strokeWidth = 12700,
    paragraphs = [],
    valign = 'ctr',
    wrap = 'square',
    inset = [91440, 45720, 91440, 45720]
  }) {
    const safeBox = clampBox({ x, y, cx, cy });
    const effectiveAdj = adj !== null
      ? adj
      : (geom === 'roundRect' ? { adj: 4500 } : null);
    const avLst = effectiveAdj
      ? `<a:avLst>${Object.entries(effectiveAdj).map(([k, v]) => `<a:gd name="${k}" fmla="val ${Math.round(v)}"/>`).join('')}</a:avLst>`
      : '<a:avLst/>';
    const fillXml = fill ? `<a:solidFill><a:srgbClr val="${cleanHex(fill)}"/></a:solidFill>` : '<a:noFill/>';
    const lineXml = stroke
      ? `<a:ln w="${strokeWidth}"><a:solidFill><a:srgbClr val="${cleanHex(stroke)}"/></a:solidFill></a:ln>`
      : '';
    const [lIns, tIns, rIns, bIns] = inset;
    const bodyParagraphs = paragraphs.length
      ? paragraphs.map((p) => {
          const align = p.align || 'l';
          const spcBefore = p.spaceBefore ? `<a:spcBef><a:spcPts val="${Math.round(p.spaceBefore)}"/></a:spcBef>` : '';
          const spcAfter = p.spaceAfter ? `<a:spcAft><a:spcPts val="${Math.round(p.spaceAfter)}"/></a:spcAft>` : '';
          const pPrChildren = `${spcBefore}${spcAfter}`;
          const pPr = pPrChildren ? `<a:pPr algn="${align}">${pPrChildren}</a:pPr>` : `<a:pPr algn="${align}"/>`;
          const runs = (p.runs || [{ text: p.text ?? '', size: p.size || 1200, bold: p.bold, color: p.color || '17263C' }]).map((run) => {
            const sz = Math.round(run.size || 1200);
            const b = run.bold ? ' b="1"' : '';
            const clr = cleanHex(run.color || '17263C');
            return `<a:r><a:rPr lang="en-US" sz="${sz}"${b} dirty="0"><a:solidFill><a:srgbClr val="${clr}"/></a:solidFill><a:latin typeface="Aptos"/><a:cs typeface="Aptos"/></a:rPr><a:t>${xmlEscape(run.text)}</a:t></a:r>`;
          }).join('');
          return `<a:p>${pPr}${runs}</a:p>`;
        }).join('')
      : '<a:p><a:endParaRPr lang="en-US"/></a:p>';

    return `<p:sp>
      <p:nvSpPr><p:cNvPr id="${id}" name="${xmlEscape(name || `Shape ${id}`)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
      <p:spPr>
        <a:xfrm><a:off x="${safeBox.x}" y="${safeBox.y}"/><a:ext cx="${safeBox.cx}" cy="${safeBox.cy}"/></a:xfrm>
        <a:prstGeom prst="${geom}">${avLst}</a:prstGeom>
        ${fillXml}
        ${lineXml}
      </p:spPr>
      <p:txBody>
        <a:bodyPr wrap="${wrap}" lIns="${lIns}" tIns="${tIns}" rIns="${rIns}" bIns="${bIns}" anchor="${valign}">
          <a:noAutofit/>
        </a:bodyPr>
        <a:lstStyle/>
        ${bodyParagraphs}
      </p:txBody>
    </p:sp>`;
  }

  function logoPicXml(id, x = 360000, y = 155000, cx = 1880000, cy = 540000) {
    const safeBox = clampBox({ x, y, cx, cy });
    return `<p:pic>
      <p:nvPicPr>
        <p:cNvPr id="${id}" name="DMC Hospital Logo" descr="Dream Medical Center Hospital logo"/>
        <p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>
        <p:nvPr/>
      </p:nvPicPr>
      <p:blipFill>
        <a:blip r:embed="rId2"/>
        <a:stretch><a:fillRect/></a:stretch>
      </p:blipFill>
      <p:spPr>
        <a:xfrm><a:off x="${safeBox.x}" y="${safeBox.y}"/><a:ext cx="${safeBox.cx}" cy="${safeBox.cy}"/></a:xfrm>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
      </p:spPr>
    </p:pic>`;
  }

  function renderSlideFrame(nextId, { title, subtitle, badgeText, slideNumber, totalSlides }) {
    const shapes = [];
    // Soft background canvas
    shapes.push(shapeXml({
      id: nextId(),
      name: 'Slide Canvas',
      x: 0,
      y: 0,
      cx: SLIDE_W,
      cy: SLIDE_H,
      fill: 'F6F8FB'
    }));
    // Top Navy Header Bar
    shapes.push(shapeXml({
      id: nextId(),
      name: 'Header Banner',
      x: 0,
      y: 0,
      cx: SLIDE_W,
      cy: 850000,
      fill: '17263C'
    }));
    // Brand Red Accent Line
    shapes.push(shapeXml({
      id: nextId(),
      name: 'Brand Accent Stripe',
      x: 0,
      y: 850000,
      cx: SLIDE_W,
      cy: 32000,
      fill: 'E54B2B'
    }));
    // White badge behind logo for crisp contrast
    shapes.push(shapeXml({
      id: nextId(),
      name: 'Logo Plate',
      x: MARGIN_X,
      y: 125000,
      cx: 1960000,
      cy: 600000,
      geom: 'roundRect',
      adj: { adj: 6000 },
      fill: 'FFFFFF'
    }));
    // Logo picture strictly inside Logo Plate
    shapes.push(logoPicXml(nextId(), MARGIN_X + 40000, 155000, 1880000, 540000));
    // Title & Subtitle in header (strictly bounded between Logo Plate and Filter Badge)
    shapes.push(shapeXml({
      id: nextId(),
      name: 'Header Title',
      x: MARGIN_X + 2100000,
      y: 110000,
      cx: badgeText ? 7080000 : 9452000,
      cy: 630000,
      valign: 'ctr',
      inset: [45720, 22860, 45720, 22860],
      paragraphs: [
        { text: truncateText(title || 'DMC Hospital — Executive Report', 68), size: 1750, bold: true, color: 'FFFFFF', spaceAfter: 200 },
        { text: truncateText(subtitle || 'Confidential Quality Improvement & Patient Experience Presentation', 105), size: 980, bold: false, color: 'DCE5F1' }
      ]
    }));
    // Right pill badge in header
    if (badgeText) {
      shapes.push(shapeXml({
        id: nextId(),
        name: 'Filter Badge',
        x: SLIDE_W - MARGIN_X - 2220000,
        y: 225000,
        cx: 2220000,
        cy: 400000,
        geom: 'roundRect',
        adj: { adj: 12000 },
        fill: 'E54B2B',
        inset: [45720, 22860, 45720, 22860],
        paragraphs: [
          { text: truncateText(badgeText, 28), size: 920, bold: true, color: 'FFFFFF', align: 'ctr' }
        ]
      }));
    }
    // Subtle footer divider line
    shapes.push(shapeXml({
      id: nextId(),
      name: 'Footer Divider',
      x: MARGIN_X,
      y: 6390000,
      cx: CONTENT_W,
      cy: 12700,
      fill: 'CBD5E1'
    }));
    // Footer bar
    shapes.push(shapeXml({
      id: nextId(),
      name: 'Footer Banner',
      x: MARGIN_X,
      y: 6420000,
      cx: CONTENT_W,
      cy: 300000,
      inset: [0, 22860, 0, 22860],
      paragraphs: [
        {
          runs: [
            { text: 'CONFIDENTIAL  •  DREAM MEDICAL CENTER HOSPITAL  •  QUALITY IMPROVEMENT', size: 820, bold: true, color: '64748B' },
            { text: `      |      Slide ${slideNumber} of ${totalSlides}`, size: 820, bold: false, color: '94A3B8' }
          ]
        }
      ]
    }));
    return shapes;
  }

  function renderCardShell(nextId, chart, box, modeLabel, modeFill, modeStroke, modeTextColor) {
    const shapes = [];
    const safeBox = clampBox(box);
    const headerH = 620000;

    // Outer Card Container with subtle corner radius (adj=2200 prevents corner clipping)
    shapes.push(shapeXml({
      id: nextId(),
      name: `${chart.title || 'Chart'} Card`,
      x: safeBox.x,
      y: safeBox.y,
      cx: safeBox.cx,
      cy: safeBox.cy,
      geom: 'roundRect',
      adj: { adj: 2200 },
      fill: 'FFFFFF',
      stroke: 'CBD5E1',
      strokeWidth: 12700
    }));

    // Card Header Band (strictly inside outer border)
    shapes.push(shapeXml({
      id: nextId(),
      name: `${chart.title || 'Chart'} Header Band`,
      x: safeBox.x + 15000,
      y: safeBox.y + 15000,
      cx: safeBox.cx - 30000,
      cy: headerH - 15000,
      geom: 'rect',
      fill: 'F8FAFC'
    }));

    // Card Header Divider Line
    shapes.push(shapeXml({
      id: nextId(),
      name: `${chart.title || 'Chart'} Header Divider`,
      x: safeBox.x,
      y: safeBox.y + headerH,
      cx: safeBox.cx,
      cy: 12700,
      geom: 'rect',
      fill: 'E2E8F0'
    }));

    // Card Title & Subtitle (strictly stops before the Mode Tag badge on the right)
    const badgeW = 1180000;
    const titleW = Math.max(1500000, safeBox.cx - badgeW - 440000);
    shapes.push(shapeXml({
      id: nextId(),
      name: `${chart.title || 'Chart'} Heading`,
      x: safeBox.x + 180000,
      y: safeBox.y + 55000,
      cx: titleW,
      cy: headerH - 90000,
      valign: 'ctr',
      inset: [0, 15000, 0, 15000],
      paragraphs: [
        { text: truncateText(chart.title || 'Visual Breakdown', 48), size: 1250, bold: true, color: '17263C', spaceAfter: 100 },
        ...(chart.subtitle ? [{ text: truncateText(chart.subtitle, 72), size: 860, bold: false, color: '64748B' }] : [])
      ]
    }));

    // Mode Tag Pill (DONUT CHART / BAR CHART)
    shapes.push(shapeXml({
      id: nextId(),
      name: `${chart.title || 'Chart'} Mode Tag`,
      x: safeBox.x + safeBox.cx - badgeW - 160000,
      y: safeBox.y + 170000,
      cx: badgeW,
      cy: 280000,
      geom: 'roundRect',
      adj: { adj: 14000 },
      fill: modeFill,
      stroke: modeStroke,
      inset: [25000, 15000, 25000, 15000],
      paragraphs: [{ text: modeLabel, size: 720, bold: true, color: modeTextColor, align: 'ctr' }]
    }));

    return {
      shapes,
      bodyBox: {
        x: safeBox.x + 180000,
        y: safeBox.y + headerH + 100000,
        cx: safeBox.cx - 360000,
        cy: safeBox.cy - headerH - 200000
      }
    };
  }

  function renderDonutGraphic(nextId, chart, box) {
    const items = Array.isArray(chart.items) ? chart.items : [];
    const total = items.reduce((sum, item) => sum + (Number(item.value) || 0), 0);
    const { shapes, bodyBox } = renderCardShell(
      nextId,
      chart,
      box,
      'DONUT CHART',
      'FDF1EE',
      'F5CBBF',
      'C73D20'
    );

    // Donut geometry strictly within left 42% of bodyBox
    const donutSize = Math.min(bodyBox.cy - 80000, Math.round(bodyBox.cx * 0.40), 2150000);
    const donutX = bodyBox.x + 40000;
    const donutY = bodyBox.y + Math.max(0, Math.round((bodyBox.cy - donutSize) / 2));

    // Base ring
    shapes.push(shapeXml({
      id: nextId(),
      name: 'Donut Base Ring',
      x: donutX,
      y: donutY,
      cx: donutSize,
      cy: donutSize,
      geom: 'ellipse',
      fill: 'E5EAF0'
    }));

    if (total > 0) {
      const startOrigin = 16200000; // -90 deg (12 o'clock) in 60,000ths of a degree
      let currentAngle = startOrigin;
      const fullCircle = 21600000;
      const nonZeroItems = items.filter((item) => (Number(item.value) || 0) > 0);
      if (nonZeroItems.length === 1) {
        shapes.push(shapeXml({
          id: nextId(),
          name: `Slice ${nonZeroItems[0].label}`,
          x: donutX,
          y: donutY,
          cx: donutSize,
          cy: donutSize,
          geom: 'ellipse',
          fill: nonZeroItems[0].color || 'E54B2B'
        }));
      } else {
        nonZeroItems.forEach((item, sIdx) => {
          const val = Number(item.value) || 0;
          const sweep = Math.max(60000, Math.round((val / total) * fullCircle));
          const start = currentAngle % fullCircle;
          const end = sIdx === nonZeroItems.length - 1
            ? startOrigin
            : (currentAngle + sweep) % fullCircle;
          currentAngle += sweep;
          shapes.push(shapeXml({
            id: nextId(),
            name: `Slice ${item.label}`,
            x: donutX,
            y: donutY,
            cx: donutSize,
            cy: donutSize,
            geom: 'pie',
            adj: { adj1: start, adj2: end },
            fill: item.color || 'E54B2B'
          }));
        });
      }
    }

    // Inner hole for Donut
    const holeSize = Math.round(donutSize * 0.60);
    const holeOffset = Math.round((donutSize - holeSize) / 2);
    shapes.push(shapeXml({
      id: nextId(),
      name: 'Donut Center',
      x: donutX + holeOffset,
      y: donutY + holeOffset,
      cx: holeSize,
      cy: holeSize,
      geom: 'ellipse',
      fill: 'FFFFFF',
      stroke: 'E2E8F0',
      inset: [20000, 20000, 20000, 20000],
      paragraphs: [
        { text: truncateText(String(chart.centerValue ?? total), 12), size: 1350, bold: true, color: '17263C', align: 'ctr' },
        { text: truncateText(String(chart.centerLabel || 'TOTAL').toUpperCase(), 14), size: 680, bold: true, color: '64748B', align: 'ctr' }
      ]
    }));

    // Legend rows on the right side of the donut — strictly bounded inside bodyBox
    const legendX = donutX + donutSize + 180000;
    const legendW = Math.max(1000000, bodyBox.x + bodyBox.cx - legendX);
    const visibleItems = items.slice(0, 6);
    const maxItems = Math.max(1, visibleItems.length);
    const maxRowPitch = 460000;
    const rowPitch = Math.min(maxRowPitch, Math.floor(bodyBox.cy / maxItems));
    const rowBoxH = Math.max(240000, rowPitch - 55000);
    const totalLegendH = maxItems * rowPitch - (rowPitch - rowBoxH);
    const startY = bodyBox.y + Math.max(0, Math.round((bodyBox.cy - totalLegendH) / 2));

    visibleItems.forEach((item, idx) => {
      const val = Number(item.value) || 0;
      const pct = chart.unit === '%' ? Math.min(100, Math.round(val)) : (total > 0 ? Math.round((val / total) * 100) : 0);
      const ry = startY + idx * rowPitch;

      // Bounded Legend Pill Container
      shapes.push(shapeXml({
        id: nextId(),
        name: `Legend Row ${idx + 1}`,
        x: legendX,
        y: ry,
        cx: legendW,
        cy: rowBoxH,
        geom: 'roundRect',
        adj: { adj: 6000 },
        fill: 'F8FAFC',
        stroke: 'E2E8F0'
      }));

      // Crisp Square Color Swatch inside Legend Row
      const swatchSize = Math.min(130000, rowBoxH - 80000);
      const swatchY = ry + Math.round((rowBoxH - swatchSize) / 2);
      shapes.push(shapeXml({
        id: nextId(),
        name: `Swatch ${item.label}`,
        x: legendX + 75000,
        y: swatchY,
        cx: swatchSize,
        cy: swatchSize,
        geom: 'rect',
        fill: item.color || '0284C7'
      }));

      // Single-line Label & Value inside Legend Row
      const textX = legendX + 75000 + swatchSize + 65000;
      const textW = Math.max(400000, legendX + legendW - textX - 60000);
      const metricSuffix = `${val}${chart.unit || ''}${chart.unit === '%' ? '' : ` (${pct}%)`}`;
      shapes.push(shapeXml({
        id: nextId(),
        name: `Legend ${item.label}`,
        x: textX,
        y: ry + 15000,
        cx: textW,
        cy: rowBoxH - 30000,
        valign: 'ctr',
        wrap: 'none',
        inset: [0, 0, 0, 0],
        paragraphs: [
          {
            runs: [
              { text: `${truncateText(item.label, 24)}  `, size: 860, bold: true, color: '17263C' },
              { text: `•  ${metricSuffix}`, size: 860, bold: true, color: cleanHex(item.color || '0284C7') }
            ]
          }
        ]
      }));
    });

    return shapes;
  }

  function renderBarGraphic(nextId, chart, box) {
    const items = Array.isArray(chart.items) ? chart.items : [];
    const total = items.reduce((sum, item) => sum + (Number(item.value) || 0), 0);
    const maxVal = chart.maxValue || Math.max(1, ...items.map((item) => Number(item.value) || 0));
    const { shapes, bodyBox } = renderCardShell(
      nextId,
      chart,
      box,
      'BAR CHART',
      'EFF6FF',
      'BFDBFE',
      '1D4ED8'
    );

    const visibleItems = items.slice(0, 7);
    const count = Math.max(1, visibleItems.length);
    const areaX = bodyBox.x;
    const areaW = bodyBox.cx;
    const maxRowPitch = 520000;
    const rowPitch = Math.min(maxRowPitch, Math.floor(bodyBox.cy / count));
    const totalBarsH = count * rowPitch;
    const startY = bodyBox.y + Math.max(0, Math.round((bodyBox.cy - totalBarsH) / 2));

    visibleItems.forEach((item, idx) => {
      const val = Number(item.value) || 0;
      const pct = chart.unit === '%' ? Math.min(100, Math.round(val)) : (total > 0 ? Math.round((val / total) * 100) : 0);
      const fillRatio = Math.min(1, Math.max(0, val / (maxVal || 1)));
      const ry = startY + idx * rowPitch;
      const labelH = Math.min(210000, Math.round(rowPitch * 0.50));
      const barY = ry + labelH + 10000;
      const barH = Math.max(75000, Math.min(130000, Math.round(rowPitch * 0.28)));

      // Single-line Label + Value row (never wraps onto the bar track)
      shapes.push(shapeXml({
        id: nextId(),
        name: `Bar Label ${item.label}`,
        x: areaX,
        y: ry,
        cx: areaW,
        cy: labelH,
        valign: 'ctr',
        wrap: 'none',
        inset: [0, 0, 0, 0],
        paragraphs: [
          {
            runs: [
              { text: truncateText(item.label, 38), size: 880, bold: true, color: '17263C' },
              {
                text: `   —   ${val}${chart.unit || ''}${chart.unit === '%' ? '' : ` (${pct}%)`}`,
                size: 860,
                bold: true,
                color: cleanHex(item.color || 'E54B2B')
              }
            ]
          }
        ]
      }));

      // Crisp Rectangular Bar Track (strictly bounded within areaW)
      shapes.push(shapeXml({
        id: nextId(),
        name: `Bar Track ${item.label}`,
        x: areaX,
        y: barY,
        cx: areaW,
        cy: barH,
        geom: 'rect',
        fill: 'E2E8F0'
      }));

      // Proportional Rectangular Bar Fill (clamped strictly to [0, areaW])
      if (val > 0) {
        const fillW = Math.min(areaW, Math.max(50000, Math.round(fillRatio * areaW)));
        shapes.push(shapeXml({
          id: nextId(),
          name: `Bar Fill ${item.label}`,
          x: areaX,
          y: barY,
          cx: fillW,
          cy: barH,
          geom: 'rect',
          fill: item.color || 'E54B2B'
        }));
      }
    });

    return shapes;
  }

  function renderChartBox(nextId, chart, box) {
    const mode = chart.chartType === 'bar' ? 'bar' : 'donut';
    return mode === 'bar' ? renderBarGraphic(nextId, chart, box) : renderDonutGraphic(nextId, chart, box);
  }

  function computeColumnWidths(headers, totalWidth) {
    const weights = headers.map((h) => {
      const label = String(h || '').toLowerCase();
      if (/comment|suggestion|additional/.test(label)) return 2.4;
      if (/department|service|cohort/.test(label)) return 2.1;
      if (/date|timestamp|wait|satisfaction|cleanliness|experience/.test(label)) return 1.3;
      return 0.95;
    });
    const weightSum = weights.reduce((a, b) => a + b, 0) || 1;
    const widths = weights.map((w) => Math.floor((w / weightSum) * totalWidth));
    const remainder = totalWidth - widths.reduce((a, b) => a + b, 0);
    if (widths.length > 0) widths[0] += remainder;
    return widths;
  }

  function tableGraphicXml(nextId, { headers, rows, x, y, cx, cy }) {
    const safeBox = clampBox({ x, y, cx, cy });
    const colWidths = computeColumnWidths(headers, safeBox.cx);
    const gridCols = colWidths.map((w) => `<a:gridCol w="${w}"/>`).join('');

    const headerCells = headers.map((h, cIdx) => {
      const isTextCol = cIdx === 0 || /department|service|cohort|comment/i.test(String(h));
      const align = isTextCol ? 'l' : 'ctr';
      return `<a:tc>
      <a:txBody>
        <a:bodyPr lIns="55000" tIns="30000" rIns="55000" bIns="30000" anchor="ctr"/>
        <a:lstStyle/>
        <a:p><a:pPr algn="${align}"/><a:r><a:rPr lang="en-US" sz="840" b="1" dirty="0"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:latin typeface="Aptos"/></a:rPr><a:t>${xmlEscape(truncateText(h, 30))}</a:t></a:r></a:p>
      </a:txBody>
      <a:tcPr marL="55000" marR="55000" marT="30000" marB="30000" anchor="ctr">
        <a:solidFill><a:srgbClr val="17263C"/></a:solidFill>
      </a:tcPr>
    </a:tc>`;
    }).join('');

    const bodyRows = rows.map((row, rIdx) => {
      const bg = rIdx % 2 === 0 ? 'FFFFFF' : 'F8FAFC';
      const cells = headers.map((header, cIdx) => {
        const rawVal = row[cIdx] ?? '';
        const isTextCol = cIdx === 0 || /department|service|cohort|comment/i.test(String(header));
        const maxChars = /comment/i.test(String(header)) ? 48 : (isTextCol ? 34 : 20);
        const val = truncateText(rawVal, maxChars);
        const align = isTextCol ? 'l' : 'ctr';
        let cellBg = bg;
        let textColor = '17263C';
        let isBold = cIdx === 0 ? ' b="1"' : '';
        if (/dissatisf|issue/i.test(header)) {
          cellBg = 'FFEFED';
          textColor = 'B91C1C';
          isBold = ' b="1"';
        } else if (/satisfaction rate|satisfied/i.test(header)) {
          cellBg = 'EAF5F0';
          textColor = '047857';
          isBold = ' b="1"';
        } else if (/delay/i.test(header)) {
          cellBg = 'FFF6E6';
          textColor = 'B45309';
        }
        return `<a:tc>
          <a:txBody>
            <a:bodyPr lIns="55000" tIns="25000" rIns="55000" bIns="25000" anchor="ctr"/>
            <a:lstStyle/>
            <a:p><a:pPr algn="${align}"/><a:r><a:rPr lang="en-US" sz="820"${isBold} dirty="0"><a:solidFill><a:srgbClr val="${textColor}"/></a:solidFill><a:latin typeface="Aptos"/></a:rPr><a:t>${xmlEscape(val)}</a:t></a:r></a:p>
          </a:txBody>
          <a:tcPr marL="55000" marR="55000" marT="25000" marB="25000" anchor="ctr">
            <a:solidFill><a:srgbClr val="${cellBg}"/></a:solidFill>
          </a:tcPr>
        </a:tc>`;
      }).join('');
      return `<a:tr h="410000">${cells}</a:tr>`;
    }).join('');

    const totalTableH = Math.min(safeBox.cy, 440000 + rows.length * 410000);

    return `<p:graphicFrame>
      <p:nvGraphicFramePr>
        <p:cNvPr id="${nextId()}" name="Report Data Table"/>
        <p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr>
        <p:nvPr/>
      </p:nvGraphicFramePr>
      <p:xfrm><a:off x="${safeBox.x}" y="${safeBox.y}"/><a:ext cx="${safeBox.cx}" cy="${totalTableH}"/></p:xfrm>
      <a:graphic>
        <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
          <a:tbl>
            <a:tblPr firstRow="1" bandRow="1"/>
            <a:tblGrid>${gridCols}</a:tblGrid>
            <a:tr h="440000">${headerCells}</a:tr>
            ${bodyRows}
          </a:tbl>
        </a:graphicData>
      </a:graphic>
    </p:graphicFrame>`;
  }

  function buildSlideXml(slideSpec, slideNumber, totalSlides) {
    let shapeCounter = 2;
    const nextId = () => {
      shapeCounter += 1;
      return shapeCounter;
    };

    const shapes = renderSlideFrame(nextId, {
      title: slideSpec.title,
      subtitle: slideSpec.subtitle,
      badgeText: slideSpec.badge,
      slideNumber,
      totalSlides
    });

    if (slideSpec.kind === 'overview') {
      const kpis = Array.isArray(slideSpec.kpis) ? slideSpec.kpis.slice(0, 4) : [];
      const kpiCount = Math.max(1, kpis.length);
      const kpiGap = 200000;
      const kpiW = Math.floor((CONTENT_W - kpiGap * (kpiCount - 1)) / kpiCount);
      const kpiY = BODY_TOP;
      const kpiH = 1180000;

      kpis.forEach((kpi, idx) => {
        const kx = MARGIN_X + idx * (kpiW + kpiGap);
        const accentColor = cleanHex(kpi.color || '17263C');
        // KPI Card Outer Box
        shapes.push(shapeXml({
          id: nextId(),
          name: `KPI Card ${idx + 1}`,
          x: kx,
          y: kpiY,
          cx: kpiW,
          cy: kpiH,
          geom: 'roundRect',
          adj: { adj: 4500 },
          fill: 'FFFFFF',
          stroke: 'CBD5E1',
          inset: [65000, 110000, 65000, 45000],
          paragraphs: [
            { text: truncateText(String(kpi.value ?? '–'), 18), size: 2150, bold: true, color: accentColor, align: 'ctr', spaceAfter: 80 },
            { text: truncateText(String(kpi.label || '').toUpperCase(), 26), size: 840, bold: true, color: '475569', align: 'ctr', spaceAfter: 60 },
            ...(kpi.sub ? [{ text: truncateText(String(kpi.sub), 34), size: 760, bold: false, color: '64748B', align: 'ctr' }] : [])
          ]
        }));
        // Top Accent Bar strictly inside KPI Card
        shapes.push(shapeXml({
          id: nextId(),
          name: `KPI Accent ${idx + 1}`,
          x: kx + 120000,
          y: kpiY + 45000,
          cx: kpiW - 240000,
          cy: 42000,
          geom: 'rect',
          fill: accentColor
        }));
      });

      const charts = Array.isArray(slideSpec.charts) ? slideSpec.charts : [];
      const chartTop = kpiY + kpiH + 180000; // 2,400,000
      const chartH = BODY_BOTTOM - chartTop; // 3,880,000
      if (charts.length === 1) {
        shapes.push(...renderChartBox(nextId, charts[0], {
          x: MARGIN_X,
          y: chartTop,
          cx: CONTENT_W,
          cy: chartH
        }));
      } else if (charts.length >= 2) {
        const gap = 220000;
        const cardW = Math.floor((CONTENT_W - gap) / 2);
        shapes.push(...renderChartBox(nextId, charts[0], {
          x: MARGIN_X,
          y: chartTop,
          cx: cardW,
          cy: chartH
        }));
        shapes.push(...renderChartBox(nextId, charts[1], {
          x: MARGIN_X + cardW + gap,
          y: chartTop,
          cx: cardW,
          cy: chartH
        }));
      }
    } else if (slideSpec.kind === 'charts') {
      const charts = Array.isArray(slideSpec.charts) ? slideSpec.charts : [];
      if (charts.length === 1) {
        shapes.push(...renderChartBox(nextId, charts[0], {
          x: MARGIN_X,
          y: BODY_TOP,
          cx: CONTENT_W,
          cy: BODY_H
        }));
      } else if (charts.length >= 2) {
        const gap = 220000;
        const cardW = Math.floor((CONTENT_W - gap) / 2);
        shapes.push(...renderChartBox(nextId, charts[0], {
          x: MARGIN_X,
          y: BODY_TOP,
          cx: cardW,
          cy: BODY_H
        }));
        shapes.push(...renderChartBox(nextId, charts[1], {
          x: MARGIN_X + cardW + gap,
          y: BODY_TOP,
          cx: cardW,
          cy: BODY_H
        }));
      }
    } else if (slideSpec.kind === 'table') {
      const tableHeaders = (slideSpec.headers || []).slice(0, 9);
      const tableRows = (slideSpec.rows || []).slice(0, 8).map((r) => r.slice(0, 9));
      // White Card Frame behind Data Table
      shapes.push(shapeXml({
        id: nextId(),
        name: 'Table Card Container',
        x: MARGIN_X,
        y: BODY_TOP,
        cx: CONTENT_W,
        cy: BODY_H,
        geom: 'roundRect',
        adj: { adj: 2200 },
        fill: 'FFFFFF',
        stroke: 'CBD5E1'
      }));
      shapes.push(tableGraphicXml(nextId, {
        headers: tableHeaders,
        rows: tableRows,
        x: MARGIN_X + 140000,
        y: BODY_TOP + 140000,
        cx: CONTENT_W - 280000,
        cy: BODY_H - 280000
      }));
    }

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      ${shapes.join('\n')}
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
  }

  function slideRelsXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.jpg"/>
</Relationships>`;
  }

  function themeXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="DMC Hospital Theme">
  <a:themeElements>
    <a:clrScheme name="DMC Brand">
      <a:dk1><a:srgbClr val="17263C"/></a:dk1>
      <a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="1C1410"/></a:dk2>
      <a:lt2><a:srgbClr val="F6F8FB"/></a:lt2>
      <a:accent1><a:srgbClr val="E54B2B"/></a:accent1>
      <a:accent2><a:srgbClr val="0284C7"/></a:accent2>
      <a:accent3><a:srgbClr val="10B981"/></a:accent3>
      <a:accent4><a:srgbClr val="F59E0B"/></a:accent4>
      <a:accent5><a:srgbClr val="8B5CF6"/></a:accent5>
      <a:accent6><a:srgbClr val="06B6D4"/></a:accent6>
      <a:hlink><a:srgbClr val="0284C7"/></a:hlink>
      <a:folHlink><a:srgbClr val="6D28D9"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="DMC Fonts">
      <a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
      <a:minorFont><a:latin typeface="Aptos"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="DMC Formats">
      <a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
      <a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="25400"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
      <a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
      <a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
</a:theme>`;
  }

  function slideLayoutXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">
  <p:cSld name="Blank">
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>`;
  }

  function slideMasterXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:bg><p:bgPr><a:solidFill><a:srgbClr val="F6F8FB"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
</p:sldMaster>`;
  }

  function normalizeSlides(report) {
    if (Array.isArray(report.slides) && report.slides.length > 0) {
      return report.slides;
    }
    const slides = [];
    const badge = report.badge || `${(report.rows || []).length} records`;
    const hasKpis = Array.isArray(report.kpis) && report.kpis.length > 0;
    const hasCharts = Array.isArray(report.charts) && report.charts.length > 0;
    const hasChartSlides = Array.isArray(report.chartSlides) && report.chartSlides.length > 0;

    if (hasKpis || hasCharts) {
      const overviewCharts = Array.isArray(report.overviewCharts)
        ? report.overviewCharts
        : (hasCharts ? report.charts : (hasChartSlides ? (report.chartSlides[0].charts || []) : []));
      slides.push({
        kind: 'overview',
        title: report.title || 'DMC Hospital — Executive Quality Deck',
        subtitle: report.subtitle || 'Patient Experience & Outpatient Performance Overview',
        badge,
        kpis: hasKpis ? report.kpis : [
          { label: 'Feedback Records', value: (report.rows || []).length, color: '17263C' },
          { label: 'Report Columns', value: (report.headers || []).length, color: 'E54B2B' }
        ],
        charts: overviewCharts.slice(0, 2)
      });
      if (hasCharts) {
        for (let idx = 2; idx < report.charts.length; idx += 2) {
          slides.push({
            kind: 'charts',
            title: `${report.title || 'DMC Hospital'} — Visual Analytics (${Math.floor(idx / 2) + 1})`,
            subtitle: report.subtitle || 'Proportional visual breakdown',
            badge,
            charts: report.charts.slice(idx, idx + 2)
          });
        }
      }
    }
    if (hasChartSlides) {
      report.chartSlides.forEach((cs, idx) => {
        slides.push({
          kind: 'charts',
          title: cs.title || `${report.title || 'DMC Hospital'} — Visual Analytics (${idx + 1})`,
          subtitle: cs.subtitle || report.subtitle || 'Proportional visual breakdown',
          badge,
          charts: cs.charts || []
        });
      });
    }
    if (Array.isArray(report.headers) && report.headers.length > 0 && Array.isArray(report.rows)) {
      const pageSize = 8;
      const totalRows = report.rows.length;
      if (totalRows === 0) {
        slides.push({
          kind: 'table',
          title: report.title || 'DMC Hospital — Report Table',
          subtitle: report.subtitle || 'Structured dataset view',
          badge,
          headers: report.headers,
          rows: []
        });
      } else {
        for (let offset = 0; offset < totalRows; offset += pageSize) {
          const pageNum = Math.floor(offset / pageSize) + 1;
          const totalPages = Math.ceil(totalRows / pageSize);
          slides.push({
            kind: 'table',
            title: `${report.title || 'DMC Hospital — Report Data'}${totalPages > 1 ? ` (Part ${pageNum}/${totalPages})` : ''}`,
            subtitle: report.subtitle || 'Structured dataset view',
            badge,
            headers: report.headers,
            rows: report.rows.slice(offset, offset + pageSize)
          });
        }
      }
    }
    return slides;
  }

  function createPresentation(report = {}) {
    if (!report || typeof report !== 'object') {
      throw new TypeError('A presentation report configuration object is required.');
    }
    const { logoBytes } = report;
    if (!(logoBytes instanceof Uint8Array) || logoBytes[0] !== 0xFF || logoBytes[1] !== 0xD8) {
      throw new TypeError('A valid JPEG DMC logo is required for the presentation.');
    }
    const slides = normalizeSlides(report);
    if (!slides.length) {
      throw new TypeError('A presentation requires at least one KPI, chart slide, or data table.');
    }

    const slideOverrides = slides.map((_, idx) =>
      `  <Override PartName="/ppt/slides/slide${idx + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`
    ).join('\n');

    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="jpg" ContentType="image/jpeg"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
${slideOverrides}
</Types>`;

    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`;

    const slideIdList = slides.map((_, idx) =>
      `<p:sldId id="${256 + idx}" r:id="rId${idx + 3}"/>`
    ).join('');

    const presentationXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" saveSubsetFonts="1">
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
  <p:sldIdLst>${slideIdList}</p:sldIdLst>
  <p:sldSz cx="${SLIDE_W}" cy="${SLIDE_H}" type="screen16x9"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`;

    const presSlideRels = slides.map((_, idx) =>
      `  <Relationship Id="rId${idx + 3}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${idx + 1}.xml"/>`
    ).join('\n');

    const presentationRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>
${presSlideRels}
</Relationships>`;

    const slideMasterRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`;

    const slideLayoutRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`;

    const files = [
      ['[Content_Types].xml', contentTypes],
      ['_rels/.rels', rootRels],
      ['ppt/presentation.xml', presentationXml],
      ['ppt/_rels/presentation.xml.rels', presentationRels],
      ['ppt/theme/theme1.xml', themeXml()],
      ['ppt/slideMasters/slideMaster1.xml', slideMasterXml()],
      ['ppt/slideMasters/_rels/slideMaster1.xml.rels', slideMasterRels],
      ['ppt/slideLayouts/slideLayout1.xml', slideLayoutXml()],
      ['ppt/slideLayouts/_rels/slideLayout1.xml.rels', slideLayoutRels],
      ['ppt/media/image1.jpg', logoBytes]
    ];

    slides.forEach((slideSpec, idx) => {
      const num = idx + 1;
      files.push([`ppt/slides/slide${num}.xml`, buildSlideXml(slideSpec, num, slides.length)]);
      files.push([`ppt/slides/_rels/slide${num}.xml.rels`, slideRelsXml()]);
    });

    return createZip(files);
  }

  async function downloadPresentation(report) {
    const pptxBytes = createPresentation(report);
    const url = URL.createObjectURL(new Blob([pptxBytes], {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    }));
    const link = document.createElement('a');
    link.href = url;
    link.download = report.filename || 'DMC-Hospital-Presentation.pptx';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return { createPresentation, downloadPresentation };
});

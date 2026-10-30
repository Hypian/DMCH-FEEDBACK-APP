'use strict';

(function registerPresentationApi(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.DMCPptxExport = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function createPresentationApi() {
  const encoder = new TextEncoder();
  const SLIDE_W = 12192000; // 13.333 in (16:9 widescreen)
  const SLIDE_H = 6858000;  // 7.5 in

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
    inset = [91440, 45720, 91440, 45720]
  }) {
    const avLst = adj
      ? `<a:avLst>${Object.entries(adj).map(([k, v]) => `<a:gd name="${k}" fmla="val ${Math.round(v)}"/>`).join('')}</a:avLst>`
      : '<a:avLst/>';
    const fillXml = fill ? `<a:solidFill><a:srgbClr val="${cleanHex(fill)}"/></a:solidFill>` : '<a:noFill/>';
    const lineXml = stroke
      ? `<a:ln w="${strokeWidth}"><a:solidFill><a:srgbClr val="${cleanHex(stroke)}"/></a:solidFill></a:ln>`
      : '';
    const [lIns, tIns, rIns, bIns] = inset;
    const bodyParagraphs = paragraphs.length
      ? paragraphs.map((p) => {
          const align = p.align || 'l';
          const runs = (p.runs || [{ text: p.text ?? '', size: p.size || 1200, bold: p.bold, color: p.color || '17263C' }]).map((run) => {
            const sz = Math.round(run.size || 1200);
            const b = run.bold ? ' b="1"' : '';
            const clr = cleanHex(run.color || '17263C');
            return `<a:r><a:rPr lang="en-US" sz="${sz}"${b} dirty="0"><a:solidFill><a:srgbClr val="${clr}"/></a:solidFill><a:latin typeface="Aptos"/><a:cs typeface="Aptos"/></a:rPr><a:t>${xmlEscape(run.text)}</a:t></a:r>`;
          }).join('');
          return `<a:p><a:pPr algn="${align}"/>${runs}</a:p>`;
        }).join('')
      : '<a:p><a:endParaRPr lang="en-US"/></a:p>';

    return `<p:sp>
      <p:nvSpPr><p:cNvPr id="${id}" name="${xmlEscape(name || `Shape ${id}`)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
      <p:spPr>
        <a:xfrm><a:off x="${Math.round(x)}" y="${Math.round(y)}"/><a:ext cx="${Math.round(cx)}" cy="${Math.round(cy)}"/></a:xfrm>
        <a:prstGeom prst="${geom}">${avLst}</a:prstGeom>
        ${fillXml}
        ${lineXml}
      </p:spPr>
      <p:txBody>
        <a:bodyPr wrap="square" lIns="${lIns}" tIns="${tIns}" rIns="${rIns}" bIns="${bIns}" anchor="${valign}"/>
        <a:lstStyle/>
        ${bodyParagraphs}
      </p:txBody>
    </p:sp>`;
  }

  function logoPicXml(id, x = 320000, y = 135000, cx = 1920000, cy = 560000) {
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
        <a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>
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
      cy: 860000,
      fill: '17263C'
    }));
    // Brand Red Accent Line
    shapes.push(shapeXml({
      id: nextId(),
      name: 'Brand Accent Stripe',
      x: 0,
      y: 860000,
      cx: SLIDE_W,
      cy: 36000,
      fill: 'E54B2B'
    }));
    // White badge behind logo for crisp contrast
    shapes.push(shapeXml({
      id: nextId(),
      name: 'Logo Plate',
      x: 280000,
      y: 110000,
      cx: 2000000,
      cy: 620000,
      geom: 'roundRect',
      fill: 'FFFFFF'
    }));
    // Logo picture
    shapes.push(logoPicXml(nextId(), 320000, 140000, 1920000, 560000));
    // Title & Subtitle in header
    shapes.push(shapeXml({
      id: nextId(),
      name: 'Header Title',
      x: 2450000,
      y: 95000,
      cx: 7200000,
      cy: 660000,
      valign: 'ctr',
      paragraphs: [
        { text: title || 'DMC Hospital — Executive Report', size: 1900, bold: true, color: 'FFFFFF' },
        { text: subtitle || 'Confidential Quality Improvement & Patient Experience Presentation', size: 1050, bold: false, color: 'DCE5F1' }
      ]
    }));
    // Right pill badge in header
    if (badgeText) {
      shapes.push(shapeXml({
        id: nextId(),
        name: 'Filter Badge',
        x: 9750000,
        y: 210000,
        cx: 2160000,
        cy: 420000,
        geom: 'roundRect',
        fill: 'E54B2B',
        paragraphs: [
          { text: badgeText, size: 950, bold: true, color: 'FFFFFF', align: 'ctr' }
        ]
      }));
    }
    // Footer bar
    shapes.push(shapeXml({
      id: nextId(),
      name: 'Footer Banner',
      x: 280000,
      y: 6460000,
      cx: SLIDE_W - 560000,
      cy: 280000,
      paragraphs: [
        {
          runs: [
            { text: 'CONFIDENTIAL  •  DREAM MEDICAL CENTER HOSPITAL  •  QUALITY IMPROVEMENT', size: 850, bold: true, color: '64748B' },
            { text: `      |      Slide ${slideNumber} of ${totalSlides}`, size: 850, bold: false, color: '94A3B8' }
          ]
        }
      ]
    }));
    return shapes;
  }

  function renderDonutGraphic(nextId, chart, box) {
    const shapes = [];
    const items = Array.isArray(chart.items) ? chart.items : [];
    const total = items.reduce((sum, item) => sum + (Number(item.value) || 0), 0);

    // Card container
    shapes.push(shapeXml({
      id: nextId(),
      name: `${chart.title} Card`,
      x: box.x,
      y: box.y,
      cx: box.cx,
      cy: box.cy,
      geom: 'roundRect',
      fill: 'FFFFFF',
      stroke: 'E2E8F0'
    }));

    // Card header
    shapes.push(shapeXml({
      id: nextId(),
      name: `${chart.title} Heading`,
      x: box.x + 180000,
      y: box.y + 110000,
      cx: box.cx - 360000,
      cy: 560000,
      valign: 't',
      paragraphs: [
        { text: chart.title || 'Visual Breakdown', size: 1350, bold: true, color: '17263C' },
        ...(chart.subtitle ? [{ text: chart.subtitle, size: 920, bold: false, color: '64748B' }] : [])
      ]
    }));

    // Mode tag badge (DONUT VIEW)
    shapes.push(shapeXml({
      id: nextId(),
      name: 'Chart Mode Tag',
      x: box.x + box.cx - 1380000,
      y: box.y + 130000,
      cx: 1200000,
      cy: 260000,
      geom: 'roundRect',
      fill: 'FDF1EE',
      stroke: 'F5CBBF',
      paragraphs: [{ text: 'DONUT CHART', size: 750, bold: true, color: 'C73D20', align: 'ctr' }]
    }));

    // Donut geometry area
    const donutSize = Math.min(box.cy - 1050000, Math.round(box.cx * 0.42), 2350000);
    const donutX = box.x + 220000;
    const donutY = box.y + 740000 + Math.max(0, Math.round((box.cy - 920000 - donutSize) / 2));

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
      let currentAngle = 16200000; // -90 deg (top 12 o'clock) in 60,000ths of a degree
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
        for (const item of nonZeroItems) {
          const val = Number(item.value) || 0;
          const sweep = Math.max(60000, Math.round((val / total) * fullCircle));
          const start = currentAngle % fullCircle;
          const end = (currentAngle + sweep) % fullCircle;
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
        }
      }
    }

    // Inner hole for Donut
    const holeSize = Math.round(donutSize * 0.62);
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
      stroke: 'F1F5F9',
      paragraphs: [
        { text: String(chart.centerValue ?? total), size: 1550, bold: true, color: '17263C', align: 'ctr' },
        { text: String(chart.centerLabel || 'TOTAL').toUpperCase(), size: 750, bold: true, color: '64748B', align: 'ctr' }
      ]
    }));

    // Legend on the right side of the donut
    const legendX = donutX + donutSize + 200000;
    const legendW = Math.max(1200000, box.x + box.cx - legendX - 180000);
    const maxItems = Math.min(items.length, 6);
    const rowH = Math.min(380000, Math.floor((box.cy - 860000) / Math.max(1, maxItems)));
    const startY = box.y + 740000;

    items.slice(0, maxItems).forEach((item, idx) => {
      const val = Number(item.value) || 0;
      const pct = total > 0 ? Math.round((val / total) * 100) : 0;
      const ry = startY + idx * rowH;
      // Color swatch
      shapes.push(shapeXml({
        id: nextId(),
        name: `Swatch ${item.label}`,
        x: legendX,
        y: ry + 65000,
        cx: 130000,
        cy: 130000,
        geom: 'roundRect',
        fill: item.color || '0284C7'
      }));
      // Label & count
      shapes.push(shapeXml({
        id: nextId(),
        name: `Legend ${item.label}`,
        x: legendX + 160000,
        y: ry + 10000,
        cx: legendW - 160000,
        cy: 230000,
        inset: [15000, 0, 15000, 0],
        paragraphs: [
          {
            runs: [
              { text: `${item.label}: `, size: 920, bold: true, color: '1C1410' },
              { text: `${val}${chart.unit || ''} (${pct}%)`, size: 920, bold: true, color: cleanHex(item.color || '17263C') }
            ]
          }
        ]
      }));
      // Mini progress bar track
      const trackY = ry + 235000;
      const trackW = legendW - 160000;
      if (rowH >= 300000 && trackW > 200000) {
        shapes.push(shapeXml({
          id: nextId(),
          name: `Legend Track ${idx}`,
          x: legendX + 160000,
          y: trackY,
          cx: trackW,
          cy: 55000,
          geom: 'roundRect',
          fill: 'E5EAF0'
        }));
        if (pct > 0) {
          shapes.push(shapeXml({
            id: nextId(),
            name: `Legend Fill ${idx}`,
            x: legendX + 160000,
            y: trackY,
            cx: Math.max(45000, Math.round((pct / 100) * trackW)),
            cy: 55000,
            geom: 'roundRect',
            fill: item.color || '0284C7'
          }));
        }
      }
    });

    return shapes;
  }

  function renderBarGraphic(nextId, chart, box) {
    const shapes = [];
    const items = Array.isArray(chart.items) ? chart.items : [];
    const total = items.reduce((sum, item) => sum + (Number(item.value) || 0), 0);
    const maxVal = chart.maxValue || Math.max(1, ...items.map((item) => Number(item.value) || 0));

    // Card container
    shapes.push(shapeXml({
      id: nextId(),
      name: `${chart.title} Bar Card`,
      x: box.x,
      y: box.y,
      cx: box.cx,
      cy: box.cy,
      geom: 'roundRect',
      fill: 'FFFFFF',
      stroke: 'E2E8F0'
    }));

    // Card header
    shapes.push(shapeXml({
      id: nextId(),
      name: `${chart.title} Bar Heading`,
      x: box.x + 180000,
      y: box.y + 110000,
      cx: box.cx - 1600000,
      cy: 560000,
      valign: 't',
      paragraphs: [
        { text: chart.title || 'Bar Chart Breakdown', size: 1350, bold: true, color: '17263C' },
        ...(chart.subtitle ? [{ text: chart.subtitle, size: 920, bold: false, color: '64748B' }] : [])
      ]
    }));

    // Mode tag badge (BAR CHART)
    shapes.push(shapeXml({
      id: nextId(),
      name: 'Bar Mode Tag',
      x: box.x + box.cx - 1380000,
      y: box.y + 130000,
      cx: 1200000,
      cy: 260000,
      geom: 'roundRect',
      fill: 'EFF6FF',
      stroke: 'BFDBFE',
      paragraphs: [{ text: 'BAR CHART', size: 750, bold: true, color: '1D4ED8', align: 'ctr' }]
    }));

    const visibleItems = items.slice(0, 8);
    const count = Math.max(1, visibleItems.length);
    const areaX = box.x + 200000;
    const areaY = box.y + 720000;
    const areaW = box.cx - 400000;
    const areaH = box.cy - 860000;
    const rowH = Math.min(460000, Math.floor(areaH / count));

    visibleItems.forEach((item, idx) => {
      const val = Number(item.value) || 0;
      const pct = chart.unit === '%' ? Math.min(100, Math.round(val)) : (total > 0 ? Math.round((val / total) * 100) : 0);
      const fillRatio = Math.min(1, Math.max(0, val / (maxVal || 1)));
      const ry = areaY + idx * rowH;

      // Label + Value row
      shapes.push(shapeXml({
        id: nextId(),
        name: `Bar Label ${item.label}`,
        x: areaX,
        y: ry,
        cx: areaW,
        cy: Math.round(rowH * 0.52),
        inset: [10000, 0, 10000, 0],
        paragraphs: [
          {
            runs: [
              { text: `${item.label}`, size: 950, bold: true, color: '17263C' },
              {
                text: `   —   ${val}${chart.unit || ''}${chart.unit === '%' ? '' : ` (${pct}%)`}`,
                size: 920,
                bold: true,
                color: cleanHex(item.color || 'E54B2B')
              }
            ]
          }
        ]
      }));

      // Bar Track
      const barY = ry + Math.round(rowH * 0.52);
      const barH = Math.max(85000, Math.min(150000, Math.round(rowH * 0.32)));
      shapes.push(shapeXml({
        id: nextId(),
        name: `Bar Track ${item.label}`,
        x: areaX,
        y: barY,
        cx: areaW,
        cy: barH,
        geom: 'roundRect',
        fill: 'E5EAF0'
      }));

      // Proportional Bar Fill
      if (val > 0) {
        shapes.push(shapeXml({
          id: nextId(),
          name: `Bar Fill ${item.label}`,
          x: areaX,
          y: barY,
          cx: Math.max(90000, Math.round(fillRatio * areaW)),
          cy: barH,
          geom: 'roundRect',
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

  function tableGraphicXml(nextId, { headers, rows, x, y, cx, cy }) {
    const colCount = headers.length;
    const colWidth = Math.floor(cx / Math.max(1, colCount));
    const gridCols = headers.map(() => `<a:gridCol w="${colWidth}"/>`).join('');

    const headerCells = headers.map((h) => `<a:tc>
      <a:txBody>
        <a:bodyPr lIns="65000" tIns="35000" rIns="65000" bIns="35000" anchor="ctr"/>
        <a:lstStyle/>
        <a:p><a:pPr algn="l"/><a:r><a:rPr lang="en-US" sz="900" b="1" dirty="0"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:latin typeface="Aptos"/></a:rPr><a:t>${xmlEscape(h)}</a:t></a:r></a:p>
      </a:txBody>
      <a:tcPr marL="65000" marR="65000" marT="35000" marB="35000" anchor="ctr">
        <a:solidFill><a:srgbClr val="E54B2B"/></a:solidFill>
      </a:tcPr>
    </a:tc>`).join('');

    const bodyRows = rows.map((row, rIdx) => {
      const bg = rIdx % 2 === 0 ? 'FFFFFF' : 'F8FAFC';
      const cells = headers.map((header, cIdx) => {
        const val = row[cIdx] ?? '';
        let cellBg = bg;
        let textColor = '17263C';
        if (/dissatisf|issue incidence/i.test(header)) {
          cellBg = 'FFEFED';
          textColor = 'B91C1C';
        } else if (/satisfaction rate|satisfied/i.test(header)) {
          cellBg = 'EAF5F0';
          textColor = '047857';
        } else if (/delay/i.test(header)) {
          cellBg = 'FFF6E6';
          textColor = 'B45309';
        }
        return `<a:tc>
          <a:txBody>
            <a:bodyPr lIns="65000" tIns="30000" rIns="65000" bIns="30000" anchor="ctr"/>
            <a:lstStyle/>
            <a:p><a:pPr algn="l"/><a:r><a:rPr lang="en-US" sz="850" dirty="0"><a:solidFill><a:srgbClr val="${textColor}"/></a:solidFill><a:latin typeface="Aptos"/></a:rPr><a:t>${xmlEscape(val)}</a:t></a:r></a:p>
          </a:txBody>
          <a:tcPr marL="65000" marR="65000" marT="30000" marB="30000" anchor="ctr">
            <a:solidFill><a:srgbClr val="${cellBg}"/></a:solidFill>
          </a:tcPr>
        </a:tc>`;
      }).join('');
      return `<a:tr h="360000">${cells}</a:tr>`;
    }).join('');

    return `<p:graphicFrame>
      <p:nvGraphicFramePr>
        <p:cNvPr id="${nextId()}" name="Report Data Table"/>
        <p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr>
        <p:nvPr/>
      </p:nvGraphicFramePr>
      <p:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></p:xfrm>
      <a:graphic>
        <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
          <a:tbl>
            <a:tblPr firstRow="1" bandRow="1"/>
            <a:tblGrid>${gridCols}</a:tblGrid>
            <a:tr h="400000">${headerCells}</a:tr>
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
      const kpiW = 2750000;
      const kpiGap = 210000;
      const startX = 280000;
      const kpiY = 1040000;
      const kpiH = 1150000;

      kpis.forEach((kpi, idx) => {
        const kx = startX + idx * (kpiW + kpiGap);
        shapes.push(shapeXml({
          id: nextId(),
          name: `KPI Card ${idx + 1}`,
          x: kx,
          y: kpiY,
          cx: kpiW,
          cy: kpiH,
          geom: 'roundRect',
          fill: 'FFFFFF',
          stroke: 'E2E8F0',
          paragraphs: [
            { text: String(kpi.value ?? '–'), size: 2400, bold: true, color: cleanHex(kpi.color || '17263C'), align: 'ctr' },
            { text: String(kpi.label || '').toUpperCase(), size: 880, bold: true, color: '64748B', align: 'ctr' }
          ]
        }));
      });

      const charts = Array.isArray(slideSpec.charts) ? slideSpec.charts : [];
      if (charts.length === 1) {
        shapes.push(...renderChartBox(nextId, charts[0], {
          x: 280000,
          y: 2340000,
          cx: SLIDE_W - 560000,
          cy: 3980000
        }));
      } else if (charts.length >= 2) {
        const cardW = Math.floor((SLIDE_W - 560000 - 240000) / 2);
        shapes.push(...renderChartBox(nextId, charts[0], {
          x: 280000,
          y: 2340000,
          cx: cardW,
          cy: 3980000
        }));
        shapes.push(...renderChartBox(nextId, charts[1], {
          x: 280000 + cardW + 240000,
          y: 2340000,
          cx: cardW,
          cy: 3980000
        }));
      }
    } else if (slideSpec.kind === 'charts') {
      const charts = Array.isArray(slideSpec.charts) ? slideSpec.charts : [];
      if (charts.length === 1) {
        shapes.push(...renderChartBox(nextId, charts[0], {
          x: 280000,
          y: 1040000,
          cx: SLIDE_W - 560000,
          cy: 5280000
        }));
      } else if (charts.length >= 2) {
        const cardW = Math.floor((SLIDE_W - 560000 - 240000) / 2);
        shapes.push(...renderChartBox(nextId, charts[0], {
          x: 280000,
          y: 1040000,
          cx: cardW,
          cy: 5280000
        }));
        shapes.push(...renderChartBox(nextId, charts[1], {
          x: 280000 + cardW + 240000,
          y: 1040000,
          cx: cardW,
          cy: 5280000
        }));
      }
    } else if (slideSpec.kind === 'table') {
      const tableHeaders = (slideSpec.headers || []).slice(0, 10);
      const tableRows = (slideSpec.rows || []).slice(0, 11).map((r) => r.slice(0, 10));
      shapes.push(tableGraphicXml(nextId, {
        headers: tableHeaders,
        rows: tableRows,
        x: 280000,
        y: 1060000,
        cx: SLIDE_W - 560000,
        cy: 5200000
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
      const charts = hasCharts ? report.charts : (hasChartSlides ? (report.chartSlides[0].charts || []) : []);
      slides.push({
        kind: 'overview',
        title: report.title || 'DMC Hospital — Executive Quality Deck',
        subtitle: report.subtitle || 'Patient Experience & Outpatient Performance Overview',
        badge,
        kpis: hasKpis ? report.kpis : [
          { label: 'Feedback Records', value: (report.rows || []).length, color: '17263C' },
          { label: 'Report Columns', value: (report.headers || []).length, color: 'E54B2B' }
        ],
        charts: charts.slice(0, 2)
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
      const pageSize = 10;
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

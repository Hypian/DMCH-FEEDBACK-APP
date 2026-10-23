(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.DMCExcelExport = api;
})(globalThis, function () {
  'use strict';

  const encoder = new TextEncoder();
  const spreadsheetNamespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const relationshipNamespace = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

  function xmlEscape(value) {
    return String(value)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function columnName(index) {
    let name = '';
    for (let value = index + 1; value; value = Math.floor((value - 1) / 26)) {
      name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
    }
    return name;
  }

  function cellXml(reference, value, style) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return `<c r="${reference}" s="${style}" t="n"><v>${value}</v></c>`;
    }
    return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value ?? '')}</t></is></c>`;
  }

  function worksheetXml({ headers, rows, title, subtitle, generatedAt, widths }) {
    const lastColumn = columnName(headers.length - 1);
    const metadataEndColumn = headers.length >= 4 ? lastColumn : 'D';
    const dimensionEndColumn = headers.length >= 4 ? lastColumn : 'D';
    const lastRow = rows.length + 5;
    const outputRows = [
      `<row r="1" ht="40" customHeight="1">${cellXml('D1', title, 1)}</row>`,
      `<row r="2" ht="24" customHeight="1">${cellXml('D2', subtitle, 2)}</row>`,
      `<row r="3" ht="18" customHeight="1">${cellXml('D3', generatedAt, 2)}</row>`,
      '<row r="4" ht="8" customHeight="1"/>',
      `<row r="5" ht="34" customHeight="1">${headers.map((header, index) => cellXml(`${columnName(index)}5`, header, 3)).join('')}</row>`
    ];

    rows.forEach((row, rowIndex) => {
      const excelRow = rowIndex + 6;
      const style = rowIndex % 2 === 0 ? 4 : 5;
      const wrappedLines = row.reduce((maxLines, value, columnIndex) =>
        Math.max(maxLines, Math.ceil(String(value ?? '').length / Math.max(12, widths[columnIndex] * 1.15))), 1);
      const height = Math.min(120, Math.max(22, 15 * wrappedLines + 7));
      outputRows.push(`<row r="${excelRow}" ht="${height}" customHeight="1">${headers.map((_header, columnIndex) =>
        cellXml(`${columnName(columnIndex)}${excelRow}`, row[columnIndex], style)
      ).join('')}</row>`);
    });

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${spreadsheetNamespace}" xmlns:r="${relationshipNamespace}">
  <sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
  <dimension ref="A1:${dimensionEndColumn}${lastRow}"/>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="5" topLeftCell="A6" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('')}</cols>
  <sheetData>${outputRows.join('')}</sheetData>
  <autoFilter ref="A5:${lastColumn}${lastRow}"/>
  ${headers.length >= 4 ? `<mergeCells count="2"><mergeCell ref="D1:${metadataEndColumn}1"/><mergeCell ref="D2:${metadataEndColumn}2"/></mergeCells>` : ''}
  <pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
  <pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>
  <drawing r:id="rId1"/>
</worksheet>`;
  }

  function stylesXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${spreadsheetNamespace}">
  <fonts count="4">
    <font><sz val="10"/><name val="Aptos"/></font>
    <font><b/><sz val="18"/><color rgb="FFFFFFFF"/><name val="Aptos Display"/></font>
    <font><sz val="10"/><color rgb="FF78655D"/><name val="Aptos"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font>
  </fonts>
  <fills count="6">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1C1410"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFDF1EE"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE54B2B"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="hair"><color rgb="FFEAE2DC"/></left><right style="hair"><color rgb="FFEAE2DC"/></right><top style="hair"><color rgb="FFEAE2DC"/></top><bottom style="hair"><color rgb="FFEAE2DC"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="6">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="5" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
  }

  function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) {
        crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
      }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function concatenate(parts) {
    const length = parts.reduce((total, part) => total + part.length, 0);
    const result = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      result.set(part, offset);
      offset += part.length;
    }
    return result;
  }

  function zipFiles(files) {
    const localParts = [];
    const centralParts = [];
    let localOffset = 0;
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
    const dosDate = ((Math.max(1980, now.getFullYear()) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

    for (const file of files) {
      const name = encoder.encode(file.name);
      const data = typeof file.data === 'string' ? encoder.encode(file.data) : file.data;
      const checksum = crc32(data);
      const localHeader = new Uint8Array(30 + name.length);
      const localView = new DataView(localHeader.buffer);
      localView.setUint32(0, 0x04034B50, true);
      localView.setUint16(4, 20, true);
      localView.setUint16(6, 0x0800, true);
      localView.setUint16(8, 0, true);
      localView.setUint16(10, dosTime, true);
      localView.setUint16(12, dosDate, true);
      localView.setUint32(14, checksum, true);
      localView.setUint32(18, data.length, true);
      localView.setUint32(22, data.length, true);
      localView.setUint16(26, name.length, true);
      localHeader.set(name, 30);
      localParts.push(localHeader, data);

      const centralHeader = new Uint8Array(46 + name.length);
      const centralView = new DataView(centralHeader.buffer);
      centralView.setUint32(0, 0x02014B50, true);
      centralView.setUint16(4, 20, true);
      centralView.setUint16(6, 20, true);
      centralView.setUint16(8, 0x0800, true);
      centralView.setUint16(10, 0, true);
      centralView.setUint16(12, dosTime, true);
      centralView.setUint16(14, dosDate, true);
      centralView.setUint32(16, checksum, true);
      centralView.setUint32(20, data.length, true);
      centralView.setUint32(24, data.length, true);
      centralView.setUint16(28, name.length, true);
      centralView.setUint32(42, localOffset, true);
      centralHeader.set(name, 46);
      centralParts.push(centralHeader);
      localOffset += localHeader.length + data.length;
    }

    const centralDirectory = concatenate(centralParts);
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054B50, true);
    endView.setUint16(8, files.length, true);
    endView.setUint16(10, files.length, true);
    endView.setUint32(12, centralDirectory.length, true);
    endView.setUint32(16, localOffset, true);
    return concatenate([...localParts, centralDirectory, end]);
  }

  function workbookRelationships() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="${relationshipNamespace}/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="${relationshipNamespace}/styles" Target="styles.xml"/>
</Relationships>`;
  }

  function drawingXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${relationshipNamespace}">
  <xdr:oneCellAnchor>
    <xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:ext cx="1463040" cy="425580"/>
    <xdr:pic>
      <xdr:nvPicPr><xdr:cNvPr id="2" name="DMC Hospital Logo"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>
      <xdr:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>
      <xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1463040" cy="425580"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>
    </xdr:pic>
    <xdr:clientData/>
  </xdr:oneCellAnchor>
</xdr:wsDr>`;
  }

  function createWorkbook({ headers, rows, title, subtitle, generatedAt, logoBytes }) {
    if (!Array.isArray(headers) || headers.length === 0 || !Array.isArray(rows)) {
      throw new TypeError('An Excel workbook requires column headers and rows.');
    }
    if (rows.length > 1048570 || headers.length > 16384) {
      throw new RangeError('The report is larger than the Excel worksheet limit.');
    }
    if (!(logoBytes instanceof Uint8Array) || logoBytes.length < 3 ||
        logoBytes[0] !== 0xFF || logoBytes[1] !== 0xD8 || logoBytes[2] !== 0xFF) {
      throw new TypeError('The DMC logo must be available as a JPEG image.');
    }

    const widths = headers.map((header, columnIndex) => {
      const sample = rows.slice(0, 200).reduce((max, row) =>
        Math.max(max, String(row[columnIndex] ?? '').length), String(header).length);
      return Math.min(48, Math.max(14, sample + 2));
    });
    const sheet = worksheetXml({ headers, rows, title, subtitle, generatedAt, widths });
    const files = [
      { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="jpg" ContentType="image/jpeg"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>
</Types>` },
      { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="${relationshipNamespace}/officeDocument" Target="xl/workbook.xml"/>
</Relationships>` },
      { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${spreadsheetNamespace}" xmlns:r="${relationshipNamespace}">
  <sheets><sheet name="DMC Report" sheetId="1" r:id="rId1"/></sheets>
</workbook>` },
      { name: 'xl/_rels/workbook.xml.rels', data: workbookRelationships() },
      { name: 'xl/styles.xml', data: stylesXml() },
      { name: 'xl/worksheets/sheet1.xml', data: sheet },
      { name: 'xl/worksheets/_rels/sheet1.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="${relationshipNamespace}/drawing" Target="../drawings/drawing1.xml"/>
</Relationships>` },
      { name: 'xl/drawings/drawing1.xml', data: drawingXml() },
      { name: 'xl/drawings/_rels/drawing1.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.jpg"/>
</Relationships>` },
      { name: 'xl/media/image1.jpg', data: logoBytes }
    ];

    return zipFiles(files);
  }

  async function downloadWorkbook({ headers, rows, title, subtitle, filename, logoUrl }) {
    const response = await fetch(logoUrl);
    if (!response.ok) throw new Error(`Could not load the DMC logo (HTTP ${response.status}).`);
    const logoBytes = new Uint8Array(await response.arrayBuffer());
    const generatedAt = `Generated ${new Date().toISOString().slice(0, 10)}`;
    const workbook = createWorkbook({ headers, rows, title, subtitle, generatedAt, logoBytes });
    const url = URL.createObjectURL(new Blob([workbook], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return { createWorkbook, downloadWorkbook };
});

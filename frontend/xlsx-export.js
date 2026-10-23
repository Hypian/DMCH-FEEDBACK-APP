'use strict';

(function registerWorkbookApi(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.DMCExcelExport = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function createWorkbookApi() {
  const encoder = new TextEncoder();
  const xmlEscape = (value) => String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
  const columnName = (number) => {
    let name = '';
    for (let value = number + 1; value > 0; value = Math.floor((value - 1) / 26)) {
      name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
    }
    return name;
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

  function columnWidths(headers, rows) {
    return headers.map((header, index) => {
      const headerWidth = String(header).length;
      const valueWidth = rows.slice(0, 30).reduce((maximum, row) => {
        const value = row[index];
        return Math.max(maximum, value == null ? 0 : String(value).split(/\r?\n/)[0].length);
      }, 0);
      const width = Math.max(12, Math.min(48, Math.max(headerWidth, valueWidth) + 2));
      if (/comment|suggestion|additional services|locations/i.test(header)) return Math.min(54, Math.max(30, width));
      if (/timestamp|date & time/i.test(header)) return Math.max(width, 23);
      if (/submission id/i.test(header)) return Math.max(width, 38);
      return width;
    });
  }

  function reportKind(title) {
    if (/department performance/i.test(title)) return 'Department performance';
    if (/cohort/i.test(title)) return 'Patient cohort summary';
    return 'Complete feedback dataset';
  }

  function cellsForRow(values, rowNumber, styles = [], header = false) {
    return values.map((value, index) => {
      const reference = `${columnName(index)}${rowNumber}`;
      const style = styles[index] || (header ? 3 : rowNumber % 2 === 0 ? 5 : 4);
      if (typeof value === 'number' && Number.isFinite(value)) {
        return `<c r="${reference}" s="${style}"><v>${value}</v></c>`;
      }
      const content = xmlEscape(value);
      return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${content}</t></is></c>`;
    }).join('');
  }

  function drawingXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <xdr:oneCellAnchor>
    <xdr:from><xdr:col>0</xdr:col><xdr:colOff>70000</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>25000</xdr:rowOff></xdr:from>
    <xdr:ext cx="2190750" cy="638175"/>
    <xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="DMC Hospital Logo" descr="Dream Medical Center Hospital logo"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>
    <xdr:clientData/>
  </xdr:oneCellAnchor>
</xdr:wsDr>`;
  }

  function worksheetXml({ rows, widths, merges, freezeRows = 0, drawing = true, autoFilter }) {
    const lastColumn = columnName(Math.max(0, widths.length - 1));
    const lastRow = Math.max(1, rows.length);
    const columns = widths.map((width, index) =>
      `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`
    ).join('');
    const mergeXml = merges.length
      ? `<mergeCells count="${merges.length}">${merges.map((range) => `<mergeCell ref="${range}"/>`).join('')}</mergeCells>`
      : '';
    const filterXml = autoFilter ? `<autoFilter ref="${autoFilter}"/>` : '';
    const drawingRef = drawing ? '<drawing r:id="rId1"/>' : '';
    const freeze = freezeRows
      ? `<pane ySplit="${freezeRows}" topLeftCell="A${freezeRows + 1}" activePane="bottomLeft" state="frozen"/>`
      : '';
    const rowXml = rows.map(({ number, height, cells }) =>
      `<row r="${number}"${height ? ` ht="${height}" customHeight="1"` : ''}>${cells}</row>`
    ).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetViews><sheetView workbookViewId="0" showGridLines="0">${freeze}</sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="20"/><cols>${columns}</cols><sheetData>${rowXml}</sheetData>${filterXml}${mergeXml}${drawingRef}
</worksheet>`;
  }

  function stylesXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="6">
    <font><sz val="10"/><color rgb="FF253247"/><name val="Aptos"/><family val="2"/></font>
    <font><b/><sz val="19"/><color rgb="FFFFFFFF"/><name val="Aptos Display"/><family val="2"/></font>
    <font><sz val="10"/><color rgb="FFDCE5F1"/><name val="Aptos"/><family val="2"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Aptos"/><family val="2"/></font>
    <font><b/><sz val="10"/><color rgb="FF253247"/><name val="Aptos"/><family val="2"/></font>
    <font><b/><sz val="16"/><color rgb="FFE54B2B"/><name val="Aptos Display"/><family val="2"/></font>
  </fonts>
  <fills count="9">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF17263C"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE54B2B"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFF1EC"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF5F7FA"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEAF5F0"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFEFED"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFF6E6"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="hair"><color rgb="FFE5EAF0"/></left><right style="hair"><color rgb="FFE5EAF0"/></right><top style="hair"><color rgb="FFE5EAF0"/></top><bottom style="hair"><color rgb="FFE5EAF0"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="12">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="3" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="5" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="6" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="7" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="8" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
  }

  function sheetRelations() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>
</Relationships>`;
  }

  function drawingRelations() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.jpg"/>
</Relationships>`;
  }

  function createWorkbook({ headers, rows, title, filename, subtitle, logoBytes }) {
    if (!Array.isArray(headers) || headers.length === 0 || !Array.isArray(rows)) {
      throw new TypeError('An Excel workbook requires column headers and rows.');
    }
    if (!(logoBytes instanceof Uint8Array) || logoBytes[0] !== 0xFF || logoBytes[1] !== 0xD8) {
      throw new TypeError('A valid JPEG DMC logo is required for the workbook.');
    }
    if (rows.length > 1048570 || headers.length > 16384) {
      throw new RangeError('The report is larger than the Excel worksheet limit.');
    }

    const widths = columnWidths(headers, rows);
    const lastColumn = columnName(headers.length - 1);
    const bannerEnd = columnName(Math.max(headers.length - 1, 9));
    const dataRows = [
      { number: 1, height: 30, cells: `<c r="C1" s="1" t="inlineStr"><is><t>${xmlEscape(title)}</t></is></c>` },
      { number: 2, height: 13, cells: '' },
      { number: 3, height: 24, cells: `<c r="C3" s="2" t="inlineStr"><is><t>${xmlEscape(subtitle)}</t></is></c>` },
      { number: 4, height: 21, cells: `<c r="C4" s="8" t="inlineStr"><is><t>CONFIDENTIAL  •  DREAM MEDICAL CENTER HOSPITAL</t></is></c>` },
      { number: 5, height: 9, cells: '' },
      { number: 6, height: 34, cells: cellsForRow(headers, 6, headers.map((_header, index) => {
        if (/dissatisf|issue incidence/i.test(headers[index])) return 10;
        if (/satisfaction rate|satisfied reviews/i.test(headers[index])) return 9;
        if (/delay incidence/i.test(headers[index])) return 11;
        return 3;
      }), true) }
    ];
    rows.forEach((row, index) => {
      const styles = headers.map((header) => {
        if (/dissatisf|issue incidence/i.test(header)) return 10;
        if (/satisfaction rate|satisfied reviews/i.test(header)) return 9;
        if (/delay incidence/i.test(header)) return 11;
        return 0;
      });
      const xml = cellsForRow(row, index + 7, styles);
      dataRows.push({ number: index + 7, height: 30, cells: xml });
    });
    const dataSheet = worksheetXml({
      rows: dataRows,
      widths: [25, 23, ...widths.slice(2)],
      merges: [`C1:${bannerEnd}1`, `C3:${bannerEnd}3`, `C4:${bannerEnd}4`],
      freezeRows: 6,
      autoFilter: `A6:${lastColumn}${Math.max(6, rows.length + 6)}`
    });

    const summaryWidths = [22, 22, 22, 22, 22, 22, 22, 22, 22, 22];
    const summaryRows = [
      { number: 1, height: 30, cells: `<c r="C1" s="1" t="inlineStr"><is><t>DMC HOSPITAL  |  EXECUTIVE REPORT</t></is></c>` },
      { number: 2, height: 13, cells: '' },
      { number: 3, height: 24, cells: `<c r="C3" s="2" t="inlineStr"><is><t>${xmlEscape(title)}</t></is></c>` },
      { number: 4, height: 21, cells: `<c r="C4" s="8" t="inlineStr"><is><t>CONFIDENTIAL  •  DREAM MEDICAL CENTER HOSPITAL</t></is></c>` },
      { number: 5, height: 12, cells: '' },
      { number: 6, height: 25, cells: `<c r="A6" s="6" t="inlineStr"><is><t>FEEDBACK RECORDS</t></is></c><c r="D6" s="6" t="inlineStr"><is><t>REPORT FIELDS</t></is></c><c r="G6" s="6" t="inlineStr"><is><t>REPORT TYPE</t></is></c>` },
      { number: 7, height: 44, cells: `<c r="A7" s="7"><v>${rows.length}</v></c><c r="D7" s="7"><v>${headers.length}</v></c><c r="G7" s="7" t="inlineStr"><is><t>${xmlEscape(reportKind(title))}</t></is></c>` },
      { number: 8, height: 12, cells: '' },
      { number: 9, height: 28, cells: `<c r="A9" s="1" t="inlineStr"><is><t>REPORT NOTES</t></is></c>` },
      { number: 10, height: 34, cells: `<c r="A10" s="4" t="inlineStr"><is><t>${xmlEscape(subtitle)}</t></is></c>` },
      { number: 11, height: 30, cells: `<c r="A11" s="5" t="inlineStr"><is><t>Open the “Report Data” worksheet for the complete, filterable dataset. Header rows are frozen for easy review; the branded table includes alternating row shading and color-coded performance measures where applicable.</t></is></c>` },
      { number: 12, height: 28, cells: `<c r="A12" s="8" t="inlineStr"><is><t>Generated ${xmlEscape(new Date().toLocaleString())}  •  DMC quality improvement</t></is></c>` }
    ];
    const summarySheet = worksheetXml({
      rows: summaryRows,
      widths: summaryWidths,
      merges: ['A1:B4', 'C1:J1', 'C3:J3', 'C4:J4', 'A6:C6', 'D6:F6', 'G6:J6', 'A7:C7', 'D7:F7', 'G7:J7', 'A9:J9', 'A10:J10', 'A11:J11', 'A12:J12'],
      drawing: true
    });

    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="jpg" ContentType="image/jpeg"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>
  <Override PartName="/xl/drawings/drawing2.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>
</Types>`;
    const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <bookViews><workbookView/></bookViews><sheets><sheet name="Executive Summary" sheetId="1" r:id="rId1"/><sheet name="Report Data" sheetId="2" r:id="rId2"/></sheets><calcPr calcId="191029"/>
</workbook>`;
    const workbookRelations = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
    const rootRelations = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
    const files = [
      ['[Content_Types].xml', contentTypes],
      ['_rels/.rels', rootRelations],
      ['xl/workbook.xml', workbook],
      ['xl/_rels/workbook.xml.rels', workbookRelations],
      ['xl/styles.xml', stylesXml()],
      ['xl/worksheets/sheet1.xml', summarySheet],
      ['xl/worksheets/sheet2.xml', dataSheet],
      ['xl/worksheets/_rels/sheet1.xml.rels', sheetRelations()],
      ['xl/worksheets/_rels/sheet2.xml.rels', sheetRelations()],
      ['xl/drawings/drawing1.xml', drawingXml()],
      ['xl/drawings/drawing2.xml', drawingXml()],
      ['xl/drawings/_rels/drawing1.xml.rels', drawingRelations()],
      ['xl/drawings/_rels/drawing2.xml.rels', drawingRelations()],
      ['xl/media/image1.jpg', logoBytes]
    ];
    if (files.length > 65535) throw new RangeError('The report has too many workbook components.');
    return createZip(files);
  }

  async function downloadWorkbook(report) {
    const workbook = createWorkbook(report);
    const url = URL.createObjectURL(new Blob([workbook], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }));
    const link = document.createElement('a');
    link.href = url;
    link.download = report.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return { createWorkbook, downloadWorkbook };
});

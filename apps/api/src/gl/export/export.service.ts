import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { type DigitStyle, pickText, type ReportDocument, type ReportLanguage, toMoney } from '@erp/shared';
import ExcelJS from 'exceljs';
import { type Browser, chromium } from 'playwright-core';
import { config } from '../../config';
import { cellText, layoutColumns, renderReportHtml } from './report-html';

/** Finds a Chromium binary when CHROMIUM_PATH is not configured. */
const detectChromium = (): string | undefined => {
  if (config.chromiumPath) return config.chromiumPath;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  if (existsSync(root)) {
    for (const dir of readdirSync(root).filter((d) => d.startsWith('chromium-')).sort().reverse()) {
      for (const sub of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
        const candidate = join(root, dir, sub);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find((p) => existsSync(p));
};

@Injectable()
export class ExportService implements OnModuleDestroy {
  private readonly logger = new Logger(ExportService.name);
  private browser: Promise<Browser> | null = null;

  async pdf(doc: ReportDocument, lang: ReportLanguage, digits: DigitStyle): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(renderReportHtml(doc, lang, digits), { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      return await page.pdf({
        printBackground: true,
        preferCSSPageSize: true,
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate:
          '<div style="width:100%;font-size:7pt;color:#8792a0;text-align:center"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
      });
    } finally {
      await page.close();
    }
  }

  async xlsx(doc: ReportDocument, lang: ReportLanguage, digits: DigitStyle): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.created = new Date(doc.generatedAt);
    const titleLocale = lang === 'en' ? 'en' : 'ar';
    const sheet = workbook.addWorksheet(pickText(doc.title, titleLocale).slice(0, 31), {
      views: [{ rightToLeft: lang !== 'en', state: 'frozen', ySplit: 4 + doc.subtitle.length }],
    });
    const columns = layoutColumns(doc, lang);
    const text = (v: { ar: string; en: string }) => (lang === 'both' ? `${v.ar} / ${v.en}` : pickText(v, lang));

    sheet.addRow([text(doc.company)]).font = { bold: true, size: 13 };
    sheet.addRow([text(doc.title)]).font = { bold: true, size: 12, color: { argb: 'FF1F4E79' } };
    for (const s of doc.subtitle) sheet.addRow([text(s)]);
    sheet.addRow([]);
    const header = sheet.addRow(columns.map((c) => c.label));
    header.font = { bold: true };
    header.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF3F8' } };
      cell.border = { bottom: { style: 'thin' } };
    });

    const numberFormat = `#,##0${doc.minorUnits > 0 ? `.${'0'.repeat(doc.minorUnits)}` : ''};(#,##0${doc.minorUnits > 0 ? `.${'0'.repeat(doc.minorUnits)}` : ''})`;
    for (const row of doc.rows) {
      const values = columns.map((rc) => {
        const raw = row.cells[rc.column.key];
        if (rc.column.kind === 'amount') return typeof raw === 'string' ? toMoney(raw).toNumber() : null;
        return cellText(raw, rc, doc, lang, digits);
      });
      const added = sheet.addRow(values);
      columns.forEach((rc, i) => {
        const cell = added.getCell(i + 1);
        if (rc.column.kind === 'amount') cell.numFmt = numberFormat;
        if (i <= 1 && row.level) cell.alignment = { indent: row.level };
      });
      if (row.style && row.style !== 'normal') added.font = { bold: true };
      if (row.style === 'grandTotal' || row.style === 'total') {
        added.eachCell((cell) => (cell.border = { top: { style: 'thin' }, bottom: { style: 'double' } }));
      }
    }
    sheet.addRow([]);
    for (const n of doc.notes) sheet.addRow([text(n)]).font = { italic: true, color: { argb: 'FF4A5560' } };
    columns.forEach((rc, i) => {
      sheet.getColumn(i + 1).width = rc.column.width ?? (rc.column.kind === 'amount' ? 18 : 14);
    });
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  private getBrowser(): Promise<Browser> {
    if (!this.browser) {
      const executablePath = detectChromium();
      this.logger.log(`Launching Chromium for PDF export (${executablePath ?? 'playwright default'})`);
      this.browser = chromium.launch({ executablePath, args: ['--no-sandbox'] }).catch((error: unknown) => {
        this.browser = null;
        throw error;
      });
    }
    return this.browser;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.browser) await (await this.browser).close().catch(() => undefined);
  }
}

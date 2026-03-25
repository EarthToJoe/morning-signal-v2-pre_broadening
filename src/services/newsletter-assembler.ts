import mjml2html from 'mjml';
import { convert } from 'html-to-text';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createCorrelatedLogger } from '../utils/logger';
import { config } from '../config';
import { WrittenNewsletter, AssembledNewsletter } from '../types';

export interface NewsletterTheme {
  headerColor: string;
  accentColor: string;
  backgroundColor: string;
  cardColor: string;
  textColor: string;
  footerColor: string;
  fontFamily: string;
}

export const DEFAULT_THEME: NewsletterTheme = {
  headerColor: '#0f3460',
  accentColor: '#0f3460',
  backgroundColor: '#f4f4f8',
  cardColor: '#ffffff',
  textColor: '#1a1a2e',
  footerColor: '#1a1a2e',
  fontFamily: "Georgia, 'Times New Roman', serif",
};

export const PRESET_THEMES: Record<string, NewsletterTheme> = {
  'professional-dark': {
    headerColor: '#0f3460', accentColor: '#0f3460', backgroundColor: '#f4f4f8',
    cardColor: '#ffffff', textColor: '#1a1a2e', footerColor: '#1a1a2e',
    fontFamily: "Georgia, 'Times New Roman', serif",
  },
  'clean-light': {
    headerColor: '#2563eb', accentColor: '#2563eb', backgroundColor: '#f8fafc',
    cardColor: '#ffffff', textColor: '#334155', footerColor: '#1e293b',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
  'bold-crimson': {
    headerColor: '#991b1b', accentColor: '#dc2626', backgroundColor: '#fef2f2',
    cardColor: '#ffffff', textColor: '#1f2937', footerColor: '#450a0a',
    fontFamily: "Georgia, 'Times New Roman', serif",
  },
  'modern-slate': {
    headerColor: '#334155', accentColor: '#6366f1', backgroundColor: '#f1f5f9',
    cardColor: '#ffffff', textColor: '#1e293b', footerColor: '#0f172a',
    fontFamily: "'Inter', -apple-system, sans-serif",
  },
  'warm-earth': {
    headerColor: '#78350f', accentColor: '#92400e', backgroundColor: '#fefce8',
    cardColor: '#ffffff', textColor: '#422006', footerColor: '#78350f',
    fontFamily: "Georgia, 'Times New Roman', serif",
  },
};

export class NewsletterAssemblerService {
  private templatePath: string;

  constructor(templatePath?: string) {
    this.templatePath = templatePath || join(__dirname, '..', 'templates', 'newsletter.mjml');
  }

  async assemble(
    writtenNewsletter: WrittenNewsletter,
    subjectLine: string,
    editionNumber: number,
    editionDate: string,
    correlationId: string,
    theme?: Partial<NewsletterTheme>
  ): Promise<AssembledNewsletter> {
    const log = createCorrelatedLogger(correlationId, 'newsletter-assembler');
    const t = { ...DEFAULT_THEME, ...theme };

    log.info('Assembling newsletter', { editionNumber, editionDate, subjectLine });

    const quickHitsHtml = writtenNewsletter.quickHits.map(qh =>
      `<mj-text font-size="18px" font-weight="bold" padding-top="16px">${qh.headline}</mj-text>\n` +
      `<mj-text padding-top="4px">${qh.htmlContent}</mj-text>`
    ).join('\n');

    const watchListHtml = writtenNewsletter.watchList.map(wl =>
      `<mj-text font-size="16px" font-weight="bold" padding-top="12px">${wl.headline}</mj-text>\n` +
      `<mj-text padding-top="4px">${wl.htmlContent}</mj-text>`
    ).join('\n');

    let mjmlTemplate: string;
    try {
      mjmlTemplate = readFileSync(this.templatePath, 'utf-8');
    } catch (err: any) {
      log.warn('MJML template not found, using inline fallback', { error: err.message });
      mjmlTemplate = this.getFallbackTemplate();
    }

    const populated = mjmlTemplate
      .replace(/\{\{newsletterName\}\}/g, config.newsletterName)
      .replace(/\{\{editionNumber\}\}/g, String(editionNumber))
      .replace(/\{\{editionDate\}\}/g, editionDate)
      .replace(/\{\{leadStoryHeadline\}\}/g, writtenNewsletter.leadStory.headline)
      .replace(/\{\{leadStoryContent\}\}/g, writtenNewsletter.leadStory.htmlContent)
      .replace(/\{\{quickHitsContent\}\}/g, quickHitsHtml)
      .replace(/\{\{watchListContent\}\}/g, watchListHtml)
      .replace(/\{\{unsubscribeUrl\}\}/g, config.unsubscribeUrl)
      .replace(/\{\{physicalAddress\}\}/g, config.physicalAddress)
      .replace(/\{\{headerColor\}\}/g, t.headerColor)
      .replace(/\{\{accentColor\}\}/g, t.accentColor)
      .replace(/\{\{backgroundColor\}\}/g, t.backgroundColor)
      .replace(/\{\{cardColor\}\}/g, t.cardColor)
      .replace(/\{\{textColor\}\}/g, t.textColor)
      .replace(/\{\{footerColor\}\}/g, t.footerColor)
      .replace(/\{\{fontFamily\}\}/g, t.fontFamily);

    let html: string;
    try {
      const result = mjml2html(populated, { validationLevel: 'soft' });
      if (result.errors.length > 0) {
        log.warn('MJML compilation warnings', { errors: result.errors.map(e => e.message) });
      }
      html = result.html;
    } catch (err: any) {
      log.error('MJML compilation failed', { error: err.message });
      html = this.buildBasicHtmlFallback(writtenNewsletter, editionNumber, editionDate, t);
    }

    const plainText = this.generatePlainText(writtenNewsletter, editionNumber, editionDate);
    const sectionMetadata = [
      { role: 'lead_story', headline: writtenNewsletter.leadStory.headline, wordCount: writtenNewsletter.leadStory.wordCount },
      ...writtenNewsletter.quickHits.map(qh => ({ role: 'quick_hit', headline: qh.headline, wordCount: qh.wordCount })),
      ...writtenNewsletter.watchList.map(wl => ({ role: 'watch_list', headline: wl.headline, wordCount: wl.wordCount })),
    ];

    log.info('Newsletter assembled', { htmlLength: html.length, plainTextLength: plainText.length, sections: sectionMetadata.length });
    return { html, plainText, editionNumber, editionDate, sectionMetadata };
  }

  private generatePlainText(newsletter: WrittenNewsletter, editionNumber: number, editionDate: string): string {
    const lines: string[] = [];
    lines.push(`${config.newsletterName} — Edition #${editionNumber} — ${editionDate}`);
    lines.push('='.repeat(60));
    lines.push('');
    lines.push('LEAD STORY');
    lines.push('-'.repeat(40));
    lines.push(newsletter.leadStory.headline);
    lines.push('');
    lines.push(newsletter.leadStory.plainTextContent || convert(newsletter.leadStory.htmlContent, { wordwrap: 72 }));
    lines.push('');
    lines.push('QUICK HITS');
    lines.push('-'.repeat(40));
    for (const qh of newsletter.quickHits) {
      lines.push(`• ${qh.headline}`);
      lines.push(qh.plainTextContent || convert(qh.htmlContent, { wordwrap: 72 }));
      lines.push('');
    }
    lines.push('ON THE WATCH LIST');
    lines.push('-'.repeat(40));
    for (const wl of newsletter.watchList) {
      lines.push(`• ${wl.headline}`);
      lines.push(wl.plainTextContent || convert(wl.htmlContent, { wordwrap: 72 }));
      lines.push('');
    }
    lines.push('-'.repeat(60));
    lines.push(`Unsubscribe: ${config.unsubscribeUrl}`);
    lines.push(config.physicalAddress);
    return lines.join('\n');
  }

  private buildBasicHtmlFallback(newsletter: WrittenNewsletter, editionNumber: number, editionDate: string, t: NewsletterTheme): string {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body{font-family:${t.fontFamily};max-width:600px;margin:0 auto;padding:20px;color:${t.textColor};background:${t.backgroundColor}}
      h1{color:${t.headerColor}} h2{color:${t.accentColor}} a{color:${t.accentColor}}
      .footer{font-size:12px;color:#888;margin-top:40px;border-top:1px solid #ddd;padding-top:16px}
    </style></head><body>
      <h1>${config.newsletterName}</h1><p>Edition #${editionNumber} — ${editionDate}</p><hr>
      <h2>${newsletter.leadStory.headline}</h2>${newsletter.leadStory.htmlContent}<hr>
      <h2>Quick Hits</h2>${newsletter.quickHits.map(qh => `<h3>${qh.headline}</h3>${qh.htmlContent}`).join('')}<hr>
      <h2>On the Watch List</h2>${newsletter.watchList.map(wl => `<h3>${wl.headline}</h3>${wl.htmlContent}`).join('')}
      <div class="footer"><p><a href="${config.unsubscribeUrl}">Unsubscribe</a></p><p>${config.physicalAddress}</p></div>
    </body></html>`;
  }

  private getFallbackTemplate(): string {
    return `<mjml><mj-body background-color="{{backgroundColor}}">
      <mj-section background-color="{{headerColor}}" padding="20px"><mj-column>
        <mj-text color="#fff" font-size="24px" align="center">{{newsletterName}}</mj-text>
        <mj-text color="#ddd" font-size="13px" align="center">Edition #{{editionNumber}} — {{editionDate}}</mj-text>
      </mj-column></mj-section>
      <mj-section background-color="{{cardColor}}" padding="20px"><mj-column>
        <mj-text font-size="20px" font-weight="bold">{{leadStoryHeadline}}</mj-text>
        <mj-text>{{leadStoryContent}}</mj-text>
      </mj-column></mj-section>
      <mj-section background-color="{{cardColor}}" padding="20px"><mj-column>
        <mj-text font-weight="bold">Quick Hits</mj-text>{{quickHitsContent}}
      </mj-column></mj-section>
      <mj-section background-color="{{cardColor}}" padding="20px"><mj-column>
        <mj-text font-weight="bold">Watch List</mj-text>{{watchListContent}}
      </mj-column></mj-section>
      <mj-section background-color="{{footerColor}}" padding="16px"><mj-column>
        <mj-text color="#aaa" font-size="11px" align="center">
          <a href="{{unsubscribeUrl}}" style="color:#aaa">Unsubscribe</a> | {{physicalAddress}}
        </mj-text>
      </mj-column></mj-section>
    </mj-body></mjml>`;
  }
}

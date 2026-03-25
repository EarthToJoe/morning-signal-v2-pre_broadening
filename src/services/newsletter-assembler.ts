import mjml2html from 'mjml';
import { convert } from 'html-to-text';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createCorrelatedLogger } from '../utils/logger';
import { config } from '../config';
import { WrittenNewsletter, AssembledNewsletter } from '../types';

export class NewsletterAssemblerService {
  private templatePath: string;

  constructor(templatePath?: string) {
    this.templatePath = templatePath || join(__dirname, '..', 'templates', 'newsletter.mjml');
  }

  /**
   * Assemble written sections into MJML → HTML + plain text.
   */
  async assemble(
    writtenNewsletter: WrittenNewsletter,
    subjectLine: string,
    editionNumber: number,
    editionDate: string,
    correlationId: string
  ): Promise<AssembledNewsletter> {
    const log = createCorrelatedLogger(correlationId, 'newsletter-assembler');

    log.info('Assembling newsletter', { editionNumber, editionDate, subjectLine });

    // Build quick hits HTML
    const quickHitsHtml = writtenNewsletter.quickHits.map(qh =>
      `<mj-text font-size="18px" font-weight="bold" padding-top="16px">${qh.headline}</mj-text>\n` +
      `<mj-text padding-top="4px">${qh.htmlContent}</mj-text>`
    ).join('\n');

    // Build watch list HTML
    const watchListHtml = writtenNewsletter.watchList.map(wl =>
      `<mj-text font-size="16px" font-weight="bold" padding-top="12px">${wl.headline}</mj-text>\n` +
      `<mj-text padding-top="4px">${wl.htmlContent}</mj-text>`
    ).join('\n');

    // Read and populate template
    let mjmlTemplate: string;
    try {
      mjmlTemplate = readFileSync(this.templatePath, 'utf-8');
    } catch (err: any) {
      log.warn('MJML template not found, using inline fallback', { error: err.message });
      mjmlTemplate = this.getFallbackTemplate();
    }

    const populated = mjmlTemplate
      .replace('{{newsletterName}}', config.newsletterName)
      .replace('{{editionNumber}}', String(editionNumber))
      .replace('{{editionDate}}', editionDate)
      .replace('{{leadStoryHeadline}}', writtenNewsletter.leadStory.headline)
      .replace('{{leadStoryContent}}', writtenNewsletter.leadStory.htmlContent)
      .replace('{{quickHitsContent}}', quickHitsHtml)
      .replace('{{watchListContent}}', watchListHtml)
      .replace(/\{\{unsubscribeUrl\}\}/g, config.unsubscribeUrl)
      .replace(/\{\{physicalAddress\}\}/g, config.physicalAddress)
      .replace(/\{\{newsletterName\}\}/g, config.newsletterName);

    // Compile MJML to HTML
    let html: string;
    try {
      const result = mjml2html(populated, { validationLevel: 'soft' });
      if (result.errors.length > 0) {
        log.warn('MJML compilation warnings', { errors: result.errors.map(e => e.message) });
      }
      html = result.html;
    } catch (err: any) {
      log.error('MJML compilation failed, using basic HTML fallback', { error: err.message });
      html = this.buildBasicHtmlFallback(writtenNewsletter, editionNumber, editionDate);
    }

    // Generate plain text
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

    // Lead story
    lines.push('LEAD STORY');
    lines.push('-'.repeat(40));
    lines.push(newsletter.leadStory.headline);
    lines.push('');
    lines.push(newsletter.leadStory.plainTextContent || convert(newsletter.leadStory.htmlContent, { wordwrap: 72 }));
    lines.push('');

    // Quick hits
    lines.push('QUICK HITS');
    lines.push('-'.repeat(40));
    for (const qh of newsletter.quickHits) {
      lines.push(`• ${qh.headline}`);
      lines.push(qh.plainTextContent || convert(qh.htmlContent, { wordwrap: 72 }));
      lines.push('');
    }

    // Watch list
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

  private buildBasicHtmlFallback(newsletter: WrittenNewsletter, editionNumber: number, editionDate: string): string {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body { font-family: Georgia, serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #1a1a2e; }
      h1 { color: #0f3460; } h2 { color: #0f3460; } a { color: #0f3460; }
      .footer { font-size: 12px; color: #888; margin-top: 40px; border-top: 1px solid #ddd; padding-top: 16px; }
    </style></head><body>
      <h1>${config.newsletterName}</h1>
      <p>Edition #${editionNumber} — ${editionDate}</p>
      <hr>
      <h2>${newsletter.leadStory.headline}</h2>
      ${newsletter.leadStory.htmlContent}
      <hr>
      <h2>Quick Hits</h2>
      ${newsletter.quickHits.map(qh => `<h3>${qh.headline}</h3>${qh.htmlContent}`).join('')}
      <hr>
      <h2>On the Watch List</h2>
      ${newsletter.watchList.map(wl => `<h3>${wl.headline}</h3>${wl.htmlContent}`).join('')}
      <div class="footer">
        <p><a href="${config.unsubscribeUrl}">Unsubscribe</a></p>
        <p>${config.physicalAddress}</p>
      </div>
    </body></html>`;
  }

  private getFallbackTemplate(): string {
    return `<mjml><mj-body background-color="#f4f4f8">
      <mj-section background-color="#0f3460" padding="20px"><mj-column>
        <mj-text color="#fff" font-size="24px" align="center">{{newsletterName}}</mj-text>
        <mj-text color="#ddd" font-size="13px" align="center">Edition #{{editionNumber}} — {{editionDate}}</mj-text>
      </mj-column></mj-section>
      <mj-section background-color="#fff" padding="20px"><mj-column>
        <mj-text font-size="20px" font-weight="bold">{{leadStoryHeadline}}</mj-text>
        <mj-text>{{leadStoryContent}}</mj-text>
      </mj-column></mj-section>
      <mj-section background-color="#fff" padding="20px"><mj-column>
        <mj-text font-weight="bold">Quick Hits</mj-text>
        {{quickHitsContent}}
      </mj-column></mj-section>
      <mj-section background-color="#fff" padding="20px"><mj-column>
        <mj-text font-weight="bold">Watch List</mj-text>
        {{watchListContent}}
      </mj-column></mj-section>
      <mj-section background-color="#1a1a2e" padding="16px"><mj-column>
        <mj-text color="#aaa" font-size="11px" align="center">
          <a href="{{unsubscribeUrl}}" style="color:#aaa">Unsubscribe</a> | {{physicalAddress}}
        </mj-text>
      </mj-column></mj-section>
    </mj-body></mjml>`;
  }
}

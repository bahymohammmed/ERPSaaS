import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config';

export type MailMessage = { to: string; subject: string; text: string; html: string };

/**
 * Outgoing e-mail over SMTP (SMTP_URL). With SMTP_URL=json, messages are kept in memory instead
 * of sent, for tests. Without SMTP_URL, e-mail features report themselves unavailable.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transport: Transporter | null = null;
  /** Messages captured with SMTP_URL=json (newest last). */
  readonly outbox: MailMessage[] = [];

  get enabled(): boolean {
    return !!config.smtpUrl;
  }

  async send(message: MailMessage): Promise<void> {
    if (!config.smtpUrl) throw new Error('SMTP is not configured');
    if (config.smtpUrl === 'json') {
      this.outbox.push(message);
      if (this.outbox.length > 100) this.outbox.shift();
      return;
    }
    this.transport ??= nodemailer.createTransport(config.smtpUrl);
    try {
      await this.transport.sendMail({ from: config.mailFrom, ...message });
    } catch (error) {
      // Logged without the message body: it may contain a reset link.
      this.logger.error(`Sending mail to ${message.to.replace(/^(.).*(@.*)$/, '$1***$2')} failed: ${(error as Error).message}`);
      throw error;
    }
  }
}

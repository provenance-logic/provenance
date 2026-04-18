import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import nodemailer, { Transporter } from 'nodemailer';
import { getConfig } from '../config.js';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SentEmailReceipt {
  messageId: string;
  accepted: boolean;
}

/**
 * Email sender. Dev uses Mailhog via SMTP; production uses AWS SES via the SES
 * SDK (same interface, different transport). Tests use 'noop' provider which
 * records messages in-memory without network I/O.
 */
@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private transporter: Transporter | null = null;
  private sentMessages: EmailMessage[] = [];

  onModuleInit(): void {
    const config = getConfig();

    if (config.EMAIL_PROVIDER === 'noop') {
      this.logger.log('EmailService: noop provider — outbound email disabled');
      return;
    }

    if (config.EMAIL_PROVIDER === 'ses') {
      this.logger.warn(
        'EmailService: EMAIL_PROVIDER=ses is reserved for production; ' +
          'routing through SMTP transport pointed at SES endpoint for now. ' +
          'Set SMTP_HOST=email-smtp.<region>.amazonaws.com and provide SMTP credentials.',
      );
    }

    this.transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      ...(config.SMTP_USER && config.SMTP_PASSWORD
        ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } }
        : {}),
    });
  }

  async send(message: EmailMessage): Promise<SentEmailReceipt> {
    const config = getConfig();

    if (config.EMAIL_PROVIDER === 'noop' || !this.transporter) {
      this.sentMessages.push(message);
      this.logger.debug(`[noop] send -> ${message.to}: ${message.subject}`);
      return { messageId: `noop-${Date.now()}`, accepted: true };
    }

    const result = await this.transporter.sendMail({
      from: `"${config.EMAIL_FROM_NAME}" <${config.EMAIL_FROM_ADDRESS}>`,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });

    return {
      messageId: result.messageId,
      accepted: (result.accepted as string[] | undefined)?.includes(message.to) ?? true,
    };
  }

  /** Test-only accessor for captured messages under the noop provider. */
  getSentMessages(): EmailMessage[] {
    return [...this.sentMessages];
  }

  /** Test-only clear. */
  clearSentMessages(): void {
    this.sentMessages = [];
  }
}

import nodemailer from 'nodemailer';
import { env, isTest } from '../../config/env.js';
import { logger } from '../../lib/logger.js';

const transport = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_PORT === 465,
  auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
});

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
}

export const sentEmails: EmailMessage[] = []; // inspected by tests

export async function sendEmail(msg: EmailMessage) {
  if (isTest) {
    sentEmails.push(msg);
    return;
  }
  await transport.sendMail({ from: env.MAIL_FROM, ...msg });
  logger.info({ to: msg.to, subject: msg.subject }, 'email sent');
}

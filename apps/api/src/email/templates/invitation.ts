import type { EmailMessage } from '../email.service.js';

export interface InvitationEmailParams {
  recipientEmail: string;
  inviterName: string;
  organizationName: string;
  role: string;
  acceptUrl: string;
  expiresAt: Date;
}

export function buildInvitationEmail(params: InvitationEmailParams): EmailMessage {
  const { recipientEmail, inviterName, organizationName, role, acceptUrl, expiresAt } = params;
  const expiresStr = expiresAt.toISOString().slice(0, 10);
  const readableRole = role.replace(/_/g, ' ');

  const subject = `You've been invited to join ${organizationName} on Provenance`;

  const text = [
    `${inviterName} has invited you to join ${organizationName} on Provenance as ${readableRole}.`,
    ``,
    `Accept the invitation:`,
    acceptUrl,
    ``,
    `This link expires on ${expiresStr}.`,
    ``,
    `If you don't recognize this invitation, you can safely ignore this email.`,
  ].join('\n');

  const html = `
<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8fafc; padding: 24px;">
  <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 32px;">
    <h1 style="font-size: 20px; color: #0f172a; margin: 0 0 16px;">You're invited to Provenance</h1>
    <p style="color: #334155; font-size: 14px; line-height: 1.6;">
      <strong>${escapeHtml(inviterName)}</strong> has invited you to join
      <strong>${escapeHtml(organizationName)}</strong> as <strong>${escapeHtml(readableRole)}</strong>.
    </p>
    <p style="margin: 24px 0;">
      <a href="${escapeAttr(acceptUrl)}" style="display: inline-block; background: #2563eb; color: #ffffff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 500;">
        Accept invitation
      </a>
    </p>
    <p style="color: #64748b; font-size: 12px; line-height: 1.5;">
      This invitation link expires on ${expiresStr}. If you don't recognize this invitation, you can safely ignore this email.
    </p>
    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
    <p style="color: #94a3b8; font-size: 11px;">Sent to ${escapeHtml(recipientEmail)}.</p>
  </div>
</body>
</html>`.trim();

  return { to: recipientEmail, subject, html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}

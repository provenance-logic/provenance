import type { EmailMessage } from '../email.service.js';

export interface WelcomeEmailParams {
  recipientEmail: string;
  recipientName: string;
  organizationName: string;
  appUrl: string;
}

/**
 * Welcome email sent after a user completes self-serve org creation (F10.2).
 * Keycloak handles email verification natively at registration time; this is
 * a separate transactional email that confirms org setup succeeded and points
 * the new Platform Administrator at the dashboard.
 */
export function buildWelcomeEmail(params: WelcomeEmailParams): EmailMessage {
  const { recipientEmail, recipientName, organizationName, appUrl } = params;
  const subject = `Welcome to ${organizationName} on Provenance`;

  const text = [
    `Hi ${recipientName || 'there'},`,
    ``,
    `Your organization "${organizationName}" is set up and ready to use.`,
    `You are the first Platform Administrator.`,
    ``,
    `Get started: ${appUrl}`,
    ``,
    `Next steps:`,
    `- Create your first domain`,
    `- Invite your team`,
    `- Review the default governance policies`,
  ].join('\n');

  const html = `
<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8fafc; padding: 24px;">
  <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 32px;">
    <h1 style="font-size: 20px; color: #0f172a; margin: 0 0 16px;">Welcome to Provenance</h1>
    <p style="color: #334155; font-size: 14px; line-height: 1.6;">
      Your organization <strong>${escapeHtml(organizationName)}</strong> is set up and ready to use.
      You are the first Platform Administrator.
    </p>
    <p style="margin: 24px 0;">
      <a href="${escapeAttr(appUrl)}" style="display: inline-block; background: #2563eb; color: #ffffff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 500;">
        Open Provenance
      </a>
    </p>
    <p style="color: #334155; font-size: 13px; line-height: 1.6;">
      Next steps:
    </p>
    <ul style="color: #334155; font-size: 13px; line-height: 1.6;">
      <li>Create your first domain</li>
      <li>Invite your team</li>
      <li>Review the default governance policies</li>
    </ul>
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

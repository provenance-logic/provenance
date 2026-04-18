import { EmailService } from '../email.service.js';
import { buildInvitationEmail } from '../templates/invitation.js';
import { buildWelcomeEmail } from '../templates/welcome.js';

describe('EmailService (noop provider)', () => {
  let service: EmailService;

  beforeEach(() => {
    process.env['EMAIL_PROVIDER'] = 'noop';
    service = new EmailService();
    service.onModuleInit();
    service.clearSentMessages();
  });

  it('does not throw and records the message under noop provider', async () => {
    const receipt = await service.send({
      to: 'someone@example.com',
      subject: 'hi',
      html: '<p>hi</p>',
      text: 'hi',
    });
    expect(receipt.accepted).toBe(true);
    expect(service.getSentMessages()).toHaveLength(1);
    expect(service.getSentMessages()[0].to).toBe('someone@example.com');
  });
});

describe('invitation email template', () => {
  it('includes the accept URL and expiration date', () => {
    const msg = buildInvitationEmail({
      recipientEmail: 'invitee@example.com',
      inviterName: 'Alice',
      organizationName: 'Acme',
      role: 'domain_owner',
      acceptUrl: 'https://app.example.com/accept-invite?token=xyz',
      expiresAt: new Date('2026-05-01T00:00:00Z'),
    });
    expect(msg.to).toBe('invitee@example.com');
    expect(msg.subject).toContain('Acme');
    expect(msg.html).toContain('xyz');
    expect(msg.html).toContain('2026-05-01');
    expect(msg.text).toContain('https://app.example.com/accept-invite?token=xyz');
  });

  it('escapes HTML in org and inviter names', () => {
    const msg = buildInvitationEmail({
      recipientEmail: 'a@b.co',
      inviterName: '<script>alert(1)</script>',
      organizationName: 'Evil & Co',
      role: 'consumer',
      acceptUrl: 'https://x.y/z',
      expiresAt: new Date('2026-01-01T00:00:00Z'),
    });
    expect(msg.html).not.toContain('<script>');
    expect(msg.html).toContain('&lt;script&gt;');
    expect(msg.html).toContain('Evil &amp; Co');
  });

  it('renders the role in human-readable form (underscores stripped)', () => {
    const msg = buildInvitationEmail({
      recipientEmail: 'a@b.co',
      inviterName: 'Alice',
      organizationName: 'Acme',
      role: 'data_product_owner',
      acceptUrl: 'https://x.y/z',
      expiresAt: new Date('2026-01-01T00:00:00Z'),
    });
    expect(msg.html).toContain('data product owner');
    expect(msg.html).not.toContain('data_product_owner');
  });
});

describe('welcome email template', () => {
  it('addresses the recipient by name and links to the app URL', () => {
    const msg = buildWelcomeEmail({
      recipientEmail: 'new@example.com',
      recipientName: 'Charlie',
      organizationName: 'Contoso',
      appUrl: 'https://app.contoso.com',
    });
    expect(msg.text).toContain('Contoso');
    expect(msg.text).toContain('Charlie');
    expect(msg.html).toContain('https://app.contoso.com');
  });
});

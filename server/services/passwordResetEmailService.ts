import net from 'net';
import tls from 'tls';

export class SmtpConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SmtpConfigurationError';
  }
}

export class SmtpDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SmtpDeliveryError';
  }
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  publicAppUrl: string;
}

export function getFrontendBaseUrl(): string {
  const explicitFrontend = String(process.env.FRONTEND_URL || '').trim().replace(/\/+$/, '');
  if (explicitFrontend) {
    return explicitFrontend;
  }
  const appPublicUrl = String(process.env.APP_PUBLIC_URL || '').trim().replace(/\/+$/, '');
  if (appPublicUrl) {
    return appPublicUrl;
  }
  const firstCorsOrigin = String(process.env.CORS_ORIGIN || '')
    .split(',')
    .map(s => s.trim().replace(/\/+$/, ''))
    .find(s => Boolean(s) && s !== '*');
  if (firstCorsOrigin) {
    return firstCorsOrigin;
  }
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  return `http://localhost:${port}`;
}

export function getSmtpConfig(): SmtpConfig | null {
  const host = String(process.env.SMTP_HOST || '').trim();
  const rawPort = String(process.env.SMTP_PORT || '').trim();
  const user = String(process.env.SMTP_USER || '').trim();
  const pass = String(process.env.SMTP_PASS || '').trim();
  const from = String(process.env.SMTP_FROM || '').trim();

  if (!host || !rawPort || !user || !pass || !from) {
    return null;
  }

  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }

  const secureEnv = String(process.env.SMTP_SECURE || '').trim().toLowerCase();
  const secure = secureEnv ? secureEnv === 'true' : port === 465;

  const publicAppUrl = getFrontendBaseUrl();

  return { host, port, secure, user, pass, from, publicAppUrl };
}

export function isSmtpConfigured(): boolean {
  return getSmtpConfig() !== null;
}

function sanitizeHeaderValue(val: string): string {
  return String(val || '').replace(/[\r\n]+/g, ' ').trim();
}

function extractAddressAngle(fromHeader: string): string {
  const match = fromHeader.match(/<([^>]+)>/);
  return (match ? match[1] : fromHeader).replace(/[\r\n<>]+/g, '').trim();
}

class MinimalSmtpSession {
  private socket: net.Socket | tls.TLSSocket;
  private buffer = '';
  private pendingResolve: ((resp: { code: number; text: string }) => void) | null = null;
  private pendingReject: ((err: Error) => void) | null = null;
  private currentLines: string[] = [];

  constructor(socket: net.Socket | tls.TLSSocket) {
    this.socket = socket;
    this.attachListeners(socket);
  }

  private attachListeners(sock: net.Socket | tls.TLSSocket) {
    sock.setEncoding('utf8');
    sock.setTimeout(10000);
    sock.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.drainLines();
    });
    sock.on('timeout', () => {
      const reject = this.pendingReject;
      this.pendingResolve = null;
      this.pendingReject = null;
      sock.destroy();
      if (reject) reject(new SmtpDeliveryError('SMTP connection timed out'));
    });
    sock.on('error', (err: Error) => {
      const reject = this.pendingReject;
      this.pendingResolve = null;
      this.pendingReject = null;
      if (reject) reject(new SmtpDeliveryError(err.message || 'SMTP socket error'));
    });
    sock.on('close', () => {
      const reject = this.pendingReject;
      this.pendingResolve = null;
      this.pendingReject = null;
      if (reject) reject(new SmtpDeliveryError('SMTP connection closed unexpectedly'));
    });
  }

  private drainLines() {
    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) !== -1) {
      const rawLine = this.buffer.slice(0, idx).replace(/\r$/, '');
      this.buffer = this.buffer.slice(idx + 1);
      if (!rawLine) continue;
      this.currentLines.push(rawLine);
      // Final line of SMTP response has format: 3 digits followed by space (or end of string)
      if (/^\d{3}(?:\s|$)/.test(rawLine)) {
        const code = parseInt(rawLine.slice(0, 3), 10);
        const text = this.currentLines.join('\n');
        this.currentLines = [];
        const resolve = this.pendingResolve;
        this.pendingResolve = null;
        this.pendingReject = null;
        if (resolve) resolve({ code, text });
      }
    }
  }

  readResponse(): Promise<{ code: number; text: string }> {
    return new Promise((resolve, reject) => {
      this.pendingResolve = resolve;
      this.pendingReject = reject;
      this.drainLines();
    });
  }

  async sendCommand(cmd: string, expectedCodes: number[]): Promise<{ code: number; text: string }> {
    this.socket.write(`${cmd}\r\n`);
    const resp = await this.readResponse();
    if (!expectedCodes.includes(resp.code)) {
      throw new SmtpDeliveryError(`Unexpected SMTP status code ${resp.code}`);
    }
    return resp;
  }

  async upgradeToStartTls(servername: string): Promise<void> {
    this.socket.removeAllListeners('data');
    this.socket.removeAllListeners('timeout');
    this.socket.removeAllListeners('error');
    this.socket.removeAllListeners('close');

    const tlsSocket = await new Promise<tls.TLSSocket>((resolve, reject) => {
      const upgraded = tls.connect(
        {
          socket: this.socket as net.Socket,
          servername,
          minVersion: 'TLSv1.2',
          rejectUnauthorized: true,
        },
        () => resolve(upgraded)
      );
      upgraded.once('error', err => reject(new SmtpDeliveryError(err.message || 'STARTTLS handshake failed')));
    });

    this.buffer = '';
    this.currentLines = [];
    this.socket = tlsSocket;
    this.attachListeners(tlsSocket);
  }

  async close(): Promise<void> {
    try {
      if (!this.socket.destroyed) {
        await this.sendCommand('QUIT', [221, 250]).catch(() => {});
        this.socket.end();
      }
    } catch {
      this.socket.destroy();
    }
  }

  destroy(): void {
    this.socket.destroy();
  }
}

export interface OpenSmtpTransport {
  publicAppUrl: string;
  sendPasswordResetMail: (params: {
    toEmail: string;
    recipientName: string;
    rawResetToken: string;
    expiresInMinutes: number;
  }) => Promise<void>;
  sendInquiryReplyMail: (params: {
    toEmail: string;
    recipientName: string;
    referenceNo: string;
    subject: string;
    replyMessage: string;
  }) => Promise<void>;
  close: () => Promise<void>;
}

/**
 * Opens and authenticates an SMTP session BEFORE user lookup so missing/failing
 * SMTP fails safely without creating an account-enumeration timing/status oracle.
 * Never logs raw tokens, reset URLs, or SMTP credentials.
 */
export async function openAuthenticatedSmtpTransport(): Promise<OpenSmtpTransport> {
  const cfg = getSmtpConfig();
  if (!cfg) {
    throw new SmtpConfigurationError(
      'Email-based password recovery is not configured on this server. Please contact school administration.'
    );
  }

  const isLoopback = cfg.host === '127.0.0.1' || cfg.host === 'localhost';
  const rawSocket = await new Promise<net.Socket | tls.TLSSocket>((resolve, reject) => {
    const onError = (err: Error) =>
      reject(new SmtpDeliveryError(err.message || 'Unable to connect to SMTP host'));
    if (cfg.secure) {
      const s = tls.connect(
        {
          host: cfg.host,
          port: cfg.port,
          servername: isLoopback ? undefined : cfg.host,
          minVersion: 'TLSv1.2',
          rejectUnauthorized: true,
        },
        () => {
          s.removeListener('error', onError);
          resolve(s);
        }
      );
      s.once('error', onError);
    } else {
      const s = net.createConnection({ host: cfg.host, port: cfg.port }, () => {
        s.removeListener('error', onError);
        resolve(s);
      });
      s.once('error', onError);
    }
  });

  const session = new MinimalSmtpSession(rawSocket);
  try {
    const greeting = await session.readResponse();
    if (greeting.code !== 220) {
      throw new SmtpDeliveryError(`Unexpected SMTP greeting ${greeting.code}`);
    }

    const ehlo = await session.sendCommand('EHLO shawanschool.local', [250]);
    if (!cfg.secure) {
      const supportsStartTls = /STARTTLS/i.test(ehlo.text);
      if (supportsStartTls) {
        await session.sendCommand('STARTTLS', [220]);
        await session.upgradeToStartTls(cfg.host);
        await session.sendCommand('EHLO shawanschool.local', [250]);
      } else if (!isLoopback) {
        throw new SmtpDeliveryError('Remote SMTP server does not support TLS encryption (STARTTLS required)');
      }
    }

    // Authenticate using RFC 4616 AUTH PLAIN (never log credentials)
    const authPayload = Buffer.from(`\u0000${cfg.user}\u0000${cfg.pass}`, 'utf8').toString('base64');
    await session.sendCommand(`AUTH PLAIN ${authPayload}`, [235]);
  } catch (err) {
    session.destroy();
    throw err;
  }

  return {
    publicAppUrl: cfg.publicAppUrl,
    async sendPasswordResetMail({ toEmail, recipientName, rawResetToken, expiresInMinutes }) {
      const cleanFromEnvelope = extractAddressAngle(cfg.from);
      const cleanTo = sanitizeHeaderValue(toEmail);
      const safeName = sanitizeHeaderValue(recipientName || 'Portal User');
      const resetUrl = `${cfg.publicAppUrl}/reset-password?token=${encodeURIComponent(rawResetToken)}`;

      await session.sendCommand(`MAIL FROM:<${cleanFromEnvelope}>`, [250]);
      await session.sendCommand(`RCPT TO:<${cleanTo}>`, [250, 251]);
      await session.sendCommand('DATA', [354]);

      const boundary = `shawan_boundary_${Date.now()}`;
      const plainBody = [
        `Assalam-o-Alaikum ${safeName},`,
        '',
        'We received a request to reset the password for your Shawan School & College portal account.',
        `Use the secure single-use link below within ${expiresInMinutes} minutes to set a new password:`,
        '',
        resetUrl,
        '',
        'If you did not request this password reset, you can safely ignore this email. Your existing password will remain unchanged.',
        '',
        'Shawan School & College — Paharpur, Dera Ismail Khan',
      ].join('\r\n');

      const htmlBody = [
        '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#171717;line-height:1.5">',
        '<h2 style="color:#064e3b;margin-bottom:8px">Shawan School &amp; College</h2>',
        `<p>Assalam-o-Alaikum <strong>${safeName.replace(/[<>&"]/g, '')}</strong>,</p>`,
        '<p>We received a request to reset the password for your institutional portal account.</p>',
        `<p>This single-use reset link expires in <strong>${expiresInMinutes} minutes</strong>:</p>`,
        `<p style="margin:20px 0"><a href="${resetUrl}" style="background:#064e3b;color:#ffffff;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">Reset Portal Password</a></p>`,
        '<p style="font-size:12px;color:#525252">If you did not request a password reset, please ignore this message.</p>',
        '</div>',
      ].join('\r\n');

      const rawMessage = [
        `From: ${sanitizeHeaderValue(cfg.from)}`,
        `To: <${cleanTo}>`,
        'Subject: Password Reset Request - Shawan School & College',
        `Date: ${new Date().toUTCString()}`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset="UTF-8"',
        'Content-Transfer-Encoding: 7bit',
        '',
        plainBody,
        '',
        `--${boundary}`,
        'Content-Type: text/html; charset="UTF-8"',
        'Content-Transfer-Encoding: 7bit',
        '',
        htmlBody,
        '',
        `--${boundary}--`,
        '.',
      ]
        .map(line => (line.startsWith('.') && line !== '.' ? `.${line}` : line))
        .join('\r\n');

      await session.sendCommand(rawMessage, [250]);
    },
    async sendInquiryReplyMail({ toEmail, recipientName, referenceNo, subject, replyMessage }) {
      const cleanFromEnvelope = extractAddressAngle(cfg.from);
      const cleanTo = sanitizeHeaderValue(toEmail);
      const safeName = sanitizeHeaderValue(recipientName || 'Respected Parent / Guardian');
      const safeSubject = sanitizeHeaderValue(subject || 'Inquiry');
      const safeRef = sanitizeHeaderValue(referenceNo || 'INQ');

      await session.sendCommand(`MAIL FROM:<${cleanFromEnvelope}>`, [250]);
      await session.sendCommand(`RCPT TO:<${cleanTo}>`, [250, 251]);
      await session.sendCommand('DATA', [354]);

      const boundary = `shawan_inquiry_${Date.now()}`;
      const plainBody = [
        `Assalam-o-Alaikum ${safeName},`,
        '',
        `Thank you for contacting Shawan School & College. Regarding your inquiry [${safeRef}: "${safeSubject}"]:`,
        '',
        replyMessage,
        '',
        'If you have further questions, you can reply directly or quote your reference number when contacting our administrative office.',
        '',
        'Office of Administration & Student Affairs',
        'Shawan School & College — Paharpur, Dera Ismail Khan',
        'Website: ' + cfg.publicAppUrl,
      ].join('\r\n');

      const htmlBody = [
        '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#171717;line-height:1.6">',
        '<div style="border-bottom:2px solid #064e3b;padding-bottom:12px;margin-bottom:16px">',
        '<h2 style="color:#064e3b;margin:0">Shawan School &amp; College</h2>',
        '<p style="font-size:12px;color:#525252;margin:4px 0 0 0">Paharpur, Dera Ismail Khan, Khyber Pakhtunkhwa</p>',
        '</div>',
        `<p>Assalam-o-Alaikum <strong>${safeName.replace(/[<>&"]/g, '')}</strong>,</p>`,
        `<p style="font-size:13px;color:#525252">In reference to your inquiry <strong>[${safeRef.replace(/[<>&"]/g, '')}]</strong> regarding <em>"${safeSubject.replace(/[<>&"]/g, '')}"</em>:</p>`,
        '<div style="background:#f9fafb;border-left:4px solid #064e3b;padding:14px 18px;margin:18px 0;border-radius:6px;font-size:14px;white-space:pre-wrap">',
        replyMessage.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] || c)),
        '</div>',
        '<p style="font-size:12px;color:#525252">You may track your inquiry or view past responses anytime on our <a href="' + cfg.publicAppUrl + '" style="color:#064e3b;font-weight:bold">Institutional Portal</a> using your reference number.</p>',
        '<div style="margin-top:24px;border-top:1px solid #e5e7eb;padding-top:12px;font-size:12px;color:#737373">',
        '<strong>Office of Administration &amp; Student Affairs</strong><br>',
        'Shawan School &amp; College · Main Rangpur Road, Paharpur',
        '</div>',
        '</div>',
      ].join('\r\n');

      const rawMessage = [
        `From: ${sanitizeHeaderValue(cfg.from)}`,
        `To: <${cleanTo}>`,
        `Subject: Re: [${safeRef}] ${safeSubject} - Shawan School & College`,
        `Date: ${new Date().toUTCString()}`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset="UTF-8"',
        'Content-Transfer-Encoding: 7bit',
        '',
        plainBody,
        '',
        `--${boundary}`,
        'Content-Type: text/html; charset="UTF-8"',
        'Content-Transfer-Encoding: 7bit',
        '',
        htmlBody,
        '',
        `--${boundary}--`,
        '.',
      ]
        .map(line => (line.startsWith('.') && line !== '.' ? `.${line}` : line))
        .join('\r\n');

      await session.sendCommand(rawMessage, [250]);
    },
    async close() {
      await session.close();
    },
  };
}

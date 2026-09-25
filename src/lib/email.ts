import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

interface NewLeadEmail {
  doctorEmail: string;
  doctorName: string;
  patientName: string;
  patientPhone: string;
  service?: string;
  date?: string;
  /** Absolute link to the doctor's cabinet. */
  cabinetUrl: string;
}

/** Every field below comes from the public form: never raw into HTML. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function sendNewLeadEmail(data: NewLeadEmail): Promise<void> {
  if (!process.env.SMTP_USER) return; // skip if email not configured

  const e = escapeHtml;
  // Audit LD-01: the link used to point at /ru/dashboard, a route that does
  // not exist. Requests are processed by reception on the CRM «Заявки»
  // screen; the doctor gets a heads-up and a link to their own cabinet.
  await transporter.sendMail({
    from: `"NeuroFax" <${process.env.SMTP_USER}>`,
    to: data.doctorEmail,
    subject: `Новая заявка: ${data.patientName.replace(/[\r\n]+/g, " ")}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px;">
        <h2 style="color: #1a1a1a;">Новая заявка на приём</h2>
        <table style="width: 100%; border-collapse: collapse;">
          <tr><td style="padding: 8px 0; color: #666;">Пациент</td><td style="padding: 8px 0; font-weight: 600;">${e(data.patientName)}</td></tr>
          <tr><td style="padding: 8px 0; color: #666;">Телефон</td><td style="padding: 8px 0; font-weight: 600;">${e(data.patientPhone)}</td></tr>
          ${data.service ? `<tr><td style="padding: 8px 0; color: #666;">Услуга</td><td style="padding: 8px 0;">${e(data.service)}</td></tr>` : ""}
          ${data.date ? `<tr><td style="padding: 8px 0; color: #666;">Дата</td><td style="padding: 8px 0;">${e(data.date)}</td></tr>` : ""}
          <tr><td style="padding: 8px 0; color: #666;">Врач</td><td style="padding: 8px 0;">${e(data.doctorName)}</td></tr>
        </table>
        <p style="margin-top: 20px; color: #666; font-size: 13px;">Заявку обработает регистратура, запись появится в вашем расписании. <a href="${e(data.cabinetUrl)}">Открыть кабинет</a>.</p>
      </div>
    `,
  });
}

/**
 * Clinic self-signup confirmation (audit MA-03). The link inside is the only
 * way to finish the signup, so a failure here must reach the caller: the
 * route then withdraws the token instead of telling the visitor to check an
 * inbox that will stay empty.
 */
export async function sendSignupConfirmEmail(data: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  await transporter.sendMail({
    from: `"NeuroFax" <${process.env.SMTP_USER}>`,
    to: data.to,
    subject: data.subject,
    html: data.html,
  });
}

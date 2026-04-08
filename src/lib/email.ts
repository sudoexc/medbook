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
}

export async function sendNewLeadEmail(data: NewLeadEmail): Promise<void> {
  if (!process.env.SMTP_USER) return; // skip if email not configured

  await transporter.sendMail({
    from: `"NeuroFax" <${process.env.SMTP_USER}>`,
    to: data.doctorEmail,
    subject: `Новая заявка: ${data.patientName}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px;">
        <h2 style="color: #1a1a1a;">Новая заявка на приём</h2>
        <table style="width: 100%; border-collapse: collapse;">
          <tr><td style="padding: 8px 0; color: #666;">Пациент</td><td style="padding: 8px 0; font-weight: 600;">${data.patientName}</td></tr>
          <tr><td style="padding: 8px 0; color: #666;">Телефон</td><td style="padding: 8px 0; font-weight: 600;">${data.patientPhone}</td></tr>
          ${data.service ? `<tr><td style="padding: 8px 0; color: #666;">Услуга</td><td style="padding: 8px 0;">${data.service}</td></tr>` : ""}
          ${data.date ? `<tr><td style="padding: 8px 0; color: #666;">Дата</td><td style="padding: 8px 0;">${data.date}</td></tr>` : ""}
          <tr><td style="padding: 8px 0; color: #666;">Врач</td><td style="padding: 8px 0;">${data.doctorName}</td></tr>
        </table>
        <p style="margin-top: 20px; color: #666; font-size: 13px;">Войдите в <a href="https://neurofax.uz/ru/dashboard">панель управления</a> для обработки.</p>
      </div>
    `,
  });
}

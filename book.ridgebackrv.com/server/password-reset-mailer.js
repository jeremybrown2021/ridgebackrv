import nodemailer from "nodemailer";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function createPasswordResetMailer(authConfig) {
  if (!authConfig?.smtp) return null;
  const smtp = authConfig.smtp;
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    ...(smtp.user ? { auth: { user: smtp.user, pass: smtp.password } } : {}),
  });

  return {
    async send({ email, fullName, resetUrl, expiresInMinutes }) {
      const safeName = escapeHtml(fullName || "traveler");
      const safeUrl = escapeHtml(resetUrl);
      await transporter.sendMail({
        from: smtp.from,
        to: email,
        subject: "Reset your Ridgeback RV password",
        text: [
          `Hi ${fullName || "traveler"},`,
          "",
          "Use this link to choose a new Ridgeback RV account password:",
          resetUrl,
          "",
          `The link expires in ${expiresInMinutes} minutes and can only be used once.`,
          "If you did not request this reset, you can ignore this email.",
        ].join("\n"),
        html: `<p>Hi ${safeName},</p><p>Use the button below to choose a new Ridgeback RV account password.</p><p><a href="${safeUrl}">Reset password</a></p><p>This link expires in ${expiresInMinutes} minutes and can only be used once.</p><p>If you did not request this reset, you can ignore this email.</p>`,
      });
    },
  };
}

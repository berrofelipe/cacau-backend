import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Resend } from "resend"

function buildResetHtml(resetLink: string) {
  const label = (t: string) =>
    `<div style="font-family:Arial,sans-serif;font-size:8px;letter-spacing:0.24em;text-transform:uppercase;color:#64361a;margin-bottom:16px">${t}</div>`

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px 0;background:#f0ece0;font-family:Georgia,'Times New Roman',serif">
<div style="max-width:560px;margin:0 auto;background:#faf7ed">

  <!-- HEADER -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="padding:28px 40px 0">
    <tr>
      <td valign="top">
        <div style="font-family:Georgia,serif;font-size:20px;font-weight:bold;color:#281a0a;letter-spacing:-0.01em">Cacau do Céu</div>
        <div style="font-family:Arial,sans-serif;font-size:8px;letter-spacing:0.22em;text-transform:uppercase;color:#c8a97a;margin-top:5px">Bean · Tree · To · Bar · Ilhéus, Bahia</div>
      </td>
    </tr>
  </table>
  <div style="height:2px;background:#281a0a;margin:18px 40px 0"></div>

  <!-- BODY -->
  <div style="padding:44px 40px 0">
    ${label("Redefinição de senha")}
    <div style="font-family:Georgia,serif;font-style:italic;font-size:38px;line-height:1;color:#281a0a;letter-spacing:-0.01em">
      Nova senha.
    </div>
    <p style="font-family:Arial,sans-serif;font-size:14px;color:#58412d;margin-top:24px;line-height:1.8;max-width:44ch">
      Recebemos uma solicitação para redefinir a senha da sua conta. Clique no botão abaixo para criar uma nova senha. O link é válido por 15 minutos.
    </p>
    <p style="font-family:Arial,sans-serif;font-size:12px;color:#8a7060;margin-top:8px;line-height:1.7">
      Se você não solicitou isso, ignore este e-mail — sua conta permanece segura.
    </p>
  </div>

  <!-- CTA -->
  <div style="padding:36px 40px">
    <table cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="background:#281a0a">
          <a href="${resetLink}"
             style="display:inline-block;font-family:Arial,sans-serif;font-size:10px;letter-spacing:0.20em;text-transform:uppercase;color:#faf7ed;padding:14px 28px;text-decoration:none">
            Criar nova senha →
          </a>
        </td>
      </tr>
    </table>
    <p style="font-family:Arial,sans-serif;font-size:10px;color:#8a7060;margin-top:20px;line-height:1.7;max-width:48ch">
      Ou copie o link: <span style="word-break:break-all">${resetLink}</span>
    </p>
  </div>

  <div style="height:1px;background:#d5cec4;margin:0 40px"></div>

  <!-- FOOTER -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="padding:20px 40px 32px">
    <tr>
      <td style="font-family:Georgia,serif;font-style:italic;font-size:11px;color:#58412d">
        Cacau do Céu · Ilhéus, Bahia
      </td>
      <td align="right" style="font-family:Arial,sans-serif;font-size:8px;letter-spacing:0.16em;text-transform:uppercase;color:#64361a">
        Não responder
      </td>
    </tr>
  </table>

</div>
</body></html>`
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { email, token } = req.body as { email?: string; token?: string }

  if (!email || !token) {
    return res.status(400).json({ error: "Missing email or token" })
  }

  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) {
    console.warn("[send-reset] RESEND_API_KEY não configurada")
    return res.status(500).json({ error: "Email service not configured" })
  }

  const storeUrl = process.env.STORE_URL || "http://localhost:5173"
  const resetLink = `${storeUrl}/conta/nova-senha?token=${encodeURIComponent(token)}`

  const resend = new Resend(resendKey)
  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM || "noreply@cacaudoceu.com.br",
    to: email,
    subject: "Redefinição de senha — Cacau do Céu",
    html: buildResetHtml(resetLink),
  })

  if (error) {
    console.error("[send-reset] Erro ao enviar e-mail:", error)
    return res.status(500).json({ error: error.message })
  }

  console.log(`[send-reset] E-mail de redefinição enviado para ${email}`)
  res.json({ ok: true })
}

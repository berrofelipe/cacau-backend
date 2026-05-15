// Shared branded email template — matches the site's design system exactly
// Colors converted from global.css oklch values:
//   --ink         oklch(0.22 0.04 55)  → #291c0e
//   --ink-soft    oklch(0.40 0.03 55)  → #5b4030
//   --cacao       oklch(0.36 0.07 55)  → #7a4820  (italic accent)
//   --cream       oklch(0.97 0.010 85) → #faf7ed
//   --linen       oklch(0.90 0.020 85) → #ece5d8  (outer bg)
//   --rule        oklch(0.84 0.015 80) → #d5cec4
//   gold accent used in header subtitle → #c8a97a

// Replicates .field-label { ::before 24px line + mono uppercase text }
function fieldLabel(text: string): string {
  return `
  <table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px">
    <tr>
      <td style="width:24px;vertical-align:middle;padding-right:10px;line-height:0">
        <div style="width:24px;height:1px;background:#7a5535"></div>
      </td>
      <td style="font-family:'Courier New',monospace;font-size:8px;letter-spacing:0.22em;text-transform:uppercase;color:#7a5535;white-space:nowrap;vertical-align:middle">
        ${text}
      </td>
    </tr>
  </table>`
}

// Replicates .btn.dark
function ctaButton(href: string, label: string): string {
  return `
  <table cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td style="background:#291c0e">
        <a href="${href}"
           style="display:inline-block;font-family:'Courier New',monospace;font-size:9px;letter-spacing:0.24em;text-transform:uppercase;color:#faf7ed;padding:15px 32px;text-decoration:none">
          ${label} →
        </a>
      </td>
    </tr>
  </table>`
}

const emailHeader = `
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="padding:36px 52px 0">
    <tr>
      <td>
        <div style="font-family:'Cormorant Garamond',Georgia,'Times New Roman',serif;font-size:20px;font-weight:400;color:#291c0e;letter-spacing:0.01em">Cacau do Céu</div>
        <div style="font-family:'Courier New',monospace;font-size:7px;letter-spacing:0.28em;text-transform:uppercase;color:#c8a97a;margin-top:5px">Bean · Tree · To · Bar · Ilhéus, Bahia</div>
      </td>
    </tr>
  </table>
  <div style="height:2px;background:#291c0e;margin:14px 52px 0"></div>`

const emailFooter = `
  <div style="height:1px;background:#d5cec4;margin:0 52px"></div>
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="padding:20px 52px 36px">
    <tr>
      <td style="font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:13px;color:#5b4030">
        Cacau do Céu · Ilhéus, Bahia
      </td>
      <td align="right" style="font-family:'Courier New',monospace;font-size:7px;letter-spacing:0.20em;text-transform:uppercase;color:#7a5535;white-space:nowrap">
        Não responder
      </td>
    </tr>
  </table>`

const FONT_BASE = "https://cacaudoceu.com.br/fonts"

function wrap(body: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    @font-face {
      font-family: 'Cormorant Garamond';
      font-style: normal;
      font-weight: 300;
      font-display: swap;
      src: url('${FONT_BASE}/CormorantGaramond-Light.ttf') format('truetype');
    }
    @font-face {
      font-family: 'Cormorant Garamond';
      font-style: normal;
      font-weight: 400;
      font-display: swap;
      src: url('${FONT_BASE}/CormorantGaramond-Regular.ttf') format('truetype');
    }
    @font-face {
      font-family: 'Cormorant Garamond';
      font-style: italic;
      font-weight: 300;
      font-display: swap;
      src: url('${FONT_BASE}/CormorantGaramond-LightItalic.ttf') format('truetype');
    }
    @font-face {
      font-family: 'Cormorant Garamond';
      font-style: italic;
      font-weight: 400;
      font-display: swap;
      src: url('${FONT_BASE}/CormorantGaramond-Italic.ttf') format('truetype');
    }
  </style>
</head>
<body style="margin:0;padding:32px 0;background:#ece5d8;font-family:Georgia,'Times New Roman',serif;-webkit-font-smoothing:antialiased">
  <div style="max-width:560px;margin:0 auto;background:#faf7ed">
    ${emailHeader}
    ${body}
    ${emailFooter}
  </div>
</body>
</html>`
}

export function buildWelcomeEmail(firstName: string, storeUrl: string): string {
  return wrap(`
    <div style="padding:52px 52px 0">
      ${fieldLabel("Bem-vindo")}
      <div style="font-family:'Cormorant Garamond',Georgia,serif;font-weight:300;font-size:64px;line-height:0.93;color:#291c0e;letter-spacing:-0.015em">
        Olá,<br>
        <span style="font-style:italic;color:#7a4820">${firstName || "bem-vindo"}.</span>
      </div>
      <p style="font-family:Georgia,'Times New Roman',serif;font-size:15px;color:#5b4030;margin-top:28px;line-height:1.85;max-width:42ch">
        Sua conta na Cacau do Céu foi criada. Aqui você acompanha pedidos, gerencia seus dados e explora o mundo do chocolate bean-to-bar do sul da Bahia.
      </p>
    </div>
    <div style="padding:40px 52px 52px">
      ${ctaButton(`${storeUrl}/loja`, "Explorar a loja")}
    </div>`)
}

export function buildPasswordResetEmail(resetLink: string): string {
  return wrap(`
    <div style="padding:52px 52px 0">
      ${fieldLabel("Redefinição de senha")}
      <div style="font-family:'Cormorant Garamond',Georgia,serif;font-weight:300;font-size:64px;line-height:0.93;color:#291c0e;letter-spacing:-0.015em">
        Nova<br>
        <span style="font-style:italic;color:#7a4820">senha.</span>
      </div>
      <p style="font-family:Georgia,'Times New Roman',serif;font-size:15px;color:#5b4030;margin-top:28px;line-height:1.85;max-width:42ch">
        Recebemos uma solicitação para redefinir a senha da sua conta. Clique no botão abaixo para criar uma nova senha.
      </p>
      <p style="font-family:'Courier New',monospace;font-size:9px;color:#9a7a5a;margin-top:12px;line-height:1.7;max-width:44ch">
        O link expira em 15 minutos. Se você não solicitou isso, ignore este e-mail.
      </p>
    </div>
    <div style="padding:40px 52px 12px">
      ${ctaButton(resetLink, "Criar nova senha")}
    </div>
    <div style="padding:0 52px 52px">
      <p style="font-family:'Courier New',monospace;font-size:8px;color:#b0a090;margin-top:16px;line-height:1.7;word-break:break-all">
        ${resetLink}
      </p>
    </div>`)
}

export function buildEmailVerificationEmail(verifyLink: string, newEmail: string): string {
  return wrap(`
    <div style="padding:52px 52px 0">
      ${fieldLabel("Alteração de e-mail")}
      <div style="font-family:'Cormorant Garamond',Georgia,serif;font-weight:300;font-size:64px;line-height:0.93;color:#291c0e;letter-spacing:-0.015em">
        Confirme<br>
        <span style="font-style:italic;color:#7a4820">o e-mail.</span>
      </div>
      <p style="font-family:Georgia,'Times New Roman',serif;font-size:15px;color:#5b4030;margin-top:28px;line-height:1.85;max-width:42ch">
        Recebemos uma solicitação para alterar o e-mail da sua conta para <span style="font-style:italic;color:#291c0e">${newEmail}</span>. Clique abaixo para confirmar.
      </p>
      <p style="font-family:'Courier New',monospace;font-size:9px;color:#9a7a5a;margin-top:12px;line-height:1.7;max-width:44ch">
        O link expira em 24 horas. Se você não fez essa solicitação, ignore este e-mail.
      </p>
    </div>
    <div style="padding:40px 52px 12px">
      ${ctaButton(verifyLink, "Confirmar novo e-mail")}
    </div>
    <div style="padding:0 52px 52px">
      <p style="font-family:'Courier New',monospace;font-size:8px;color:#b0a090;margin-top:16px;line-height:1.7;word-break:break-all">
        ${verifyLink}
      </p>
    </div>`)
}

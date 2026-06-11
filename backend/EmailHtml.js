// EmailHtml.js
/*
  FILE: EmailHtml.js
  LAYMAN (Tropang Ex): Dito nakatira ang lahat ng "pang-ganda" ng emails.
  Dati plain text lang ang mga email natin — walang kulay, walang branding,
  yung portal link ay mahabang URL na nakakatakot pindutin. Ang mga helper
  dito ang gumagawa ng branded HTML version: may Megaworld header, may
  kulay na band depende sa status (green pag approved, red pag declined),
  may maayos na info table, at may totoong button para sa portal link.
  Ang plain text na bersyon ay HINDI nawawala — siya pa rin ang fallback
  kapag hindi kaya ng email client ang HTML.

  TECHNICAL: Server-side HTML email layer. Apps Script global scope —
  Emails.js calls these with no imports. Table-based layout (Outlook's Word
  engine ignores div max-width; <table align="center" width="600"> is the
  only universal centering). ALL styles inline (email constraint). Every
  email* helper escapes its own inputs via escapeHtml() — send functions can
  compose helpers blindly; any value interpolated directly into a template
  must be escaped at the interpolation site. Colors hardcoded hex (email has
  no CSS vars), mirroring the frontend :root palette.

  OUTLINE:
    THEME + ESCAPING
      - EMAIL_THEME                         hex palette + font stack const
      - escapeHtml(value)                   server-side HTML entity escaper
    LAYOUT
      - emailLayout(opts)                   full document wrapper (header/band/body/button/footer)
      - emailButton(url, label)             bulletproof navy CTA button
      - emailDivider()                      full-width separator row (digest blocks)
    CONTENT BLOCKS
      - emailP(html)                        one styled paragraph
      - emailSection(title, innerHtml)      uppercase mini-heading + content
      - emailKeyValueRows(pairs)            2-col label/value table from [[k,v],...]
      - emailInfoTable(rowData)             HTML twin of buildInfoBlock()
      - emailAttachmentList(requestId)      HTML twin of buildAttachmentList()
      - emailApprovalLog(rowData, approvers) HTML twin of buildApprovalLog()
      - emailRemarkBox(label, text, tone)   tinted callout (red/amber/blue/green)
    SEND
      - sendBrandedEmail(recipient, subject, textBody, htmlBody, extraOptions)
*/


// ─── THEME + ESCAPING ───────────────────────────────────────

/*
  EMAIL_THEME — hex palette + font stack for all HTML emails.
  LAYMAN    : Ito ang "paint bucket" ng emails — parehong kulay ng portal
              (navy, green, red, amber) para iisa ang branding.
  TECHNICAL : Mirrors the frontend :root tokens. Hardcoded hex because email
              clients don't support CSS custom properties. fontStack is
              web-safe only — Google Fonts don't load in most email clients.
*/
const EMAIL_THEME = {
  navy:      "#0a2744",
  navyDark:  "#0d3460",
  blue:      "#185fa5",
  green:     "#3b6d11",
  amber:     "#ba7517",
  red:       "#a32d2d",
  blueTint:  "#e6f1fb",
  greenTint: "#eaf3de",
  amberTint: "#faeeda",
  redTint:   "#fcebeb",
  pageBg:    "#f1f4f8",
  text:      "#1a1a1a",
  muted:     "#5a6470",
  border:    "#e5eaf0",
  fontStack: "'Segoe UI', Arial, sans-serif",
};

/*
  Function Name: escapeHtml

  LAYMAN (Tropang Ex):
  Pang-ligtas bago isingit ang user-typed na text (project title, remarks,
  filenames) sa HTML ng email. Kung may nag-type ng "<script>" sa remark,
  lalabas itong harmless na text imbes na tumakbo bilang code.

  TECHNICAL:
  Server-side HTML entity escaper (& < > " '). The frontend escapeHtml in
  JavaScript.html is browser-scope only and unreachable from server code —
  no collision (different runtimes). null/undefined → "".

  PARAMS:
  - value — any; coerced to String, "" when null/undefined.

  RETURNS:
  Escaped string safe for HTML interpolation.
*/
function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}


// ─── LAYOUT ─────────────────────────────────────────────────

/*
  Function Name: emailLayout

  LAYMAN (Tropang Ex):
  Ito ang "frame" ng bawat email — yung Megaworld header sa taas, yung
  makulay na band na nagsasabi ng status (green = approved, red = declined,
  amber = returned, navy = may kailangan kang gawin), yung puting content
  area sa gitna, optional na button, at footer na may infosec contact.
  Ibinibigay mo lang ang laman (bodyHtml), siya na ang bahala sa balot.

  TECHNICAL:
  Sole owner of email scaffolding. Outer 100%-width table (page bg) →
  centered 600px table → navy header cell (wordmark + sub-label) → 4px
  accent band row → white content cell → optional centered button row →
  muted footer. bgcolor/width attrs duplicated alongside inline styles for
  Outlook. bodyHtml is trusted helper output (already escaped at source).

  PARAMS:
  - opts.accent      — 'navy' | 'green' | 'red' | 'amber' (default 'navy').
  - opts.bodyHtml    — inner HTML (compose from emailP/emailSection/etc).
  - opts.buttonUrl   — optional; renders emailButton when present.
  - opts.buttonLabel — optional; button text (default "Open this request").

  RETURNS:
  Complete HTML document string for GmailApp's htmlBody option.

  STEPS
    Step 1 — Resolve the accent color
      Layman    : Piliin ang kulay ng band galing sa status ng email.
      Technical : Map accent key → EMAIL_THEME hex; navy fallback.
    Step 2 — Build header + band
      Layman    : Megaworld wordmark sa navy na header, tapos manipis na
                  makulay na linya sa ilalim nito.
      Technical : Navy bgcolor cell + 4px accent cell (border trick avoided —
                  a real <td> with height keeps Outlook honest).
    Step 3 — Wrap content + optional button + footer
      Layman    : Ilagay ang laman sa puting card, idagdag ang button kung
                  meron, tapos ang footer sa dulo.
      Technical : White content td (24px padding) renders bodyHtml; button
                  row via emailButton(); footer td in 12px muted text.

  EXAMPLE
    emailLayout({ accent: 'green', bodyHtml: emailP('Good day!'),
                  buttonUrl: getPortalUrl(id, 'request') })
    → '<table width="100%" ...>…MEGAWORLD…Good day!…Open this request…</table>'
*/
function emailLayout(opts) {
  opts = opts || {};
  const accentMap = {
    navy:  EMAIL_THEME.navy,
    green: EMAIL_THEME.green,
    red:   EMAIL_THEME.red,
    amber: EMAIL_THEME.amber,
  };
  const accent = accentMap[opts.accent] || EMAIL_THEME.navy;

  const buttonRow = opts.buttonUrl
    ? '<tr><td align="center" bgcolor="#ffffff" ' +
        'style="background-color: #ffffff; padding: 8px 24px 28px;">' +
        emailButton(opts.buttonUrl, opts.buttonLabel || "Open this request") +
      "</td></tr>"
    : "";

  return (
    '<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="' + EMAIL_THEME.pageBg + '" ' +
      'style="background-color:' + EMAIL_THEME.pageBg + '; padding: 24px 0; margin: 0;">' +
      "<tr><td align=\"center\">" +
        '<table width="600" cellpadding="0" cellspacing="0" border="0" align="center" ' +
          'style="width: 600px; max-width: 100%;">' +

          // Header — navy band with the wordmark
          '<tr><td bgcolor="' + EMAIL_THEME.navy + '" ' +
            'style="background-color:' + EMAIL_THEME.navy + "; padding: 20px 24px; " +
            "font-family:" + EMAIL_THEME.fontStack + ';">' +
            '<div style="font-size: 15px; font-weight: 700; color: #ffffff; letter-spacing: 0.08em;">MEGAWORLD</div>' +
            '<div style="font-size: 11px; color: #c5d4e3; letter-spacing: 0.04em; padding-top: 2px;">E-CERTIFICATE PORTAL</div>' +
          "</td></tr>" +

          // Accent band — 4px status color
          '<tr><td bgcolor="' + accent + '" height="4" ' +
            'style="background-color:' + accent + '; height: 4px; line-height: 4px; font-size: 0;">&nbsp;</td></tr>' +

          // Content
          '<tr><td bgcolor="#ffffff" style="background-color: #ffffff; padding: 28px 24px 12px; ' +
            "font-family:" + EMAIL_THEME.fontStack + ';">' +
            (opts.bodyHtml || "") +
          "</td></tr>" +

          buttonRow +

          // Footer
          '<tr><td style="padding: 16px 24px; font-family:' + EMAIL_THEME.fontStack + "; " +
            "font-size: 12px; line-height: 1.5; color:" + EMAIL_THEME.muted + ';">' +
            "Megaworld E-Certificate Portal &middot; automated notification<br>" +
            "Questions about email authenticity? Contact " +
            '<a href="mailto:infosec@megaworldcorp.com" style="color:' + EMAIL_THEME.blue + ';">infosec@megaworldcorp.com</a>' +
          "</td></tr>" +

        "</table>" +
      "</td></tr>" +
    "</table>"
  );
}

/*
  Function Name: emailButton

  LAYMAN (Tropang Ex):
  Yung "Open this request" na button sa email — totoong button na navy,
  hindi mahabang URL. Mas malinaw, mas pipindutin ng approver.

  TECHNICAL:
  Bulletproof button: single-cell table with bgcolor + padded inline-styled
  <a> (display:inline-block) — survives Outlook. ALWAYS navy: a red/amber
  CTA reads as a warning and suppresses clicks; the header accent band
  carries the status signal instead. URL passed through escapeHtml (it's
  encodeURIComponent-built upstream, but uniform escaping is free).

  PARAMS:
  - url   — href (use getPortalUrl(); never hand-build deep links).
  - label — button text.

  RETURNS:
  HTML string — a one-cell table wrapping the styled anchor.
*/
function emailButton(url, label) {
  return (
    '<table cellpadding="0" cellspacing="0" border="0" align="center"><tr>' +
      '<td bgcolor="' + EMAIL_THEME.navy + '" style="background-color:' + EMAIL_THEME.navy + "; " +
        'border-radius: 6px;">' +
        '<a href="' + escapeHtml(url) + '" ' +
          'style="display: inline-block; padding: 12px 28px; font-family:' + EMAIL_THEME.fontStack + "; " +
          'font-size: 14px; font-weight: 600; color: #ffffff; text-decoration: none;">' +
          escapeHtml(label) +
        "</a>" +
      "</td>" +
    "</tr></table>"
  );
}

/*
  Function Name: emailDivider
  LAYMAN    : Manipis na linya na naghihiwalay ng mga request blocks sa
              digest email (yung isang email na maraming requests).
  TECHNICAL : Full-width border-top div; spacing above/below.
  PARAMS    : (none)
  RETURNS   : HTML string.
*/
function emailDivider() {
  return '<div style="border-top: 1px solid ' + EMAIL_THEME.border + '; margin: 20px 0;"></div>';
}


// ─── CONTENT BLOCKS ─────────────────────────────────────────

/*
  Function Name: emailP
  LAYMAN    : Isang paragraph na may tamang font at spacing para sa email.
  TECHNICAL : <p> with inline styles. Caller passes PRE-ESCAPED content
              (or composed helper output) — this does NOT escape, so
              callers can embed <strong>/<a> when needed.
  PARAMS    : html — inner HTML (escape user values at the call site!).
  RETURNS   : HTML string.
*/
function emailP(html) {
  return '<p style="margin: 0 0 16px; font-family:' + EMAIL_THEME.fontStack + "; " +
    "font-size: 14px; line-height: 1.5; color:" + EMAIL_THEME.text + ';">' + html + "</p>";
}

/*
  Function Name: emailSection
  LAYMAN    : May maliit na uppercase na title (hal. "SUPPORTING DOCUMENTS")
              tapos yung laman sa ilalim — kapalit ng mga "Label:" sa
              plain-text emails.
  TECHNICAL : Overline-style heading (11px/600/uppercase, muted) + content
              div. Title escaped here; innerHtml trusted (helper output).
  PARAMS    : title — section label; innerHtml — section content HTML.
  RETURNS   : HTML string.
*/
function emailSection(title, innerHtml) {
  return (
    '<div style="margin: 0 0 16px;">' +
      '<div style="font-family:' + EMAIL_THEME.fontStack + "; font-size: 11px; font-weight: 600; " +
        "text-transform: uppercase; letter-spacing: 0.06em; color:" + EMAIL_THEME.muted + "; " +
        "padding-bottom: 6px; border-bottom: 1px solid " + EMAIL_THEME.border + '; margin-bottom: 8px;">' +
        escapeHtml(title) +
      "</div>" +
      innerHtml +
    "</div>"
  );
}

/*
  Function Name: emailKeyValueRows

  LAYMAN (Tropang Ex):
  Gumagawa ng maliit na two-column table: label sa kaliwa (kulay gray),
  value sa kanan. Para sa mga "Returned by: x", "Date of Action: y" na
  dating nakahilera lang sa plain text.

  TECHNICAL:
  Iterates [ [key, value], ... ] pairs → <table> rows. Both key and value
  escaped here. Empty/null values render an em dash.

  PARAMS:
  - pairs — array of [label, value] tuples.

  RETURNS:
  HTML string — a full-width borderless table.
*/
function emailKeyValueRows(pairs) {
  const rows = (pairs || []).map(function (p) {
    const val = (p[1] == null || p[1] === "") ? "&mdash;" : escapeHtml(p[1]);
    return "<tr>" +
      '<td style="font-family:' + EMAIL_THEME.fontStack + "; font-size: 13px; color:" + EMAIL_THEME.muted + "; " +
        'padding: 4px 16px 4px 0; vertical-align: top; white-space: nowrap;">' + escapeHtml(p[0]) + "</td>" +
      '<td style="font-family:' + EMAIL_THEME.fontStack + "; font-size: 13px; color:" + EMAIL_THEME.text + "; " +
        'padding: 4px 0; vertical-align: top;">' + val + "</td>" +
    "</tr>";
  }).join("");
  return '<table cellpadding="0" cellspacing="0" border="0" style="margin: 0 0 16px;">' + rows + "</table>";
}

/*
  Function Name: emailInfoTable
  LAYMAN    : HTML na kapatid ng buildInfoBlock() — yung apat na laging
              kasama sa bawat email: title, control number, requestor, group.
  TECHNICAL : Same CR reads as buildInfoBlock (Emails.js); values escaped
              by emailKeyValueRows. Group id resolved via getGroupNameById.
  PARAMS    : rowData — the 25-col Requests row array (0-based reads).
  RETURNS   : HTML string — key/value table.
*/
function emailInfoTable(rowData) {
  return emailKeyValueRows([
    ["E-Certificate Title", rowData[CR.PROJECT_TITLE - 1]],
    ["E-Certificate ID",    rowData[CR.CONTROL_NUMBER - 1]],
    ["Requestor",           rowData[CR.REQUESTOR - 1]],
    ["Group",               getGroupNameById(rowData[CR.GROUP - 1])],
  ]);
}

/*
  Function Name: emailAttachmentList
  LAYMAN    : HTML na listahan ng mga supporting documents — filename at
              description bawat isa. WALANG links sa files — sadyang ganoon,
              kasi gated ang file serving (dapat dumaan sa portal).
  TECHNICAL : HTML twin of buildAttachmentList() (Emails.js). Same source
              (getAttachmentsForRequest) + same empty-state copy. Filenames
              and descriptions escaped. Deliberately NO file URLs.
  PARAMS    : requestId — the request id.
  RETURNS   : HTML string — <ul> of items, or a muted empty-state line.
*/
function emailAttachmentList(requestId) {
  const attachments = getAttachmentsForRequest(requestId);
  if (attachments.length === 0) {
    return '<div style="font-family:' + EMAIL_THEME.fontStack + "; font-size: 13px; color:" + EMAIL_THEME.muted + ';">' +
      "No supporting documents uploaded.</div>";
  }
  const items = attachments.map(function (row) {
    return '<li style="margin: 0 0 4px;">' +
      "<strong>" + escapeHtml(row[RA.FILE - 1]) + "</strong>" +
      (row[RA.DESCRIPTION - 1] ? " &mdash; " + escapeHtml(row[RA.DESCRIPTION - 1]) : "") +
    "</li>";
  }).join("");
  return '<ul style="font-family:' + EMAIL_THEME.fontStack + "; font-size: 13px; color:" + EMAIL_THEME.text + "; " +
    'line-height: 1.5; margin: 0; padding-left: 18px;">' + items + "</ul>";
}

/*
  Function Name: emailApprovalLog
  LAYMAN    : HTML na bersyon ng approval history — sino-sinong approver na
              ang pumirma at kailan. Galing pa rin sa Activity_Log timeline.
  TECHNICAL : HTML twin of buildApprovalLog() (Emails.js) — same
              getApprovalView() per-step reads + same slot resolution +
              same "No approvals recorded yet." fallback. Emails escaped.
  PARAMS    : rowData — Requests row array; approvers — getApprovers() shape.
  RETURNS   : HTML string — key/value rows per acted step, or fallback line.
*/
function emailApprovalLog(rowData, approvers) {
  const view = getApprovalView(rowData[CR.REQUEST_ID - 1]);
  const slot = function (n) {
    return n === 1 ? approvers.approver1 : n === 2 ? approvers.approver2 : approvers.approver3;
  };
  const pairs = [];
  [1, 2, 3].forEach(function (n) {
    const s = view.byStep[n];
    if (s && s.date) {
      pairs.push(["Approver " + n, (slot(n) || "—") + " · " + formatPHTime(new Date(s.date))]);
    }
  });
  if (pairs.length === 0) {
    return '<div style="font-family:' + EMAIL_THEME.fontStack + "; font-size: 13px; color:" + EMAIL_THEME.muted + ';">' +
      "No approvals recorded yet.</div>";
  }
  return emailKeyValueRows(pairs);
}

/*
  Function Name: emailRemarkBox

  LAYMAN (Tropang Ex):
  Makulay na kahon para sa mga importanteng mensahe — dahilan ng decline
  (pula), dahilan ng return (amber), paalala (blue), good news (green).
  Para agad makita ng mata kahit mabilis lang binasa ang email.

  TECHNICAL:
  Tinted callout box keyed by tone → tint bg + semantic text color (the
  pairs survive dark-mode inversion legibly). Label and text escaped here.

  PARAMS:
  - label — small bold lead-in (e.g. "Reason for decline"); optional.
  - text  — the message body (user-typed remarks go here — escaped).
  - tone  — 'red' | 'amber' | 'blue' | 'green' (default 'blue').

  RETURNS:
  HTML string — the tinted box.
*/
function emailRemarkBox(label, text, tone) {
  const tones = {
    red:   { bg: EMAIL_THEME.redTint,   fg: EMAIL_THEME.red },
    amber: { bg: EMAIL_THEME.amberTint, fg: EMAIL_THEME.amber },
    blue:  { bg: EMAIL_THEME.blueTint,  fg: EMAIL_THEME.blue },
    green: { bg: EMAIL_THEME.greenTint, fg: EMAIL_THEME.green },
  };
  const t = tones[tone] || tones.blue;
  return (
    '<div style="background-color:' + t.bg + "; border-radius: 6px; padding: 12px 16px; margin: 0 0 16px; " +
      "font-family:" + EMAIL_THEME.fontStack + '; font-size: 13px; line-height: 1.5;">' +
      (label
        ? '<div style="font-weight: 600; color:' + t.fg + '; margin-bottom: 4px;">' + escapeHtml(label) + "</div>"
        : "") +
      '<div style="color:' + EMAIL_THEME.text + ';">' + escapeHtml(text) + "</div>" +
    "</div>"
  );
}


// ─── SEND ───────────────────────────────────────────────────

/*
  Function Name: sendBrandedEmail

  LAYMAN (Tropang Ex):
  Isang pinto para sa lahat ng padala ng branded email. Binibigay mo yung
  recipient, subject, yung lumang plain-text body (fallback pa rin siya
  kapag hindi kaya ng email app ang HTML), at yung bagong HTML body.
  May extraOptions para sa mga special case tulad ng PDF attachment.

  TECHNICAL:
  Wraps GmailApp.sendEmail(recipient, subject, textBody, options) where
  options = { htmlBody } merged with extraOptions (e.g. {attachments:
  [cocBlob]}). The 3rd positional arg stays the plain-text fallback —
  existing body builders remain the source of truth for text clients.
  htmlBody does not affect GmailApp quota.

  PARAMS:
  - recipient    — email address.
  - subject      — from emailSubject() (EMAIL_DEV_TAG logic untouched).
  - textBody     — existing plain-text body (fallback).
  - htmlBody     — emailLayout() output.
  - extraOptions — optional object merged into options (attachments, etc).

  RETURNS:
  (nothing) — sends the email.

  EXAMPLE
    sendBrandedEmail(requestor, subject, body, html, { attachments: [pdf] })
    → one email; HTML in Gmail, plain text in text-only clients, PDF attached.
*/
function sendBrandedEmail(recipient, subject, textBody, htmlBody, extraOptions) {
  const options = Object.assign({ htmlBody: htmlBody }, extraOptions || {});
  GmailApp.sendEmail(recipient, subject, textBody, options);
}

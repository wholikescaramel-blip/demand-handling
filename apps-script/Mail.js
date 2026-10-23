/**
 * Optional: lets the dashboard's "Send by email" button send a purchase order from your Gmail.
 *
 * Deploy once: Deploy > New deployment > type "Web app" > Execute as "Me" > Who has access "Anyone" > Deploy.
 * Paste the web app URL into the dashboard's MAIL_WEBHOOK_URL setting in Vercel.
 *
 * The URL is public, so every request must carry the shared secret (the same SYNC_SECRET the dashboard uses).
 * Without it the script refuses to send anything.
 */
function doPost(e) {
  try {
    var req = JSON.parse(e.postData.contents);
    var secret = prop_('SYNC_SECRET');
    if (!secret || req.secret !== secret) return mailReply_({ ok: false, error: 'Wrong or missing secret.' });

    var to = String(req.to || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)) return mailReply_({ ok: false, error: 'Invalid recipient.' });
    if (!req.pdf_base64) return mailReply_({ ok: false, error: 'No PDF attached.' });

    var bytes = Utilities.base64Decode(req.pdf_base64);
    var blob = Utilities.newBlob(bytes, 'application/pdf', String(req.filename || 'purchase-order.pdf'));
    MailApp.sendEmail({
      to: to,
      subject: String(req.subject || 'Purchase order').slice(0, 200),
      body: String(req.body || '').slice(0, 5000),
      attachments: [blob]
    });
    return mailReply_({ ok: true });
  } catch (err) {
    return mailReply_({ ok: false, error: String(err && err.message || err).slice(0, 200) });
  }
}

function mailReply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// src/utils/pitchEmail.js — SINGLE SOURCE of the GSRTC LED pitch email body.
//
// Used by the post-presentation "Email the pitch" send (PresentView →
// sendAppEmail kind='pitch' → api/email/send.js sends this `html` VERBATIM).
// api/email/send.js appends the rep's signature banner after it and Resend
// wraps it, so this returns the centred email body (no <!doctype>/<head>).
//
// LOCKSTEP: the standalone manual-send preview at public/email/gsrtc-led.html
// mirrors this exact card markup (its <head> adds a <style> animation layer that
// Gmail strips anyway; the inline styles here carry the whole design). Edit both
// together — this module is the source for the in-app send.
//
// Gmail strips CSS animation + <style>, so this body is table-based + fully
// inline-styled + hosted absolute image URLs (app.untitledad.in) — Gmail-safe.

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

/**
 * Build the GSRTC LED pitch email. Pass the lead's name for a warm greeting
 * (omitted when blank — the generic version matches the hosted preview file).
 * Returns { subject, html }.
 */
export function buildPitchEmail({ name } = {}) {
  const nm = String(name || '').trim()
  const subject = 'GSRTC LED Screen Advertising — reach measured, not estimated'

  const greetRow = nm
    ? `<tr><td class="pad" style="padding:18px 30px 0;background:#0A0E1A;">
          <div class="bd" style="font-family:'DM Sans',Arial,Helvetica,sans-serif;color:#c3cad6;font-size:15px;line-height:22px;">Hi ${esc(nm)}, thanks for your time today — here's the GSRTC LED network in one page.</div>
        </td></tr>`
    : ''

  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#05070f;">
    <tr><td align="center" style="padding:26px 12px;">

      <table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#0A0E1A;border:1px solid #1b2233;border-radius:16px;overflow:hidden;">

        <!-- HEADER -->
        <tr><td class="pad" style="padding:20px 30px;background:#0A0E1A;border-bottom:1px solid #161d2c;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td align="left" valign="middle">
              <img src="https://app.untitledad.in/investor/brandmark.png" width="132" alt="Untitled" style="height:auto;width:132px;max-width:132px;">
            </td>
            <td align="right" valign="middle">
              <table role="presentation" cellpadding="0" cellspacing="0" style="display:inline-block;"><tr>
                <td style="background:#111a10;border:1px solid #2a3a1a;border-radius:999px;padding:6px 12px;">
                  <span class="live-dot" style="display:inline-block;width:8px;height:8px;background:#FFE600;border-radius:999px;vertical-align:middle;"></span>
                  <span class="px" style="font-family:'Space Grotesk',Arial,sans-serif;color:#FFE600;font-size:11px;font-weight:700;letter-spacing:2px;vertical-align:middle;">&nbsp;LIVE NETWORK</span>
                </td>
              </tr></table>
            </td>
          </tr></table>
        </td></tr>
        ${greetRow}
        <!-- HERO -->
        <tr><td style="background:#0A0E1A;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td background="https://app.untitledad.in/deck/station-1.jpg" valign="bottom" style="background:#0A0E1A url('https://app.untitledad.in/deck/station-1.jpg') center/cover no-repeat;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(180deg,rgba(10,14,26,0.35) 0%,rgba(10,14,26,0.86) 78%,#0A0E1A 100%);"><tr>
                <td class="pad" style="padding:78px 30px 26px 30px;">
                  <div class="px" style="font-family:'Space Grotesk',Arial,sans-serif;color:#FFE600;font-size:12px;font-weight:700;letter-spacing:3px;text-transform:uppercase;">GSRTC LED SCREEN NETWORK · GUJARAT</div>
                  <div class="px px-h1" style="font-family:'Space Grotesk',Arial,sans-serif;color:#ffffff;font-size:38px;line-height:42px;font-weight:700;margin-top:12px;">We don't hope your ad<br>was seen. <span style="color:#FFE600;">We prove it.</span></div>
                  <div class="bd" style="font-family:'DM Sans',Arial,sans-serif;color:#c3cad6;font-size:15px;line-height:22px;margin-top:14px;max-width:430px;">LED screens inside Gujarat's busiest bus stations. A camera on every screen counts the real people who saw your ad — and a QR turns them into a WhatsApp lead.</div>
                </td>
              </tr></table>
            </td>
          </tr></table>
        </td></tr>

        <!-- STAT BAND -->
        <tr><td style="background:#0A0E1A;padding:0 30px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0d1320;border:1px solid #1b2233;border-radius:12px;">
            <tr>
              <td class="stat-td" width="25%" align="center" style="padding:18px 6px;border-right:1px solid #1b2233;">
                <div class="px" style="font-family:'Space Grotesk',Arial,sans-serif;color:#FFE600;font-size:26px;font-weight:700;">264</div>
                <div class="bd" style="font-family:'DM Sans',Arial,sans-serif;color:#8a93a3;font-size:11px;letter-spacing:1px;text-transform:uppercase;margin-top:3px;">LED screens</div>
              </td>
              <td class="stat-td" width="25%" align="center" style="padding:18px 6px;border-right:1px solid #1b2233;">
                <div class="px" style="font-family:'Space Grotesk',Arial,sans-serif;color:#ffffff;font-size:26px;font-weight:700;">20</div>
                <div class="bd" style="font-family:'DM Sans',Arial,sans-serif;color:#8a93a3;font-size:11px;letter-spacing:1px;text-transform:uppercase;margin-top:3px;">Bus stations</div>
              </td>
              <td class="stat-td" width="25%" align="center" style="padding:18px 6px;border-right:1px solid #1b2233;">
                <div class="px" style="font-family:'Space Grotesk',Arial,sans-serif;color:#ffffff;font-size:26px;font-weight:700;">~14h</div>
                <div class="bd" style="font-family:'DM Sans',Arial,sans-serif;color:#8a93a3;font-size:11px;letter-spacing:1px;text-transform:uppercase;margin-top:3px;">Play / day</div>
              </td>
              <td class="stat-td" width="25%" align="center" style="padding:18px 6px;">
                <div class="px" style="font-family:'Space Grotesk',Arial,sans-serif;color:#FFE600;font-size:26px;font-weight:700;">₹75</div>
                <div class="bd" style="font-family:'DM Sans',Arial,sans-serif;color:#8a93a3;font-size:11px;letter-spacing:1px;text-transform:uppercase;margin-top:3px;">Start from</div>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- CITY STRIP (static, wraps) -->
        <tr><td class="pad" style="background:#0A0E1A;padding:18px 30px 6px 30px;">
          <div style="background:#0d1320;border:1px solid #1b2233;border-radius:12px;padding:12px 16px;text-align:center;">
            <span class="px" style="font-family:'Space Grotesk',Arial,sans-serif;color:#c3cad6;font-size:12px;line-height:20px;letter-spacing:1.5px;text-transform:uppercase;">VERAVAL&nbsp; ·&nbsp; BHAVNAGAR&nbsp; ·&nbsp; GANDHINAGAR&nbsp; ·&nbsp; JUNAGADH&nbsp; ·&nbsp; ANAND&nbsp; ·&nbsp; MORBI&nbsp; ·&nbsp; BOTAD&nbsp; ·&nbsp; DWARKA&nbsp; ·&nbsp; PORBANDAR&nbsp; ·&nbsp; JAMNAGAR&nbsp; ·&nbsp; <span style="color:#FFE600;">+ 10 MORE STATIONS</span></span>
          </div>
        </td></tr>

        <!-- THE MOAT -->
        <tr><td class="pad" style="background:#0A0E1A;padding:28px 30px 6px 30px;">
          <div class="px" style="font-family:'Space Grotesk',Arial,sans-serif;color:#ffffff;font-size:20px;font-weight:700;">Every other billboard sells you space.<br>We sell you <span style="color:#FFE600;">proof</span>.</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">
            <tr>
              <td class="stack" width="50%" valign="top" style="padding:0 8px 0 0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0d1320;border:1px solid #1b2233;border-radius:12px;"><tr><td style="padding:16px 16px;">
                  <div class="px" style="font-family:'Space Grotesk',Arial,sans-serif;color:#FFE600;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">AI-verified views</div>
                  <div class="bd" style="font-family:'DM Sans',Arial,sans-serif;color:#c3cad6;font-size:14px;line-height:20px;margin-top:6px;">A camera on each screen counts real people — age &amp; gender bands, dwell time. You get numbers, not an estimate.</div>
                </td></tr></table>
              </td>
              <td class="stack" width="50%" valign="top" style="padding:0 0 0 8px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0d1320;border:1px solid #1b2233;border-radius:12px;"><tr><td style="padding:16px 16px;">
                  <div class="px" style="font-family:'Space Grotesk',Arial,sans-serif;color:#FFE600;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Scan → lead</div>
                  <div class="bd" style="font-family:'DM Sans',Arial,sans-serif;color:#c3cad6;font-size:14px;line-height:20px;margin-top:6px;">A QR on the screen sends the viewer straight to WhatsApp — every scan lands as a lead you can call.</div>
                </td></tr></table>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- PROOF: dashboard + funnel -->
        <tr><td class="pad" style="background:#0A0E1A;padding:24px 30px 6px 30px;">
          <div class="px" style="font-family:'Space Grotesk',Arial,sans-serif;color:#8a93a3;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">Real numbers, not a pitch</div>
          <div style="margin-top:12px;border:1px solid #1b2233;border-radius:12px;overflow:hidden;">
            <img src="https://app.untitledad.in/deck/dashboard-real.png" width="540" alt="Live AI audience dashboard" style="width:100%;max-width:540px;height:auto;display:block;">
          </div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;background:#0d1320;border:1px solid #1b2233;border-radius:12px;"><tr>
            <td align="center" style="padding:16px 4px;border-right:1px solid #1b2233;">
              <div class="px" style="font-family:'Space Grotesk',Arial,sans-serif;color:#ffffff;font-size:22px;font-weight:700;">742</div>
              <div class="bd" style="font-family:'DM Sans',Arial,sans-serif;color:#8a93a3;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-top:2px;">QR scans</div>
            </td>
            <td align="center" style="padding:16px 4px;border-right:1px solid #1b2233;">
              <div class="px" style="font-family:'Space Grotesk',Arial,sans-serif;color:#ffffff;font-size:22px;font-weight:700;">177</div>
              <div class="bd" style="font-family:'DM Sans',Arial,sans-serif;color:#8a93a3;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-top:2px;">Messaged us</div>
            </td>
            <td align="center" style="padding:16px 4px;">
              <div class="px" style="font-family:'Space Grotesk',Arial,sans-serif;color:#FFE600;font-size:22px;font-weight:700;">174</div>
              <div class="bd" style="font-family:'DM Sans',Arial,sans-serif;color:#8a93a3;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-top:2px;">Real leads</div>
            </td>
          </tr></table>
          <div class="bd" style="font-family:'DM Sans',Arial,sans-serif;color:#707a8a;font-size:12px;margin-top:8px;text-align:center;">Government-approved · GSRTC authorised media · high-brightness LED, ~1,000+ people/day per screen.</div>
        </td></tr>

        <!-- CTA -->
        <tr><td class="pad" style="background:#0A0E1A;padding:26px 30px 30px 30px;">
          <div class="px" style="font-family:'Space Grotesk',Arial,sans-serif;color:#ffffff;font-size:22px;font-weight:700;text-align:center;">Put your brand on the screens.</div>
          <div class="bd" style="font-family:'DM Sans',Arial,sans-serif;color:#c3cad6;font-size:14px;text-align:center;margin-top:8px;">Tell us your city and we'll show you what it costs — in minutes.</div>
          <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:20px auto 0 auto;">
            <tr><td align="center" class="cta-shim" style="border-radius:999px;background:#FFE600;">
              <a href="https://wa.me/919898273686?text=Hi%2C%20I%20want%20to%20advertise%20on%20the%20GSRTC%20LED%20screens." class="px" style="display:inline-block;font-family:'Space Grotesk',Arial,sans-serif;color:#0A0E1A;font-size:16px;font-weight:700;letter-spacing:.3px;padding:15px 34px;border-radius:999px;">Chat on WhatsApp →</a>
            </td></tr>
          </table>
          <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:14px auto 0 auto;"><tr>
            <td style="padding:0 6px;"><a href="tel:+919898273686" class="px" style="display:inline-block;font-family:'Space Grotesk',Arial,sans-serif;color:#ffffff;font-size:14px;font-weight:700;border:1px solid #2a3346;border-radius:999px;padding:11px 22px;">Call 98982 73686</a></td>
            <td style="padding:0 6px;"><a href="https://app.untitledad.in/led" class="px" style="display:inline-block;font-family:'Space Grotesk',Arial,sans-serif;color:#FFE600;font-size:14px;font-weight:700;border:1px solid #2a3a1a;border-radius:999px;padding:11px 22px;">See it live →</a></td>
          </tr></table>
        </td></tr>

        <!-- FOOTER -->
        <tr><td class="pad" style="background:#080b14;padding:22px 30px;border-top:1px solid #161d2c;">
          <img src="https://app.untitledad.in/investor/brandmark.png" width="104" alt="Untitled" style="width:104px;height:auto;opacity:0.9;">
          <div class="bd" style="font-family:'DM Sans',Arial,sans-serif;color:#707a8a;font-size:12px;line-height:18px;margin-top:10px;">Untitled Advertising · Vadodara, Gujarat<br>Outdoor · Indoor · Social · Print / TV<br><a href="https://wa.me/919898273686" style="color:#FFE600;">WhatsApp 98982 73686</a> &nbsp;·&nbsp; <a href="https://app.untitledad.in/led" style="color:#8a93a3;">app.untitledad.in/led</a></div>
        </td></tr>

      </table>
      <div class="bd" style="font-family:'DM Sans',Arial,sans-serif;color:#3a4353;font-size:11px;margin-top:14px;">Sent by Untitled Advertising. GSRTC authorised media.</div>

    </td></tr>
  </table>`

  return { subject, html }
}

import os
import smtplib
from email.message import EmailMessage


def _mail_config():
    server = os.environ.get('MAIL_SERVER') or os.environ.get('SMTP_HOST') or ''
    port = int(os.environ.get('MAIL_PORT', os.environ.get('SMTP_PORT', '587')))
    username = os.environ.get('MAIL_USERNAME') or os.environ.get('SMTP_USER') or ''
    password = os.environ.get('MAIL_PASSWORD') or os.environ.get('SMTP_PASSWORD') or ''
    use_tls = str(os.environ.get('MAIL_USE_TLS', os.environ.get('SMTP_TLS', 'true'))).lower() in {'1', 'true', 'yes', 'on'}
    use_ssl = str(os.environ.get('MAIL_USE_SSL', 'false')).lower() in {'1', 'true', 'yes', 'on'}
    sender = os.environ.get('MAIL_DEFAULT_SENDER') or os.environ.get('SMTP_FROM') or 'JanRaksha AI <noreply@janraksha.local>'
    return server, port, username, password, use_tls, use_ssl, sender


def _send_email_message(recipient_email, subject, html_body, text_body=None):
    server, port, username, password, use_tls, use_ssl, sender = _mail_config()
    if not recipient_email or not server or not sender:
        raise RuntimeError('SMTP configuration missing.')
    text_body = text_body or 'JanRaksha AI notification.'
    message = EmailMessage()
    message['Subject'] = subject
    message['From'] = sender
    message['To'] = recipient_email
    message.set_content(text_body)
    message.add_alternative(html_body, subtype='html')
    smtp_client = smtplib.SMTP_SSL if use_ssl else smtplib.SMTP
    with smtp_client(server, port, timeout=10) as client:
        if use_tls and not use_ssl:
            client.starttls()
        if username:
            client.login(username, password)
        client.send_message(message)
    return True


def build_verified_match_email(case_id, user_name, email):
    subject = f'JanRaksha AI — Important Update for Case {case_id}'
    html = f"""
    <html>
      <body style="margin:0;padding:0;background:#f4f7fb;font-family:Arial,sans-serif;color:#1d2433;">
        <div style="max-width:640px;margin:32px auto;background:#ffffff;border:1px solid #dfe7f1;border-radius:12px;overflow:hidden;">
          <div style="padding:24px 28px;background:#0b4f6c;color:#ffffff;">
            <div style="font-size:24px;font-weight:700;">JanRaksha AI</div>
            <div style="font-size:14px;opacity:0.9;margin-top:6px;">AI-Assisted Missing Person Identification & Public Safety Platform</div>
          </div>
          <div style="padding:28px;">
            <h2 style="margin:0 0 18px;color:#16324f;">Case update for {case_id}</h2>
            <p style="margin:0 0 14px;line-height:1.6;">Hello {user_name},</p>
            <p style="margin:0 0 14px;line-height:1.6;">There has been an important update regarding your missing-person case.</p>
            <div style="background:#f2f8fb;padding:16px;border-left:4px solid #0b4f6c;border-radius:8px;margin:20px 0;">
              <p style="margin:0 0 8px;"><strong>Case ID:</strong> {case_id}</p>
              <p style="margin:0 0 8px;"><strong>Case Status:</strong> Person Found</p>
              <p style="margin:0;">An authorized investigator has reviewed a potential match and verified the result based on the available case information.</p>
            </div>
            <p style="margin:0 0 22px;line-height:1.6;">Please sign in to JanRaksha AI to view the latest case details and investigation timeline.</p>
            <div style="text-align:center;margin:18px 0 28px;">
              <a href="https://example.invalid/login" style="display:inline-block;background:#0b4f6c;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;">View Case</a>
            </div>
            <p style="margin:0 0 14px;line-height:1.6; color:#53657c;">This notification is based on an authorized human verification and is not generated solely from an AI similarity score.</p>
            <p style="margin:0;line-height:1.6;color:#53657c;">Do not share private photographs or investigation notes in email without secure authorization.</p>
          </div>
          <div style="background:#edf3f8;padding:16px 28px;color:#53657c;font-size:12px;line-height:1.6;">
            JanRaksha AI • AI-Assisted Missing Person Identification & Public Safety Platform
          </div>
        </div>
      </body>
    </html>
    """
    text = (
        f"Hello {user_name},\n\n"
        f"There has been an important update regarding your missing-person case.\n\n"
        f"Case ID: {case_id}\n"
        "Case Status: Person Found\n\n"
        "An authorized investigator has reviewed a potential match and verified the result based on the available case information.\n\n"
        "Please sign in to JanRaksha AI to view the latest case details and investigation timeline.\n\n"
        "This notification is based on an authorized human verification and is not generated solely from an AI similarity score.\n"
        "JanRaksha AI\nAI-Assisted Missing Person Identification & Public Safety Platform"
    )
    return subject, html, text


def send_verified_match_email(case_id, user_name, recipient_email):
    subject, html_body, text_body = build_verified_match_email(case_id, user_name, recipient_email)
    return _send_email_message(recipient_email, subject, html_body, text_body)


def send_case_update_email(case_id, user_name, recipient_email, case_status='PERSON_FOUND'):
    subject = f'JanRaksha AI — Important Update for Case {case_id}'
    html = f"""<html><body><h2>Case Update</h2><p>Hello {user_name},</p><p>Case ID: {case_id}</p><p>Current status: {case_status}</p><p>Your case has been updated by an authorized investigator.</p></body></html>"""
    text = f"Hello {user_name},\nCase ID: {case_id}\nCurrent status: {case_status}\nYour case has been updated by an authorized investigator."
    return _send_email_message(recipient_email, subject, html, text)


def send_notification_email(recipient_email, subject, message):
    html = f"<html><body><p>{message}</p></body></html>"
    return _send_email_message(recipient_email, subject, html, message)

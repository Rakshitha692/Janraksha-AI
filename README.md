<<<<<<< HEAD
# JanRaksha AI

JanRaksha AI is a responsible, AI-assisted missing-person case-management prototype. It uses synthetic data only. Similarity output is a potential lead, never an identification.

## Run on Windows

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe seed.py
.\.venv\Scripts\python.exe app.py
```

Open `http://127.0.0.1:5000`. The seeded investigator account is `investigator@janraksha.demo` / `DemoPass123!`.

In VS Code, use **Terminal: Run Task** and select **Run JanRaksha (project virtual environment)** to start the server with the project's supported OpenCV dependency. Stop any existing server first; a server already running under another Python interpreter will keep using that interpreter.

By default it uses `sqlite:///janraksha.db` for an immediately runnable demo. For MySQL, create a database and set `DATABASE_URL=mysql+pymysql://USER:PASSWORD@localhost/janraksha` before running. Copy `.env.example` values into your environment; never commit real credentials.

## Architecture

Flask routes, SQLAlchemy models, secure Werkzeug password hashes, role checks, upload validation, session authentication, and a database-backed timeline/notifications workflow live in `app.py`. The browser client is in `frontend/` and calls the REST API exclusively. Uploads are stored locally in `uploads/`.

The general missing-person search uses its existing normalized grayscale image descriptor. The separate live webcam reference registry uses OpenCV Zoo's YuNet detector and SFace identity embeddings, with facial landmark alignment for registration and each live frame. The two required ONNX files are included in `models/`. Webcam leads require an SFace cosine score of at least 0.60 (an 80% relative display score) and still require human verification; no face matcher can guarantee 100% accuracy across lighting, pose, camera, and image quality.

The Live webcam page has its own webcam-only reference registry. Each account sees, matches, and removes only its own references; webcam reference photos are also served only to their registering account. Registration accepts only a clear face photo. The registry remains separate from missing-person cases. The page compares each detected face with that account's active references and displays the top lead for each face. It accepts uploaded video files and direct HTTP/HTTPS/RTSP/RTSPS video or stream URLs; video scans sample frames and return the highest similarity lead for human review. URL hosts must resolve to public IP addresses, and the media must be readable by the server OpenCV/FFmpeg installation. Web-page links such as a YouTube watch page are not direct media URLs. Uploaded files are validated by OpenCV/FFmpeg, so supported containers and codecs depend on the server installation. Video uploads default to a 100 MB limit and scans default to 60 samples over at most 120 seconds; HTTP(S) video files are sampled across their duration, while RTSP(S) sources use live-stream sampling. Configure `MAX_VIDEO_UPLOAD_MB`, `MAX_VIDEO_SAMPLE_FRAMES`, and `MAX_VIDEO_SCAN_SECONDS` in `.env` as needed. Face tracking is held in the running application process; use a shared tracker for multi-worker production deployments. Restart the Flask server after updating code so the new webcam model is loaded.

## Emergency contacts and email alerts

An `ADMIN_DEMO` user can add a verified regional emergency contact through `POST /api/emergency-contacts`; the emergency page provides a `tel:` call action only for configured numbers. Do not use the seeded `CONFIGURE` placeholder as a phone number.

SOS activation sends the alert message and location to the activating user's registered email and to each trusted contact with an email address. Duplicate addresses are sent only once. Phone push notifications are sent to the user's subscribed devices and to trusted contacts who have their own JanRaksha accounts and have enabled push. The lock-screen push message does not include the location. SMS delivery is not configured.

To enable real phone push alerts, install the updated requirements and host JanRaksha on an HTTPS domain. In Windows PowerShell, run `.\.venv\Scripts\vapid.exe --gen` and `.\.venv\Scripts\vapid.exe --applicationServerKey` from the project folder; copy the second command's output into `VAPID_PUBLIC_KEY` in `.env`. Set `VAPID_PRIVATE_KEY` to `./private_key.pem` and `VAPID_SUBJECT` to a contact email. Keep the private key file private; it is excluded from Git. After restarting the server, each recipient must open JanRaksha on each phone, sign in, open Emergency, choose **Enable phone notifications**, and allow the browser prompt. On iPhone/iPad, add the site to the Home Screen from Safari and open that installed web app before enabling notifications. Web push requires a service worker and a secure HTTPS origin, and the browser/OS must allow notifications. Push delivery counts appear with the SOS result. A trusted contact receives push only if that email is also registered to a JanRaksha account with a subscribed device.

For actual email delivery, copy `.env.example` to `.env`, replace the SMTP example values with your email provider's SMTP host, port, username, password or app password, and an allowed sender address, then restart the server. The app loads `.env` automatically. Without valid SMTP settings, SOS is still recorded in the app but email delivery will fail. Keep `.env` private; it is excluded from Git. When a found-person report produces a potential match, the registered case owner also receives an in-app notification; SMTP settings enable that email alert too.

## Core API

`/api/auth/register`, `/api/auth/login`, `/api/missing-persons`, `/api/ai/search`, `/api/sightings`, `/api/found-persons`, `/api/notifications`, `/api/dashboard/statistics`, and `/api/maps/events`.

## Safety and privacy

Restricted notes and case updates require investigator/admin roles. The application intentionally excludes government databases and any claim of automatic recognition. Configure regional emergency contacts outside source code and do not publish private contact details or precise home addresses.
=======
# Janraksha-AI
AI based missing person identification using deep learning and safety platform
>>>>>>> 5dd9e0301644696a41d979ad77ed4a4c61c5066f

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

The embedding adapter uses OpenCV face detection and a normalized descriptor fallback so the prototype can run locally without a large model. Replace `embedding_from_file()` with an approved ArcFace/FaceNet adapter for production. Its outputs must remain human-verification leads.

Live webcam monitoring is detection-only: it draws a separate box and temporary tracking label for each face detected in a frame. It does not compare webcam faces with missing-person records or confirm identity. Detection uses an OpenCV frontal-face Haar cascade and works best with clear, front-facing faces, adequate lighting, and close framing. Face tracking is held in the running application process; use a shared tracker for multi-worker production deployments.

## Emergency contacts and email alerts

An `ADMIN_DEMO` user can add a verified regional emergency contact through `POST /api/emergency-contacts`; the emergency page provides a `tel:` call action only for configured numbers. Do not use the seeded `CONFIGURE` placeholder as a phone number.

When a found-person report produces a potential match, the registered case owner always receives an in-app notification. To send that alert to their registered email address, configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM` from `.env.example` in the environment before starting the app.

## Core API

`/api/auth/register`, `/api/auth/login`, `/api/missing-persons`, `/api/ai/search`, `/api/sightings`, `/api/found-persons`, `/api/notifications`, `/api/dashboard/statistics`, and `/api/maps/events`.

## Safety and privacy

Restricted notes and case updates require investigator/admin roles. The application intentionally excludes government databases and any claim of automatic recognition. Configure regional emergency contacts outside source code and do not publish private contact details or precise home addresses.
=======
# Janraksha-AI
AI based missing person identification using deep learning and safety platform
>>>>>>> 5dd9e0301644696a41d979ad77ed4a4c61c5066f

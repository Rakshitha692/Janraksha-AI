# Police Portal

The Police Portal uses the application's existing Flask/SQLAlchemy database. By default, this is the local SQLite database; set `DATABASE_URL` to use a different persistent database. Running `app.py` or `seed.py` creates the `police_officers` and `emergency_cases` tables without replacing existing records.

Set a strong `SECRET_KEY` and configure `DATABASE_URL` consistently for the app and officer provisioning before production use.

## Provision an officer

There is no public police registration page and no default police account. From a trusted server or administrator environment, provision an account with the CLI. It prompts for a password without echoing it and saves a Werkzeug password hash:

```powershell
.\.venv\Scripts\python.exe create_police_officer.py --police-id POL-1001 --name "Officer Name" --email officer@example.com
```

An authenticated administrator may also create an account through `POST /api/police/officers`. Police Portal login accepts either the provisioned Police ID or registered email. Only a `POLICE_OFFICER` or administrator session can access police case records and APIs; public registration cannot grant privileged roles.

## Emergency reports

Reports from the existing Safety Community tiles (Accident, Fire, Medical, Police, Women Safety, and Child Safety) are stored in the database with a unique case ID, reporter/contact details when provided, description, location, optional coordinates and image, case status, assignment, and timestamps. The Police Portal dashboard lists newest cases first, supports category/status/date/search filters, and persists authorized status and assignment changes.

## Run

From the project root on Windows:

```powershell
.\.venv\Scripts\python.exe app.py
```

Then open `http://127.0.0.1:5000` and choose **Police Portal**. Configure the app to use the same `DATABASE_URL` when creating officers and running the server.

# KineSys

AI & Software Automation studio — marketing website + the "Ina" chat
widget, backed by a real Automation Anywhere / EKB AI agent.

## Folder structure

```
KineSys/
├── website/    The static marketing site (open index.html in a browser)
├── backend/    Node/Express server that Ina + the Get a Quote page talk to
├── locker/     Private credentials — NOT for Git, see locker/README.txt
└── logo.svg    Company logo
```

## Quick start

1. **Unlock the credentials**
   Copy the real `.env` out of the locker into the backend folder:
   ```
   copy locker\.env backend\.env        (Windows)
   cp locker/.env backend/.env          (Mac/Linux)
   ```

2. **Install and run the backend**
   ```
   cd backend
   npm install
   npm start
   ```
   This starts the API server at `http://localhost:3001`. It powers:
   - Ina's real replies (`/api/chat`)
   - The Get a Quote form (`/api/get-quote`)
   - New-visitor and chat-transcript emails (`/api/notify-visitor`, `/api/send-transcript`)

3. **Open the website**
   Open `website/index.html` directly in your browser (or serve the
   `website` folder with any static server). The backend must be
   running for Ina and the Get a Quote page to actually send anything.

## Notes

- `backend/.gitignore` already excludes `node_modules/` and `.env` —
  safe to push `backend/` to a Git repo as-is.
- `website/Ina_Agent_Design.md` documents Ina's full system prompt /
  behavior. `website/KineSys_Knowledge_Base.md` is the reference
  knowledge base behind her answers.
- Emails currently go out from the Gmail address in `.env`, to the
  addresses set in `LEAD_NOTIFY_EMAIL` / `QUOTE_NOTIFY_EMAIL`.

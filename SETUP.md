# Setup

Takes about 15 minutes, once. You need a Mac or Linux terminal (on Windows, use Git Bash or WSL).

## Before you start
Install these if you don't have them:
- **Node.js 20+**: <https://nodejs.org>
- **GitHub CLI**: <https://cli.github.com> (Mac: `brew install gh`)
- **Google Cloud CLI**, optional: <https://cloud.google.com/sdk/docs/install>. With it, the script creates the Google key for you.

## The quick way: one command
Unzip the project, open a terminal in the folder, and run:

```bash
./setup.sh
```

It walks you through everything and only stops when it needs you:

| Step | What the script does | What you do |
|---|---|---|
| 1 | Signs you in to GitHub | Approve in the browser |
| 2 | Pushes the code to `Sarthak-B/pitch-make4yu` | Nothing |
| 3 | Creates the Google service account and key (with gcloud), or asks for the key file | Share the sheet with the email it shows you |
| 4 | Checks your Cloudflare token and finds your account | Create one token (the script lists the exact permissions) |
| 5 | Creates the Cloudflare Access login for the dashboard | Type the emails allowed in |
| 6 | Stores all 8 secrets in GitHub, creates the private backup repo | Optionally paste a backup token |
| 7 | Deploys, then connects `pitching.make4yu.com` | Nothing |

When it finishes, open <https://pitching.make4yu.com> and sign in with your email.
Running the script again is safe; it skips whatever already exists.

## The manual way
Use this if the script stops somewhere, or if you prefer clicking.

### 1. Push the code
Upload this folder to `github.com/Sarthak-B/pitch-make4yu` (Add file, Upload files), including the hidden `.github` folder.
Create a second, **private** repo named `make4yu-pitching-backups` with a README.

### 2. Google service account
1. <https://console.cloud.google.com>: create a project. If your work account blocks key creation, use a personal Google account.
2. **APIs & Services, Library**: enable **Google Sheets API**.
3. **IAM & Admin, Service accounts, Create service account** (no roles needed).
4. Open it, **Keys, Add key, Create new key, JSON**.
5. In the Pitch Tracker sheet, click **Share** and add the service account's email as **Viewer**.

### 3. Cloudflare token
<https://dash.cloudflare.com/profile/api-tokens>, **Create Token, Custom token**:
**Account, Cloudflare Pages, Edit**. Note your Account ID (right side of any zone's overview page).

### 4. Cloudflare Access
1. <https://one.dash.cloudflare.com>: turn on Zero Trust (Free plan) and note your team domain, like `yourteam.cloudflareaccess.com`.
2. **Access, Applications, Add, Self-hosted**: hostnames `pitching.make4yu.com` and `make4yu-pitching.pages.dev`.
3. Policy: **Allow**, Include, **Emails**: you and your team.
4. Copy the **Application Audience (AUD) Tag**.

### 5. GitHub secrets
Repo, **Settings, Secrets and variables, Actions, New repository secret**:

| Secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | token from step 3 |
| `CLOUDFLARE_ACCOUNT_ID` | your account ID |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | the whole JSON key file |
| `SHEET_ID` | the long ID in the sheet's link, between `/d/` and `/edit` |
| `ACCESS_TEAM_DOMAIN` | team domain from step 4 |
| `ACCESS_AUD` | AUD tag from step 4 |
| `BACKUP_REPO` | `Sarthak-B/make4yu-pitching-backups` |
| `BACKUP_REPO_TOKEN` | fine-grained token with Contents: Read and write on the backup repo only |

Then, on the **Variables** tab, add `BACKUP_ENABLED` = `true`.

### 6. Deploy and connect the domain
**Actions, Deploy dashboard, Run workflow.** When it's green: Cloudflare, **Workers & Pages,
make4yu-pitching, Custom domains**, add `pitching.make4yu.com`.

## If something goes wrong
| You see | Fix |
|---|---|
| "Cloudflare Access is not set up yet" | `ACCESS_TEAM_DOMAIN` or `ACCESS_AUD` secret is missing. Add it and re-run the deploy. |
| "Google Sheets returned 403" | Share the sheet with the service account email. |
| "Google Sheets returned 404" | `SHEET_ID` is wrong. |
| "Sign in through Cloudflare Access" | Your email isn't on the Access policy. |
| Made-up sample data showing | The page is opened without the API, e.g. from your computer. That's expected locally. |

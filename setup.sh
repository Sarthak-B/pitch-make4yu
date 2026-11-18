#!/usr/bin/env bash
# make4yu Pitching: one-command setup.
# Pushes this code to GitHub, stores every secret, creates the Cloudflare Access login,
# deploys the dashboard and connects pitching.make4yu.com.
# Safe to run again: each step checks what already exists.
set -euo pipefail

REPO="${REPO:-Sarthak-B/pitch-make4yu}"
OWNER="${REPO%%/*}"
BACKUP_REPO="${BACKUP_REPO:-$OWNER/make4yu-pitching-backups}"
PROJECT="make4yu-pitching"
DOMAIN="${DOMAIN:-pitching.make4yu.com}"
ZONE="${ZONE:-make4yu.com}"
SHEET_ID="${SHEET_ID:-}"
CF_API="https://api.cloudflare.com/client/v4"

bold() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "Install $1 first: $2"; }
ask()  { local __v; read -r -p "  $1 " __v; printf '%s' "$__v"; }
ask_secret() { local __v; read -r -s -p "  $1 " __v; echo >&2; printf '%s' "$__v"; }
json() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);const v=('"$1"');console.log(v===undefined||v===null?"":typeof v==="object"?JSON.stringify(v):v)}catch(e){console.log("")}})'; }
cf() { # cf METHOD PATH [JSON_BODY]
  if [ -n "${3:-}" ]; then curl -sS -X "$1" "$CF_API$2" -H "Authorization: Bearer $CF_TOKEN" -H "Content-Type: application/json" --data "$3"
  else curl -sS -X "$1" "$CF_API$2" -H "Authorization: Bearer $CF_TOKEN"; fi
}

cd "$(dirname "$0")"

bold "Checking tools"
need git  "https://git-scm.com/downloads"
need gh   "https://cli.github.com (Mac: brew install gh)"
need node "https://nodejs.org (version 20 or newer)"
need curl "your package manager"
ok "git, gh, node and curl are installed"

# ---------------------------------------------------------------- GitHub
bold "1/7  Signing in to GitHub"
if ! gh auth status >/dev/null 2>&1; then gh auth login --hostname github.com --git-protocol https --web --scopes "repo,workflow"; fi
gh auth status 2>&1 | grep -q "'workflow'" || gh auth refresh --hostname github.com --scopes "repo,workflow"
gh auth setup-git >/dev/null
gh repo view "$REPO" >/dev/null 2>&1 || die "Can't see $REPO. Check the name, or run: REPO=you/your-repo ./setup.sh"
ok "Signed in as $(gh api user -q .login)"

bold "2/7  Pushing the code to $REPO"
if [ ! -d .git ]; then git init -q -b main; fi
git add -A
git -c user.name="${GIT_NAME:-$(gh api user -q .login)}" -c user.email="${GIT_EMAIL:-$(gh api user -q .login)@users.noreply.github.com}" \
  commit -q -m "make4yu pitching dashboard" >/dev/null 2>&1 || true
git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$REPO.git"
if git ls-remote --exit-code --heads origin main >/dev/null 2>&1; then
  git fetch -q origin main
  git merge -q --allow-unrelated-histories -X ours -m "Merge GitHub's starter files" origin/main >/dev/null 2>&1 || true
fi
git push -q -u origin main
ok "Code is on https://github.com/$REPO"

# ---------------------------------------------------------------- Google
bold "3/7  Google service account (lets the dashboard read your sheet)"
KEY_FILE=""
if [ -n "${GOOGLE_KEY:-}" ] && [ -f "$GOOGLE_KEY" ]; then KEY_FILE="$GOOGLE_KEY"; fi
if [ -z "$KEY_FILE" ] && command -v gcloud >/dev/null 2>&1; then
  if [ "$(ask "gcloud is installed. Create the service account automatically? [Y/n]")" != "n" ]; then
    gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q . || gcloud auth login
    GPROJ="$(ask "Google Cloud project ID to use or create (e.g. make4yu-pitching-$RANDOM):")"
    gcloud projects describe "$GPROJ" >/dev/null 2>&1 || gcloud projects create "$GPROJ" --name="make4yu pitching"
    gcloud services enable sheets.googleapis.com --project "$GPROJ"
    SA="make4yu-dashboard@$GPROJ.iam.gserviceaccount.com"
    gcloud iam service-accounts describe "$SA" --project "$GPROJ" >/dev/null 2>&1 || \
      gcloud iam service-accounts create make4yu-dashboard --display-name="make4yu dashboard" --project "$GPROJ"
    KEY_FILE="$HOME/.make4yu-service-account.json"
    if gcloud iam service-accounts keys create "$KEY_FILE" --iam-account "$SA" --project "$GPROJ"; then chmod 600 "$KEY_FILE"
    else warn "Google blocked key creation (your organisation may forbid keys). Use a personal Google account project instead."; KEY_FILE=""; fi
  fi
fi
while [ -z "$KEY_FILE" ]; do
  echo "  Create it at https://console.cloud.google.com (Sheets API on, Service account, Keys, JSON). See SETUP.md, step 3."
  KEY_FILE="$(ask "Path to the downloaded JSON key file:")"
  KEY_FILE="${KEY_FILE/#\~/$HOME}"; KEY_FILE="${KEY_FILE%\"}"; KEY_FILE="${KEY_FILE#\"}"
  [ -f "$KEY_FILE" ] || { warn "No file at that path."; KEY_FILE=""; }
done
SA_EMAIL="$(json 'o.client_email' < "$KEY_FILE")"
[ -n "$SA_EMAIL" ] || die "That file isn't a service-account key."
ok "Service account: $SA_EMAIL"
while [ -z "$SHEET_ID" ]; do
  LINK="$(ask "Paste the Pitch Tracker sheet's link:")"
  SHEET_ID="$(printf '%s' "$LINK" | sed -n 's#.*/d/\([A-Za-z0-9_-]\{20,\}\).*#\1#p')"
  [ -n "$SHEET_ID" ] || { printf '%s' "$LINK" | grep -Eq '^[A-Za-z0-9_-]{20,}$' && SHEET_ID="$LINK"; } || warn "That doesn't look like a Google Sheets link."
done
warn "Share the Pitch Tracker sheet with $SA_EMAIL as Viewer (Share button in the sheet)."
ask "Press Enter once it's shared." >/dev/null

# ---------------------------------------------------------------- Cloudflare
bold "4/7  Cloudflare"
echo "  Create a token at https://dash.cloudflare.com/profile/api-tokens > Create Token > Custom token, with:"
echo "    Account  Cloudflare Pages                          Edit"
echo "    Account  Access: Apps and Policies                 Edit"
echo "    Account  Access: Organizations, Identity Providers, and Groups   Read"
echo "    Account  Account Settings                          Read"
echo "    Zone     DNS (include: $ZONE)                      Edit"
CF_TOKEN="${CF_TOKEN:-$(ask_secret "Paste the token (hidden):")}"
[ "$(cf GET /user/tokens/verify | json 'o.success')" = "true" ] || die "Cloudflare rejected that token."
CF_ACCOUNT="${CF_ACCOUNT:-$(cf GET "/accounts?per_page=5" | json 'o.result&&o.result[0]&&o.result[0].id')}"
[ -n "$CF_ACCOUNT" ] || CF_ACCOUNT="$(ask "Couldn't read your account ID. Paste it (Cloudflare dashboard, right side of any zone):")"
ok "Account $CF_ACCOUNT"

bold "5/7  Making it private with Cloudflare Access"
TEAM="$(cf GET "/accounts/$CF_ACCOUNT/access/organizations" | json 'o.result&&o.result.auth_domain')"
if [ -z "$TEAM" ]; then
  warn "Zero Trust isn't turned on yet. Open https://one.dash.cloudflare.com, pick a team name and the Free plan, then come back."
  ask "Press Enter when done." >/dev/null
  TEAM="$(cf GET "/accounts/$CF_ACCOUNT/access/organizations" | json 'o.result&&o.result.auth_domain')"
fi
[ -n "$TEAM" ] || TEAM="$(ask "Paste your team domain (like yourteam.cloudflareaccess.com):")"
EMAILS="$(ask "Emails allowed to open the dashboard, comma separated:")"
APPS="$(cf GET "/accounts/$CF_ACCOUNT/access/apps?per_page=100")"
AUD="$(printf '%s' "$APPS" | json "(o.result||[]).filter(a=>a.domain==='$DOMAIN').map(a=>a.aud)[0]")"
if [ -z "$AUD" ]; then
  INCLUDE="$(node -e 'console.log(JSON.stringify(process.argv[1].split(",").map(e=>e.trim()).filter(Boolean).map(e=>({email:{email:e}}))))' "$EMAILS")"
  BODY="{\"name\":\"make4yu Pitching\",\"type\":\"self_hosted\",\"domain\":\"$DOMAIN\",\"self_hosted_domains\":[\"$DOMAIN\",\"$PROJECT.pages.dev\"],\"session_duration\":\"720h\",\"policies\":[{\"name\":\"Team\",\"decision\":\"allow\",\"include\":$INCLUDE}]}"
  RES="$(cf POST "/accounts/$CF_ACCOUNT/access/apps" "$BODY")"
  AUD="$(printf '%s' "$RES" | json 'o.result&&o.result.aud')"
  [ -n "$AUD" ] || { warn "Couldn't create the Access app automatically: $(printf '%s' "$RES" | json '(o.errors||[]).map(e=>e.message).join("; ")')";
    echo "  Create it by hand (SETUP.md, step 5), then paste its Application Audience (AUD) tag.";
    AUD="$(ask "AUD tag:")"; }
fi
ok "Only $EMAILS can open $DOMAIN"

# ---------------------------------------------------------------- secrets
bold "6/7  Storing secrets in GitHub (never in the code)"
set_secret() { printf '%s' "$2" | gh secret set "$1" --repo "$REPO" >/dev/null && ok "$1"; }
set_secret CLOUDFLARE_API_TOKEN "$CF_TOKEN"
set_secret CLOUDFLARE_ACCOUNT_ID "$CF_ACCOUNT"
gh secret set GOOGLE_SERVICE_ACCOUNT_JSON --repo "$REPO" < "$KEY_FILE" >/dev/null && ok "GOOGLE_SERVICE_ACCOUNT_JSON"
set_secret SHEET_ID "$SHEET_ID"
set_secret ACCESS_TEAM_DOMAIN "$TEAM"
set_secret ACCESS_AUD "$AUD"

gh repo view "$BACKUP_REPO" >/dev/null 2>&1 || gh repo create "$BACKUP_REPO" --private --add-readme -d "Nightly backups of the make4yu Pitch Tracker" >/dev/null
ok "Private backup repo: $BACKUP_REPO"
echo "  Nightly backups need a token that can write only to that repo:"
echo "  https://github.com/settings/personal-access-tokens/new  (Only select repositories: $(basename "$BACKUP_REPO"), Contents: Read and write)"
BTOKEN="$(ask_secret "Paste it (hidden), or press Enter to skip backups for now:")"
if [ -n "$BTOKEN" ]; then
  set_secret BACKUP_REPO "$BACKUP_REPO"; set_secret BACKUP_REPO_TOKEN "$BTOKEN"
  gh variable set BACKUP_ENABLED --body true --repo "$REPO" >/dev/null && ok "Nightly backups on"
else warn "Backups skipped. Run this script again later to turn them on."; fi

# ---------------------------------------------------------------- deploy
bold "7/7  Deploying"
gh workflow run deploy.yml --repo "$REPO" --ref main
sleep 6
RUN="$(gh run list --repo "$REPO" --workflow deploy.yml --limit 1 --json databaseId -q '.[0].databaseId')"
gh run watch "$RUN" --repo "$REPO" --exit-status || die "The deploy failed. Open: https://github.com/$REPO/actions"
ok "Deployed to https://$PROJECT.pages.dev"

DOMS="$(cf GET "/accounts/$CF_ACCOUNT/pages/projects/$PROJECT/domains")"
if [ "$(printf '%s' "$DOMS" | json "(o.result||[]).some(d=>d.name==='$DOMAIN')")" != "true" ]; then
  cf POST "/accounts/$CF_ACCOUNT/pages/projects/$PROJECT/domains" "{\"name\":\"$DOMAIN\"}" >/dev/null
fi
ZONE_ID="$(cf GET "/zones?name=$ZONE" | json 'o.result&&o.result[0]&&o.result[0].id')"
if [ -n "$ZONE_ID" ]; then
  HAS="$(cf GET "/zones/$ZONE_ID/dns_records?name=$DOMAIN" | json '(o.result||[]).length')"
  if [ "${HAS:-0}" = "0" ]; then
    cf POST "/zones/$ZONE_ID/dns_records" "{\"type\":\"CNAME\",\"name\":\"$DOMAIN\",\"content\":\"$PROJECT.pages.dev\",\"proxied\":true}" >/dev/null
  fi
  ok "$DOMAIN points at the dashboard (HTTPS can take a few minutes)"
else
  warn "$ZONE isn't on this Cloudflare account. At your DNS provider add: CNAME  pitching  ->  $PROJECT.pages.dev"
fi

bold "Done"
echo "  Open https://$DOMAIN and sign in with one of: $EMAILS"
echo "  Code: https://github.com/$REPO   (public, contains no lead data)"

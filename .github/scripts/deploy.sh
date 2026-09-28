#!/usr/bin/env bash
# Puts this repository's settings into Render from Infisical, then tells Render to deploy.
#
# Why it works this way
# ─────────────────────
# Infisical is the one place a setting is written. Render holds a copy so the service reads
# ordinary environment variables at boot, which means nothing has to reach Infisical for the
# site to start — a site that takes money should not stop working because a secrets service
# is unreachable.
#
# Render's own auto-deploy is off. The deploy happens here, after the checks, so a commit
# that fails them never reaches the people paying.
#
# Unlike the same script in the other repository, this one fails loudly. There is no
# pre-built image waiting to be deployed by hand: if this does not run, nothing ships, and a
# green build that shipped nothing is worse than a red one.
#
# Inputs (environment variables)
# Before Infisical is set up
# ─────────────────────────
# Infisical can only be administered from a laptop, and this has to work before there is
# one. With no Infisical credentials configured, the settings step is skipped and Render
# deploys with whatever it already holds — entered by hand in its dashboard, which a phone
# can do. The skip is announced rather than silent, because a deploy that quietly used
# whatever was lying around is the kind of thing nobody notices until it is wrong.
#
# Adding the Infisical secrets to the repository later switches it over. No code changes.
#
# Inputs (environment variables)
#   RENDER_API_KEY        required — rnd_…
#   RENDER_SERVICE_NAME   the service's name in Render; its id is looked up from that
#   INFISICAL_TOKEN       optional — from a machine identity login; without it, see above
#   INFISICAL_PROJECT_ID  optional — the One Percent project; without it, see above
#   INFISICAL_API_URL     optional — the instance address, required alongside the two above
set -euo pipefail

# Every setting the service needs. The list lives here rather than being read from somewhere
# else, so that adding one is a change somebody reviews.
KEYS=(
  DATABASE_URL
  CARD_ENCRYPTION_KEY
  AUTH_PUBLISHABLE_KEY
  AUTH_CLIENT_ID
  AUTH_CLIENT_SECRET
  ADMIN_ACCOUNT_IDS
  RETELL_SECRET_KEY
  RETELL_AGENT_ID
  PAY_WISE
)

# Settings the service runs without. A missing one is not a broken deploy, it is a feature
# nobody has turned on yet, so these are written as empty rather than refused.
#
# The drafting models are the whole list: a slot with no address is not configured, the desk
# does not offer it, and nothing calls it. Requiring a value would make the second slot
# impossible to leave empty, which is the state it is supposed to be in until there is a
# second model worth comparing.
OPTIONAL_KEYS=(
  DRAFT_MODEL_A_NAME
  DRAFT_MODEL_A_URL
  DRAFT_MODEL_A_KEY
  DRAFT_MODEL_B_NAME
  DRAFT_MODEL_B_URL
  DRAFT_MODEL_B_KEY
)

die() { echo "::error title=Deploy stopped::$*"; exit 1; }

[ -n "${RENDER_API_KEY:-}" ] || die "RENDER_API_KEY is not set."
name="${RENDER_SERVICE_NAME:-one-percent-app}"

sync_settings=yes
if [ -z "${INFISICAL_TOKEN:-}" ] || [ -z "${INFISICAL_PROJECT_ID:-}" ]; then
  sync_settings=no
  echo "::notice title=Settings not synced::Infisical is not configured for this repository, so Render will deploy with the settings already on the service. Add INFISICAL_CLIENT_ID, INFISICAL_CLIENT_SECRET, INFISICAL_PROJECT_ID and INFISICAL_URL to switch this on."
fi

if [ "$sync_settings" = yes ]; then
  echo "Reading the settings out of Infisical…"
  # The API rather than a command line, so a deploy does not depend on a package repository
  # being reachable and installable on the day it runs. The shape below is what the old export
  # produced — an array of {secretKey, secretValue} — so everything after this is unchanged.
  #
  # `production` is the environment slug, not its display name. Infisical names it Production
  # and often slugs it `prod`, and a slug that does not match returns an empty set rather than
  # an error, which reads as every secret being missing.
  # Only the scheme and host, whatever was pasted — the value is copied from a browser and
  # usually still carries the project path.
  origin=$(printf '%s' "$INFISICAL_API_URL" | sed -E 's#^(https?://[^/]+).*#\1#')
  [ -n "$origin" ] || die "INFISICAL_URL is not an address. It has to start with https:// and a host name."

  raw=$(curl -sS --fail-with-body --max-time 30 \
    -H "authorization: Bearer $INFISICAL_TOKEN" \
    "$origin/api/v3/secrets/raw?workspaceId=${INFISICAL_PROJECT_ID}&environment=production") || \
    die "Infisical would not hand over the settings. It answered: $raw"

  printf '%s' "$raw" | jq -e 'has("secrets")' > /dev/null 2>&1 || \
    die "Infisical answered with something unreadable. It sent: $(printf '%s' "$raw" | head -c 400)"

  printf '%s' "$raw" | jq '.secrets' > /tmp/secrets.json

  count=$(jq 'length' /tmp/secrets.json)
  [ "$count" -gt 0 ] || die "The production environment in that project holds no secrets. Check the environment's slug is production rather than prod."

  # Refuse before touching Render if anything is missing. A write replaces every variable on
  # the service, so sending an incomplete set would take the site down.
  missing=()
  for key in "${KEYS[@]}"; do
    jq -e --arg k "$key" \
      'map(select(.secretKey == $k and (.secretValue | length) > 0)) | length > 0' \
      /tmp/secrets.json > /dev/null 2>&1 || missing+=("$key")
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    die "Infisical has no value for: ${missing[*]}. Nothing was changed on Render."
  fi

  # Every name goes to Render, required or not. A write replaces the whole set, so a name left
  # out would be removed from the service rather than left alone — and an optional one that is
  # absent from Infisical is sent as empty, which is what the code reads as "not configured".
  jq -c \
    --argjson keys "$(printf '%s\n' "${KEYS[@]}" | jq -R . | jq -sc .)" \
    --argjson optional "$(printf '%s\n' "${OPTIONAL_KEYS[@]}" | jq -R . | jq -sc .)" \
    'INDEX(.secretKey) as $have
     | ($keys + $optional)
     | map({key: ., value: ($have[.].secretValue // "")})' \
    /tmp/secrets.json > /tmp/env-vars.json
fi

echo "Finding the Render service named '${name}'…"
curl -sS -f -H "Authorization: Bearer $RENDER_API_KEY" \
  "https://api.render.com/v1/services?name=${name}&limit=100" > /tmp/services.json \
  || die "Could not list Render services. Check RENDER_API_KEY."
id=$(jq -r --arg n "$name" \
  'map(.service) | map(select(.name == $n)) | .[0].id // empty' /tmp/services.json)
[ -n "$id" ] || die "No Render service named '${name}' exists under this API key."

if [ "$sync_settings" = yes ]; then
  echo "Writing ${#KEYS[@]} settings to Render…"
  curl -sS -f -X PUT \
    -H "Authorization: Bearer $RENDER_API_KEY" \
    -H "Content-Type: application/json" \
    --data @/tmp/env-vars.json \
    "https://api.render.com/v1/services/${id}/env-vars" > /dev/null \
    || die "Render refused the settings. Nothing was deployed."
else
  echo "Leaving the settings on Render as they are."
fi

echo "Asking Render to deploy…"
curl -sS -f -X POST \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"clearCache":"do_not_clear"}' \
  "https://api.render.com/v1/services/${id}/deploys" > /tmp/deploy.json \
  || die "Render refused the deploy."
deploy=$(jq -r '.id // empty' /tmp/deploy.json)
[ -n "$deploy" ] || die "Render accepted the deploy but named no deploy to watch."

# Watch it land. Triggering a deploy and calling that success reports a green build for a
# site that may not be running.
echo "Waiting for it to finish…"
for _ in $(seq 1 60); do
  sleep 15
  status=$(curl -sS -H "Authorization: Bearer $RENDER_API_KEY" \
    "https://api.render.com/v1/services/${id}/deploys/${deploy}" | jq -r '.status // "unknown"')
  case "$status" in
    live)
      echo "Deployed and live."
      exit 0
      ;;
    build_failed|update_failed|pre_deploy_failed|canceled)
      die "The deploy ended as ${status}. The Render dashboard has the log."
      ;;
    *)
      echo "  ${status}…"
      ;;
  esac
done
die "Fifteen minutes and the deploy has not finished. The Render dashboard has the log."

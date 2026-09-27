#!/usr/bin/env bash
# Creates the Render web service this repository deploys to.
#
# TEMPORARY. This runs once. Delete this script and the workflow that calls it in the same
# piece of work that confirms the service exists — a finished one-off sitting in the Actions
# list makes the dangerous press and the routine one look alike.
#
# Why it is a script rather than a dashboard walkthrough: Render is driven by its API, and
# an agent that hands over a list of buttons to press is not using what the platform is for.
#
# Everything it needs is in render.yaml, read here rather than restated, so the service that
# gets created and the one the repository describes cannot disagree.
#
# Inputs (environment variables)
#   RENDER_API_KEY    required — rnd_…
#   WORKSPACE         the Render workspace to create it in, by name
#   SERVICE_NAME      defaults to the name in render.yaml
#   REPO_URL          the repository the service builds from
#   DOMAIN            the address to attach, e.g. app.example.com
set -euo pipefail

die() { echo "::error title=Service not created::$*"; exit 1; }

[ -n "${RENDER_API_KEY:-}" ] || die "RENDER_API_KEY is not set on this repository."
api() { curl -sS -H "Authorization: Bearer $RENDER_API_KEY" -H 'content-type: application/json' "$@"; }

name="${SERVICE_NAME:-$(grep -E '^\s+name:' render.yaml | head -1 | awk '{print $2}')}"
[ -n "$name" ] || die "render.yaml names no service."
plan=$(grep -E '^\s+plan:' render.yaml | head -1 | awk '{print $2}')
build=$(grep -E '^\s+buildCommand:' render.yaml | head -1 | cut -d: -f2- | sed 's/^ *//')
start=$(grep -E '^\s+startCommand:' render.yaml | head -1 | cut -d: -f2- | sed 's/^ *//')
health=$(grep -E '^\s+healthCheckPath:' render.yaml | head -1 | awk '{print $2}')
region=$(grep -E '^\s+region:' render.yaml | head -1 | awk '{print $2}')
[ -n "$region" ] || die "render.yaml names no region. Render defaults to Oregon, and a service cannot be moved between regions afterwards."
echo "From render.yaml: name=${name} plan=${plan} region=${region} health=${health}"
echo "  build: ${build}"
echo "  start: ${start}"

# Already there? Then this has run before and there is nothing to do.
api "https://api.render.com/v1/services?name=${name}&limit=100" > /tmp/services.json \
  || die "Could not list services. Check RENDER_API_KEY."
existing=$(jq -r --arg n "$name" 'map(.service) | map(select(.name == $n)) | .[0].id // empty' /tmp/services.json)
if [ -n "$existing" ]; then
  echo "A service named ${name} already exists. Nothing to create."
  echo "Delete this workflow and its script — they have done their job."
  exit 0
fi

# The workspace, by name, so no second secret is needed to say which one.
api "https://api.render.com/v1/owners?limit=100" > /tmp/owners.json || die "Could not list workspaces."
if [ -n "${WORKSPACE:-}" ]; then
  owner=$(jq -r --arg n "$WORKSPACE" 'map(.owner) | map(select(.name == $n)) | .[0].id // empty' /tmp/owners.json)
  [ -n "$owner" ] || die "No workspace named '${WORKSPACE}'. The ones this key can see are: $(jq -r 'map(.owner.name) | join(", ")' /tmp/owners.json)"
else
  count=$(jq -r 'length' /tmp/owners.json)
  [ "$count" = "1" ] || die "This key can see ${count} workspaces — say which one: $(jq -r 'map(.owner.name) | join(", ")' /tmp/owners.json)"
  owner=$(jq -r '.[0].owner.id' /tmp/owners.json)
fi
echo "Creating it in workspace $(jq -r --arg i "$owner" 'map(.owner) | map(select(.id == $i)) | .[0].name' /tmp/owners.json)."

jq -n --arg name "$name" --arg owner "$owner" --arg repo "${REPO_URL}" \
      --arg plan "$plan" --arg build "$build" --arg start "$start" --arg health "$health" \
      --arg region "$region" '{
  type: "web_service",
  name: $name,
  ownerId: $owner,
  repo: $repo,
  branch: "main",
  autoDeploy: "no",
  serviceDetails: {
    env: "node",
    plan: $plan,
    region: $region,
    healthCheckPath: $health,
    envSpecificDetails: { buildCommand: $build, startCommand: $start }
  }
}' > /tmp/create.json

status=$(api -o /tmp/created.json -w '%{http_code}' -X POST --data @/tmp/create.json \
  "https://api.render.com/v1/services")
case "$status" in
  2*) ;;
  *)
    echo "Render answered ${status}:"
    jq -r '.message // .' /tmp/created.json 2>/dev/null || cat /tmp/created.json
    die "Render refused to create the service. If it says the repository cannot be reached, give Render's GitHub app access to it."
    ;;
esac

id=$(jq -r '.service.id // .id // empty' /tmp/created.json)
[ -n "$id" ] || die "Render created something but named no service."
echo "Created ${name}."

# A service nobody can reach is not finished. Attaching the address is another API call, so
# it happens here rather than being handed over as a thing to go and click.
domain_note="No domain was given, so none was attached."
if [ -n "${DOMAIN:-}" ]; then
  dstatus=$(api -o /tmp/domain.json -w '%{http_code}' -X POST \
    --data "$(jq -n --arg n "$DOMAIN" '{name: $n}')" \
    "https://api.render.com/v1/services/${id}/custom-domains")
  case "$dstatus" in
    2*) domain_note="${DOMAIN} is attached. It serves once DNS points at this service and Render verifies it." ;;
    409|422)
      domain_note="${DOMAIN} could not be attached because something else already holds it — most likely the old Vercel project. Remove it there, then attach it here."
      ;;
    *)
      domain_note="${DOMAIN} was not attached; Render answered ${dstatus}. The service itself is fine."
      ;;
  esac
  echo "$domain_note"
fi

{
  echo "### ${name} exists now"
  echo ""
  echo "- Plan: ${plan}, in ${region} — the same region as the database and the other product's services."
  echo "- Auto-deploy off, as render.yaml asks. Deploys come from the Deploy workflow."
  echo "- ${domain_note}"
  echo "- It has no settings yet. The first deploy writes them once Infisical is set up; until then"
  echo "  it will start and fail its health check, which is expected rather than broken."
  echo "- Then delete this workflow and its script. They have done their job."
} >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"

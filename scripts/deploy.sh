#!/usr/bin/env bash
# Deploys every Worker to Cloudflare. Workers that bind to another Worker go after it: the API and
# the Delivery Worker use the limiter's Durable Object, the dispatcher calls the creator and the
# Delivery Worker, and the API uses the dispatcher's Durable Object.
#
# .env.cloud-secrets holds the cloud's secrets (only MASTER_KEY_V1), in .env format. It's
# when it's there its secrets are uploaded with the Workers that need them
# a Worker's secrets stay set from one deploy to the next, so the ones already uploaded are kept.
set -euo pipefail
cd "$(dirname "$0")/.."

secrets=.env.cloud-secrets
if [[ -f $secrets ]]; then
    secrets_args=(--secrets-file "$secrets")
else
    echo "$secrets not found: deploying without secrets, so the ones already set are kept"
    secrets_args=()
fi

deploy() {
    local app=$1
    shift
    echo "--- $app"
    npx wrangler deploy -c "apps/$app/wrangler.toml" "$@"
}

deploy limiter
deploy creator
deploy delivery ${secrets_args[@]+"${secrets_args[@]}"}
deploy dispatcher
# The cloud keeps less than local dev: Neon Free has 0.5 GB.
deploy api ${secrets_args[@]+"${secrets_args[@]}"} \
    --var ATTEMPT_RETENTION_DAYS:3 --var DELIVERY_RETENTION_DAYS:3 --var EVENT_RETENTION_DAYS:6
deploy test-consumer

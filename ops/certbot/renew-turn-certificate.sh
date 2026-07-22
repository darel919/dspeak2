#!/bin/sh
set -eu

credentials=/run/certbot/cloudflare.ini
install -d -m 700 /run/certbot
umask 077
printf 'dns_cloudflare_api_token = %s\n' "$TURN_CLOUDFLARE_API_TOKEN" > "$credentials"

log() {
  printf '%s [turn-certbot] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$1"
}

issue_or_renew() {
  log "Requesting or renewing certificate for ${DSPEAK_RTC_DOMAIN}"
  if certbot certonly \
    --dns-cloudflare \
    --dns-cloudflare-credentials "$credentials" \
    --dns-cloudflare-propagation-seconds "${TURN_CERT_DNS_PROPAGATION_SECONDS:-30}" \
    --domain "$DSPEAK_RTC_DOMAIN" \
    --email "$TURN_CERT_EMAIL" \
    --agree-tos \
    --non-interactive \
    --keep-until-expiring; then
    log "Certificate is ready for ${DSPEAK_RTC_DOMAIN}"
    return 0
  else
    status=$?
    log "Certificate request failed with exit code ${status}; retrying in 60 seconds"
    return "$status"
  fi
}

log "Certificate manager started"
while true; do
  if issue_or_renew; then
    log "Next renewal check in 12 hours"
    sleep 43200
  else
    sleep 60
  fi
done

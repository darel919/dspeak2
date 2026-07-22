#!/bin/sh
set -eu

log() {
  printf '%s [turn-certbot] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$1"
}

log "Certificate manager started"

credentials=/run/certbot/cloudflare.ini
mkdir -p /run/certbot
chmod 700 /run/certbot
umask 077
printf 'dns_cloudflare_api_token = %s\n' "$TURN_CLOUDFLARE_API_TOKEN" > "$credentials"

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
    publish_certificate
    log "Certificate is ready for ${DSPEAK_RTC_DOMAIN}"
    return 0
  else
    status=$?
    log "Certificate request failed with exit code ${status}; retrying in 60 seconds"
    return "$status"
  fi
}

publish_certificate() {
  source_directory="/etc/letsencrypt/live/${DSPEAK_RTC_DOMAIN}"
  runtime_directory=/etc/letsencrypt/runtime
  mkdir -p "$runtime_directory"
  chmod 0755 "$runtime_directory"
  cp -L "${source_directory}/fullchain.pem" "${runtime_directory}/fullchain.pem.next"
  cp -L "${source_directory}/privkey.pem" "${runtime_directory}/privkey.pem.next"
  chmod 0444 "${runtime_directory}/fullchain.pem.next" "${runtime_directory}/privkey.pem.next"
  mv -f "${runtime_directory}/fullchain.pem.next" "${runtime_directory}/fullchain.pem"
  mv -f "${runtime_directory}/privkey.pem.next" "${runtime_directory}/privkey.pem"
  log "Published certificate files for the non-root TURN service"
}

while true; do
  if issue_or_renew; then
    log "Next renewal check in 12 hours"
    sleep 43200
  else
    sleep 60
  fi
done

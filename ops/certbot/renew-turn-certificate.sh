#!/bin/sh
set -eu

credentials=/run/certbot/cloudflare.ini
install -d -m 700 /run/certbot
umask 077
printf 'dns_cloudflare_api_token = %s\n' "$TURN_CLOUDFLARE_API_TOKEN" > "$credentials"

issue_or_renew() {
  certbot certonly \
    --dns-cloudflare \
    --dns-cloudflare-credentials "$credentials" \
    --dns-cloudflare-propagation-seconds "${TURN_CERT_DNS_PROPAGATION_SECONDS:-30}" \
    --domain "$DSPEAK_RTC_DOMAIN" \
    --email "$TURN_CERT_EMAIL" \
    --agree-tos \
    --non-interactive \
    --keep-until-expiring
}

issue_or_renew
while true; do
  sleep 43200
  issue_or_renew
done

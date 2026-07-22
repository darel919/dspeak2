FROM certbot/dns-cloudflare:v3.2.0@sha256:3c3eca6a6476d1fc2cd67de0ebc1e7b9b8c6775fcfaadb7098aad76e9cade5e3

COPY ops/certbot/renew-turn-certificate.sh /usr/local/bin/renew-turn-certificate
RUN chmod 755 /usr/local/bin/renew-turn-certificate

ENTRYPOINT ["/bin/sh", "/usr/local/bin/renew-turn-certificate"]

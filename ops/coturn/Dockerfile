FROM coturn/coturn:4.6.3-alpine@sha256:e2bca2f79a4269d7240de5872ab60a9305013ad37296d2acf14f9510874346be

COPY --chmod=0555 ops/coturn/run-coturn.sh /usr/local/bin/run-coturn

ENTRYPOINT ["/bin/sh", "/usr/local/bin/run-coturn"]

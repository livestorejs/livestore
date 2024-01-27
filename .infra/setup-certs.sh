#! /usr/bin/env nix-shell
#! nix-shell -i bash -p mkcert

CERTS_DIR="$WORKSPACE_ROOT/certs"
mkdir -p $CERTS_DIR

mkcert -install
mkcert -cert-file="$CERTS_DIR/cert.pem" -key-file="$CERTS_DIR/key.pem" localhost '*.livestore.localhost' 127.0.0.1 ::1 0.0.0.0

#!/bin/sh

# Test-only connection setup on an already provisioned disposable Linux runner.
# The genuine client and ordinary OS certificate trust remain the product path.
set -eu

[ "${GITHUB_ACTIONS:-}" = true ] || { echo "Example provisioning requires GitHub Actions" >&2; exit 1; }
[ "${RUNNER_OS:-}" = Linux ] || { echo "Example provisioning requires Linux" >&2; exit 1; }
[ "${ImageOS:-}" = ubuntu24 ] || { echo "Example provisioning requires Ubuntu 24.04" >&2; exit 1; }
[ "$(uname -m)" = x86_64 ] || { echo "Example provisioning requires Linux x86_64" >&2; exit 1; }
[ "$(id -u)" -ne 0 ] || { echo "Example provisioning must remain unprivileged" >&2; exit 1; }
[ "$#" -eq 0 ] || { echo "Example provisioning accepts no arguments" >&2; exit 1; }
case ${RUNNER_TEMP:-}:${GITHUB_ENV:-} in
  /*:/*) ;;
  *) echo "Example provisioning requires absolute runner paths" >&2; exit 1 ;;
esac
sudo -n true

umask 077
fixture=$(mktemp -d "$RUNNER_TEMP/jig-example-smoke.XXXXXX")
case $fixture in "$RUNNER_TEMP"/jig-example-smoke.*) ;; *) exit 1 ;; esac
client=$fixture/client
mkdir "$client"

# Complete official package: keep the genuine executable and its resource layout.
# Digest is the rust-v0.166.0 release asset identity, not a floating installer.
archive=$fixture/codex-package.tar.gz
curl --fail --location --proto '=https' --tlsv1.2 \
  --connect-timeout 15 --max-time 120 --retry 2 --retry-max-time 240 \
  --output "$archive" \
  https://github.com/openai/codex/releases/download/rust-v0.166.0/codex-package-x86_64-unknown-linux-musl.tar.gz
printf '%s  %s\n' \
  1d44b28bc4ac9937d7d3532264baa68a507ce364956a0d4ebb856f331cdee254 "$archive" |
  sha256sum --check --strict -
tar -xzf "$archive" -C "$client"
codex=$client/bin/codex
[ -f "$codex" ] && [ ! -L "$codex" ] && [ -x "$codex" ] || {
  echo "The pinned Codex package has no ordinary executable" >&2; exit 1;
}
[ "$(env -i PATH=/usr/bin:/bin "$codex" --version)" = 'codex-cli 0.166.0' ] || {
  echo "The pinned Codex version does not match" >&2; exit 1;
}

# Trust only this generated peer on this disposable VM. No TLS bypass or product
# override is passed to the client. The CA signing key is removed after use.
openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 1 \
  -subj '/CN=Jig example smoke CA' \
  -addext 'basicConstraints=critical,CA:TRUE' \
  -addext 'keyUsage=critical,keyCertSign,cRLSign' \
  -keyout "$fixture/ca.key" -out "$fixture/ca.crt" >/dev/null 2>&1
openssl req -new -newkey rsa:2048 -nodes -sha256 \
  -subj '/CN=127.0.0.1' \
  -keyout "$fixture/server.key" -out "$fixture/server.csr" >/dev/null 2>&1
cat > "$fixture/server.ext" <<'EXT'
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=IP:127.0.0.1
EXT
openssl x509 -req -sha256 -days 1 -set_serial 1 \
  -in "$fixture/server.csr" -CA "$fixture/ca.crt" -CAkey "$fixture/ca.key" \
  -extfile "$fixture/server.ext" -out "$fixture/server.crt" >/dev/null 2>&1
rm "$fixture/ca.key" "$fixture/server.csr" "$fixture/server.ext"
trust=/usr/local/share/ca-certificates/jig-example-smoke.crt
if sudo -n test -e "$trust"; then
  echo "Example CA destination already exists" >&2; exit 1;
fi
sudo -n install -o root -g root -m 0644 "$fixture/ca.crt" "$trust"
sudo -n update-ca-certificates
openssl verify -verify_ip 127.0.0.1 \
  -CAfile /etc/ssl/certs/ca-certificates.crt "$fixture/server.crt"

{
  printf 'JIG_EXAMPLE_CODEX_PATH=%s\n' "$codex"
  printf 'JIG_EXAMPLE_API_CERT=%s\n' "$fixture/server.crt"
  printf 'JIG_EXAMPLE_API_KEY=%s\n' "$fixture/server.key"
} >> "$GITHUB_ENV"
printf '%s\n' 'Genuine Codex and trusted local example API are ready'

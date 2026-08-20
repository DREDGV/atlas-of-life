#!/usr/bin/env bash
# Atlas Sync VDS installer — isolated deployment next to existing sites.
#
# Usage (as root on the VDS):
#   bash /root/atlas-sync-upload/deploy/vds/install-atlas-sync.sh \
#     /root/atlas-sync-upload \
#     /root/node-v22.22.0-linux-x64.tar.xz
#
# Layout:
#   /opt/atlas-sync/releases/<id>   immutable release (code + app files)
#   /opt/atlas-sync/current         symlink to the active release
#   /opt/atlas-sync/runtime         private Node.js runtime
#   /opt/atlas-sync/app             DocumentRoot (symlink into current)
#   /etc/atlas-sync/atlas-sync.env  config + admin bootstrap token (0640)
#   /var/lib/atlas-sync/            SQLite database
#   service user atlas-sync, loopback API on 127.0.0.1:8787
set -Eeuo pipefail

UPLOAD_DIR=${1:-/root/atlas-sync-upload}
RUNTIME_ARCHIVE=${2:-/root/node-v22-linux-x64.tar.xz}
ATLAS_HOSTNAME=${ATLAS_HOSTNAME:-atlas.31.28.27.96.sslip.io}
RELEASE_ID=$(date -u +%Y%m%dT%H%M%SZ)
RELEASE_DIR="/opt/atlas-sync/releases/${RELEASE_ID}"

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this installer as root." >&2
  exit 1
fi

for required in \
  "${UPLOAD_DIR}/server/start.js" \
  "${UPLOAD_DIR}/server/sync-server.js" \
  "${UPLOAD_DIR}/deploy/vds/atlas-sync.service" \
  "${UPLOAD_DIR}/deploy/vds/atlas-sync-apache.conf"; do
  if [[ ! -f ${required} ]]; then
    echo "Missing deployment file: ${required}" >&2
    exit 1
  fi
done

if [[ ! -f ${RUNTIME_ARCHIVE} && ! -x /opt/atlas-sync/runtime/bin/node ]]; then
  echo "Missing isolated Node.js runtime archive: ${RUNTIME_ARCHIVE}" >&2
  exit 1
fi

getent group atlas-sync >/dev/null || groupadd --system atlas-sync
id atlas-sync >/dev/null 2>&1 || useradd \
  --system \
  --gid atlas-sync \
  --home-dir /var/lib/atlas-sync \
  --shell /usr/sbin/nologin \
  atlas-sync

install -d -m 0755 /opt/atlas-sync/releases
install -d -m 0750 -o atlas-sync -g atlas-sync /var/lib/atlas-sync
install -d -m 0750 -o root -g atlas-sync /etc/atlas-sync

if [[ ! -x /opt/atlas-sync/runtime/bin/node ]]; then
  runtime_tmp=$(mktemp -d /opt/atlas-sync/runtime.XXXXXX)
  trap 'rm -rf -- "${runtime_tmp:-}"' EXIT
  tar -xJf "${RUNTIME_ARCHIVE}" --strip-components=1 -C "${runtime_tmp}"
  test -x "${runtime_tmp}/bin/node"
  chmod 0755 "${runtime_tmp}"
  mv "${runtime_tmp}" /opt/atlas-sync/runtime
  trap - EXIT
fi
chmod 0755 /opt/atlas-sync/runtime
runuser -u atlas-sync -- /opt/atlas-sync/runtime/bin/node --version >/dev/null

# Release: sync service code + the static Atlas app (Studio + Capture PWA).
install -d -m 0755 "${RELEASE_DIR}/server" "${RELEASE_DIR}/deploy/vds"
install -m 0644 "${UPLOAD_DIR}/server/start.js" "${RELEASE_DIR}/server/start.js"
install -m 0644 "${UPLOAD_DIR}/server/sync-server.js" "${RELEASE_DIR}/server/sync-server.js"
install -d -m 0755 "${RELEASE_DIR}/js" "${RELEASE_DIR}/styles" "${RELEASE_DIR}/capture"
cp -a "${UPLOAD_DIR}/js/." "${RELEASE_DIR}/js/"
cp -a "${UPLOAD_DIR}/styles/." "${RELEASE_DIR}/styles/"
cp -a "${UPLOAD_DIR}/capture/." "${RELEASE_DIR}/capture/"
install -m 0644 "${UPLOAD_DIR}/index.html" "${RELEASE_DIR}/index.html"
chown -R root:root "${RELEASE_DIR}"

if [[ ! -f /etc/atlas-sync/atlas-sync.env ]]; then
  sync_token=$(openssl rand -hex 32)
  cat > /etc/atlas-sync/atlas-sync.env <<EOF
ATLAS_SYNC_HOST=127.0.0.1
ATLAS_SYNC_PORT=8787
ATLAS_SYNC_DB_PATH=/var/lib/atlas-sync/atlas-sync.sqlite
ATLAS_SYNC_ALLOWED_ORIGINS=https://${ATLAS_HOSTNAME}
ATLAS_SYNC_TOKEN=${sync_token}
EOF
  chown root:atlas-sync /etc/atlas-sync/atlas-sync.env
  chmod 0640 /etc/atlas-sync/atlas-sync.env
fi

ln -sfn "${RELEASE_DIR}" /opt/atlas-sync/current
install -m 0644 "${UPLOAD_DIR}/deploy/vds/atlas-sync.service" /etc/systemd/system/atlas-sync.service

sed "s/atlas\.31\.28\.27\.96\.sslip\.io/${ATLAS_HOSTNAME}/g" \
  "${UPLOAD_DIR}/deploy/vds/atlas-sync-apache.conf" \
  > /etc/apache2/sites-available/atlas-sync.conf

a2enmod proxy proxy_http headers >/dev/null
a2ensite atlas-sync >/dev/null
apache2ctl configtest

systemctl daemon-reload
systemctl enable --now atlas-sync.service
systemctl reload apache2

for attempt in {1..15}; do
  if curl --fail --silent http://127.0.0.1:8787/health; then
    echo
    break
  fi
  if [[ ${attempt} -eq 15 ]]; then
    systemctl status atlas-sync.service --no-pager
    exit 1
  fi
  sleep 1
done

echo "Atlas Sync installed."
echo "Release: ${RELEASE_DIR}"
echo "HTTP test URL: http://${ATLAS_HOSTNAME}/health"
echo "The admin token remains in /etc/atlas-sync/atlas-sync.env."

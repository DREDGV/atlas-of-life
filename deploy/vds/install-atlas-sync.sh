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
#   /var/lib/atlas-sync/            SQLite database + private backups
#   service user atlas-sync, loopback API on 127.0.0.1:8787
set -Eeuo pipefail

UPLOAD_DIR=${1:-/root/atlas-sync-upload}
RUNTIME_ARCHIVE=${2:-/root/node-v22-linux-x64.tar.xz}
ATLAS_HOSTNAME=${ATLAS_HOSTNAME:-atlas.31.28.27.96.sslip.io}
ATLAS_CERTBOT_EMAIL=${ATLAS_CERTBOT_EMAIL:-}
RELEASE_ID=$(date -u +%Y%m%dT%H%M%SZ)
RELEASE_DIR="/opt/atlas-sync/releases/${RELEASE_ID}"

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this installer as root." >&2
  exit 1
fi

if [[ -z ${ATLAS_CERTBOT_EMAIL//[[:space:]]/} ]]; then
  echo "ATLAS_CERTBOT_EMAIL is required for certificate registration." >&2
  exit 1
fi

if [[ ! ${ATLAS_HOSTNAME} =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]]; then
  echo "ATLAS_HOSTNAME must be a plain DNS hostname." >&2
  exit 1
fi

for required in \
  "${UPLOAD_DIR}/server/start.js" \
  "${UPLOAD_DIR}/server/sync-server.js" \
  "${UPLOAD_DIR}/index.html" \
  "${UPLOAD_DIR}/styles.css" \
  "${UPLOAD_DIR}/addons/addons.css" \
  "${UPLOAD_DIR}/addons/_experiments.js" \
  "${UPLOAD_DIR}/addons/experiments/exp-2025-09-07-pulse-active-domain.js" \
  "${UPLOAD_DIR}/addons/ics-export.js" \
  "${UPLOAD_DIR}/addons/autocomplete.js" \
  "${UPLOAD_DIR}/addons/today-plus.js" \
  "${UPLOAD_DIR}/addons/inspector-plus.js" \
  "${UPLOAD_DIR}/deploy/vds/atlas-sync.service" \
  "${UPLOAD_DIR}/deploy/vds/atlas-sync-apache.conf" \
  "${UPLOAD_DIR}/deploy/vds/atlas-sync-apache-ssl.conf" \
  "${UPLOAD_DIR}/deploy/vds/backup-atlas-sync.sh" \
  "${UPLOAD_DIR}/deploy/vds/atlas-sync-backup.service" \
  "${UPLOAD_DIR}/deploy/vds/atlas-sync-backup.timer" \
  "${UPLOAD_DIR}/deploy/vds/README.md" \
  "${UPLOAD_DIR}/deploy/vds/RESTORE.md"; do
  if [[ ! -f ${required} ]]; then
    echo "Missing deployment file: ${required}" >&2
    exit 1
  fi
done

for command_name in apache2ctl awk certbot curl openssl sqlite3 systemctl tar; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "Missing required command: ${command_name}" >&2
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
install -d -m 0700 -o atlas-sync -g atlas-sync /var/lib/atlas-sync/backups
install -d -m 0750 -o root -g atlas-sync /etc/atlas-sync
install -d -m 0755 /usr/local/libexec/atlas-sync
install -d -m 0755 /usr/local/share/doc/atlas-sync

# Older releases used the service manager's default umask and could leave the
# live SQLite database, WAL and shared-memory files world-readable. Normalize
# existing files before restart; UMask=0027 in atlas-sync.service keeps future
# files at owner/group-only permissions.
for database_file in \
  /var/lib/atlas-sync/atlas-sync.sqlite \
  /var/lib/atlas-sync/atlas-sync.sqlite-wal \
  /var/lib/atlas-sync/atlas-sync.sqlite-shm; do
  if [[ -e ${database_file} ]]; then
    chown atlas-sync:atlas-sync "${database_file}"
    chmod 0640 "${database_file}"
  fi
done

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
install -d -m 0755 \
  "${RELEASE_DIR}/js" \
  "${RELEASE_DIR}/styles" \
  "${RELEASE_DIR}/addons" \
  "${RELEASE_DIR}/capture"
cp -a "${UPLOAD_DIR}/js/." "${RELEASE_DIR}/js/"
cp -a "${UPLOAD_DIR}/styles/." "${RELEASE_DIR}/styles/"
cp -a "${UPLOAD_DIR}/addons/." "${RELEASE_DIR}/addons/"
cp -a "${UPLOAD_DIR}/capture/." "${RELEASE_DIR}/capture/"
install -m 0644 "${UPLOAD_DIR}/index.html" "${RELEASE_DIR}/index.html"
install -m 0644 "${UPLOAD_DIR}/styles.css" "${RELEASE_DIR}/styles.css"
chown -R root:root "${RELEASE_DIR}"

ENV_FILE=/etc/atlas-sync/atlas-sync.env
public_origin="https://${ATLAS_HOSTNAME}"

update_env_value() {
  local key=$1
  local value=$2
  local env_tmp
  env_tmp=$(mktemp "${ENV_FILE}.tmp.XXXXXX")
  if ! awk -v key="${key}" -v value="${value}" '
    BEGIN { updated = 0 }
    index($0, key "=") == 1 {
      if (!updated) print key "=" value
      updated = 1
      next
    }
    { print }
    END { if (!updated) print key "=" value }
  ' "${ENV_FILE}" > "${env_tmp}"; then
    rm -f -- "${env_tmp}"
    return 1
  fi
  chown root:atlas-sync "${env_tmp}"
  chmod 0640 "${env_tmp}"
  mv -f -- "${env_tmp}" "${ENV_FILE}"
}

if [[ ! -f ${ENV_FILE} ]]; then
  sync_token=$(openssl rand -hex 32)
  cat > "${ENV_FILE}" <<EOF
ATLAS_SYNC_HOST=127.0.0.1
ATLAS_SYNC_PORT=8787
ATLAS_SYNC_DB_PATH=/var/lib/atlas-sync/atlas-sync.sqlite
ATLAS_SYNC_ALLOWED_ORIGINS=${public_origin}
ATLAS_SYNC_TOKEN=${sync_token}
EOF
  unset sync_token
else
  # Preserve the admin token and any additional settings while reconciling
  # non-secret runtime values required by this deployment. In particular,
  # older installs only allowed localhost/Capacitor origins.
  existing_token=$(awk -F= '$1 == "ATLAS_SYNC_TOKEN" { sub(/^[^=]*=/, ""); print; exit }' "${ENV_FILE}")
  if [[ ${#existing_token} -lt 24 ]]; then
    echo "Existing ATLAS_SYNC_TOKEN is missing or invalid; refusing to overwrite it." >&2
    exit 1
  fi
  unset existing_token
  install -m 0640 -o root -g atlas-sync "${ENV_FILE}" "${ENV_FILE}.pre-${RELEASE_ID}"

  existing_origins=$(awk -F= '$1 == "ATLAS_SYNC_ALLOWED_ORIGINS" { sub(/^[^=]*=/, ""); print; exit }' "${ENV_FILE}")
  case ",${existing_origins}," in
    *,"${public_origin}",*) allowed_origins=${existing_origins} ;;
    *) allowed_origins="${existing_origins:+${existing_origins},}${public_origin}" ;;
  esac
  update_env_value ATLAS_SYNC_HOST 127.0.0.1
  update_env_value ATLAS_SYNC_PORT 8787
  update_env_value ATLAS_SYNC_DB_PATH /var/lib/atlas-sync/atlas-sync.sqlite
  update_env_value ATLAS_SYNC_ALLOWED_ORIGINS "${allowed_origins}"
  unset existing_origins allowed_origins
fi
chown root:atlas-sync "${ENV_FILE}"
chmod 0640 "${ENV_FILE}"

for link_path in /opt/atlas-sync/current /opt/atlas-sync/app; do
  if [[ -e ${link_path} && ! -L ${link_path} ]]; then
    echo "${link_path} exists and is not a symlink; refusing to overwrite it." >&2
    exit 1
  fi
done
ln -sfn "${RELEASE_DIR}" /opt/atlas-sync/current
ln -sfn "${RELEASE_DIR}" /opt/atlas-sync/app

install -m 0644 "${UPLOAD_DIR}/deploy/vds/atlas-sync.service" /etc/systemd/system/atlas-sync.service
install -m 0755 "${UPLOAD_DIR}/deploy/vds/backup-atlas-sync.sh" /usr/local/libexec/atlas-sync/backup-atlas-sync.sh
install -m 0644 "${UPLOAD_DIR}/deploy/vds/atlas-sync-backup.service" /etc/systemd/system/atlas-sync-backup.service
install -m 0644 "${UPLOAD_DIR}/deploy/vds/atlas-sync-backup.timer" /etc/systemd/system/atlas-sync-backup.timer
install -m 0644 "${UPLOAD_DIR}/deploy/vds/README.md" /usr/local/share/doc/atlas-sync/README.md
install -m 0644 "${UPLOAD_DIR}/deploy/vds/RESTORE.md" /usr/local/share/doc/atlas-sync/RESTORE.md

sed "s/__ATLAS_HOSTNAME__/${ATLAS_HOSTNAME}/g" \
  "${UPLOAD_DIR}/deploy/vds/atlas-sync-apache.conf" \
  > /etc/apache2/sites-available/atlas-sync.conf

a2enmod proxy proxy_http headers >/dev/null
a2ensite atlas-sync >/dev/null
apache2ctl configtest

systemctl daemon-reload
systemctl enable atlas-sync.service >/dev/null
# `enable --now` does not restart an already active service. A real restart is
# required on upgrades so the process loads the new release and the hardened
# UMask applies to newly opened SQLite WAL/SHM files.
systemctl restart atlas-sync.service
systemctl enable --now atlas-sync-backup.timer
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

systemctl start atlas-sync-backup.service

certbot --apache \
  --cert-name "${ATLAS_HOSTNAME}" \
  --domain "${ATLAS_HOSTNAME}" \
  --non-interactive \
  --agree-tos \
  --email "${ATLAS_CERTBOT_EMAIL}" \
  --redirect

# Certbot can preserve an older generated HTTPS vhost when a certificate
# already exists. Render Atlas's HTTPS routing explicitly, then disable the
# legacy generated site so Studio and Capture cannot remain hidden behind an
# old catch-all API proxy.
sed "s/__ATLAS_HOSTNAME__/${ATLAS_HOSTNAME}/g" \
  "${UPLOAD_DIR}/deploy/vds/atlas-sync-apache-ssl.conf" \
  > /etc/apache2/sites-available/atlas-sync-ssl.conf

if [[ -L /etc/apache2/sites-enabled/atlas-sync-le-ssl.conf ]]; then
  a2dissite atlas-sync-le-ssl >/dev/null
fi
a2enmod ssl >/dev/null
a2ensite atlas-sync-ssl >/dev/null
apache2ctl configtest
systemctl reload apache2

curl --fail --silent --show-error "https://${ATLAS_HOSTNAME}/health" >/dev/null
systemctl is-enabled --quiet certbot.timer
systemctl is-enabled --quiet atlas-sync-backup.timer

echo "Atlas Sync installed."
echo "Release: ${RELEASE_DIR}"
echo "HTTPS health: https://${ATLAS_HOSTNAME}/health"
echo "Daily SQLite backup timer is enabled."
echo "Restore guide: /usr/local/share/doc/atlas-sync/RESTORE.md"
echo "The admin token remains in /etc/atlas-sync/atlas-sync.env."

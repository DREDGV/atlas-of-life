FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json ./
COPY server ./server
COPY js/sync/inbox-protocol.js ./js/sync/inbox-protocol.js

RUN mkdir -p /data && chown -R node:node /data
USER node

ENV ATLAS_SYNC_HOST=0.0.0.0
ENV ATLAS_SYNC_PORT=8787
ENV ATLAS_SYNC_DB_PATH=/data/atlas-sync.sqlite

EXPOSE 8787
VOLUME ["/data"]

CMD ["node", "--no-warnings", "server/start.js"]

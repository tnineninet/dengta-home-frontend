FROM node:22-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PUPPETEER_SKIP_DOWNLOAD=true \
    NODE_ENV=production \
    XHS_SERVICE_TOKEN=change-me \
    PORT=8080

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    python3 \
    python3-pip \
    curl \
    ca-certificates \
    fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

# uv(供 xhs-api 自举 Python 依赖)
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:${PATH}"

# puppeteer(用系统 chromium)
RUN npm install -g puppeteer-core@latest xhs-api@0.3.0 && npm cache clean --force

WORKDIR /app
COPY server.js ./server.js

RUN mkdir -p /data/chrome-profile /root/.config/xhs-api

EXPOSE 8080
CMD ["node", "server.js"]

# Build stage
FROM node:lts-bookworm AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY . .
# Optional build-time configuration (see docs → Self-Hosting):
#   VITE_SELF_HOSTED=true  → fully-offline build: no external defaults, cloud UI hidden
#   VITE_TEMPLATE_API_URL  → point cloud features at your own API
#   VITE_DEVICES_URL       → point device-database links at your own devices site
ARG VITE_SELF_HOSTED
ARG VITE_TEMPLATE_API_URL
ARG VITE_DEVICES_URL
ENV VITE_SELF_HOSTED=$VITE_SELF_HOSTED \
    VITE_TEMPLATE_API_URL=$VITE_TEMPLATE_API_URL \
    VITE_DEVICES_URL=$VITE_DEVICES_URL
RUN npm run build

# Production stage
FROM nginx:bookworm
ARG VITE_SELF_HOSTED
# Self-hosted builds get a locked-down CSP (default-src 'self') as an enforcement
# backstop; the default conf (no CSP) is kept for builds that talk to an API.
COPY docker/nginx.conf docker/nginx-selfhosted.conf /tmp/nginx/
RUN if [ "$VITE_SELF_HOSTED" = "true" ] || [ "$VITE_SELF_HOSTED" = "1" ]; then \
      cp /tmp/nginx/nginx-selfhosted.conf /etc/nginx/conf.d/default.conf; \
    else \
      cp /tmp/nginx/nginx.conf /etc/nginx/conf.d/default.conf; \
    fi && rm -rf /tmp/nginx
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

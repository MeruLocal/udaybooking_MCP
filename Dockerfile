# ---------------------------------------------------------------------------
# udaybooking-mcp-server — MCP server over Streamable HTTP.
#
# Multi-stage. The final image runs the compiled JavaScript as a non-root user,
# binds 0.0.0.0:3004, and contains no dev dependencies and no build toolchain.
#
# This image runs the HTTP transport (dist/http.js), not stdio: a container that
# speaks stdio has nothing to speak to. For Claude Desktop, run the server from
# a checkout instead — see README section 4.
#
# Unlike a static site, this server needs OUTBOUND network at RUNTIME: every
# tool reads udaybooking.com. A container with no egress will start, pass no
# health check beyond /health, and fail every content tool with
# UPSTREAM_UNAVAILABLE.
# ---------------------------------------------------------------------------

# ---- Stage 1: install dependencies -----------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app

# libc6-compat: some npm postinstall binaries expect glibc symbols on musl.
RUN apk add --no-cache libc6-compat

COPY package.json package-lock.json* ./
RUN npm ci

# ---- Stage 2: build ---------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY tsconfig.json ./
COPY package.json ./
COPY src ./src

# tsc only; tsconfig.json includes src/** and emits to dist/.
RUN npm run build

# ---- Stage 3: production dependencies ---------------------------------------
# A separate install rather than pruning stage 2, so the runtime node_modules
# never contains a dev package and this layer caches on package-lock.json alone.
FROM node:22-alpine AS prod-deps
WORKDIR /app

RUN apk add --no-cache libc6-compat

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# ---- Stage 4: runtime -------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Bind on every interface. Binding to 127.0.0.1 inside a container produces a
# process that looks healthy and answers nothing from outside it.
#
# Read this together with the security note in README section 4a: outside a
# container this server binds loopback ON PURPOSE, because it has no
# authentication. Here, reachability is controlled by what you publish
# (`-p 127.0.0.1:3004:3004` keeps it on your machine) and by the network the
# container joins — NOT by the bind address. Publishing this port on a public
# interface lets anyone reach it fetch udaybooking.com through your host.
ENV UDAYBOOKING_HTTP_HOST=0.0.0.0
ENV UDAYBOOKING_HTTP_PORT=3004

# Politeness settings. The defaults are already conservative; they are repeated
# here so the operating values are visible in `docker inspect` rather than
# buried in config.ts. udaybooking.com answers a burst by refusing connections
# for minutes, so do not raise concurrency without reading README section 8.
ENV UDAYBOOKING_MAX_CONCURRENCY=2
ENV UDAYBOOKING_MIN_REQUEST_INTERVAL_MS=250
ENV UDAYBOOKING_LOG_LEVEL=info

# No credentials are set, and none exist: udaybooking publishes no authenticated
# API, so this server holds no password, cookie, API key or session token.
# There is deliberately no secret to pass with `docker run -e`.

RUN addgroup -g 1001 -S nodejs \
 && adduser -S mcp -u 1001

COPY --from=prod-deps --chown=mcp:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=mcp:nodejs /app/dist ./dist
COPY --chown=mcp:nodejs package.json ./

USER mcp

EXPOSE 3004

# Container-level health signal. /health needs no session and makes no outbound
# request, so it answers even while udaybooking.com is unreachable — it reports
# that this process is alive, not that the upstream is.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3004/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/http.js"]

# Pancake POS MCP - Deployment Guide

**Version:** 0.1.0  
**Last Updated:** 2026-05-12  
**Audience:** DevOps engineers, system administrators, developers

---

## Quick Start (5 Minutes)

### Prerequisites

- Bun runtime (https://bun.sh)
- Pancake POS account with API credentials
- Terminal/shell access

### Installation

```bash
# Clone or download project
cd pancake-pos-mcp

# Install dependencies
bun install

# Create environment configuration
cp .env.example .env

# Edit .env with your credentials
nano .env
```

### Run Locally

```bash
# Stdio mode (Claude Desktop)
bun run src/index.ts

# OR HTTP mode (remote access)
bun run src/index.ts --http
```

Server logs to stderr. Success indicator: `[pancake-pos-mcp] Server started on...`

---

## Environment Configuration

### Required Variables

Create `.env` file with these values:

```bash
# Pancake API Key (required)
# Get from: Pancake POS dashboard → Settings → API & Integrations
PANCAKE_POS_API_KEY=your_api_key_here

# Pancake Shop ID (required)
# Get from: Pancake POS dashboard → Shop settings
PANCAKE_POS_SHOP_ID=your_shop_id_here
```

### Optional Variables

```bash
# Override API base URL (default: https://pos.pages.fm/api/v1)
PANCAKE_POS_BASE_URL=https://pos.pages.fm/api/v1

# HTTP server port (default: 3000, only for --http mode)
PORT=3000

# Bearer token for HTTP authentication (recommended for production)
MCP_AUTH_TOKEN=your_secret_token_here
```

### Getting Credentials

#### PANCAKE_POS_API_KEY

1. Log in to Pancake POS (https://pos.pages.fm)
2. Navigate to Settings → API & Integrations
3. Create new API key or copy existing one
4. Key format: Usually a long alphanumeric string

#### PANCAKE_POS_SHOP_ID

1. Log in to Pancake POS
2. Navigate to Shop Settings
3. Find Shop ID (usually a UUID like `f47ac10b-58cc-4372-a567-0e02b2c3d479`)
4. Copy and paste into .env

### Validation

After creating `.env`, verify configuration:

```bash
# Type-check the configuration
bun run typecheck

# Check for errors (should show: no errors found)
```

---

## Transport Modes

### Mode 1: Stdio (Default)

**Best for:** Claude Desktop, local development, scripts

```bash
bun run src/index.ts
```

or explicitly:

```bash
bun run src/index.ts --stdio
```

**Output:**
```
[pancake-pos-mcp] Server started on stdio transport
```

**Claude Desktop Integration:**

Edit `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "pancake-pos": {
      "command": "bun",
      "args": [
        "run",
        "/absolute/path/to/pancake-pos-mcp/src/index.ts"
      ]
    }
  }
}
```

**Location by OS:**
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%/Claude/claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

**After updating config:**
1. Restart Claude Desktop
2. Models → Settings → Extensions/Integrations
3. Verify "pancake-pos" appears in available models
4. Test with: "List my 5 most recent orders"

### Mode 2: HTTP (Streamable)

**Best for:** Remote access, server deployment, orchestration

```bash
bun run src/index.ts --http
```

**Output:**
```
[pancake-pos-mcp] Server started on HTTP transport at http://localhost:3000/mcp
```

**Endpoints:**

| Endpoint | Auth Required | Purpose |
|----------|---|---------|
| `GET /health` | No | Health check (returns 200) |
| `POST /mcp` | Yes* | MCP protocol endpoint |

*Auth required if `MCP_AUTH_TOKEN` is set (recommended)

**Client Usage (curl):**

```bash
# With authentication (recommended)
curl -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_secret_token" \
  -d '{"jsonrpc":"2.0",...}' \
  http://localhost:3000/mcp

# Without authentication (development only)
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0",...}' \
  http://localhost:3000/mcp
```

**Health Check:**

```bash
curl http://localhost:3000/health
# Response: {"status":"ok","transport":"streamable-http"}
```

**Authentication Setup:**

```bash
# .env
PORT=3000
MCP_AUTH_TOKEN=super_secret_token_xyz

# On startup, server will log:
# [pancake-pos-mcp] Server started on HTTP transport at http://localhost:3000/mcp
```

---

## Deployment Options

This project supports three deployment models:
1. **Claude Desktop (Stdio)** — Local machine, single-user
2. **HTTP Server** — Single machine or VM, multi-client
3. **Cloudflare Workers** — Serverless, global edge network

---

## Deployment Architectures

### Architecture 1: Claude Desktop (Stdio)

**Topology:**
```
Claude Desktop
    ↓ (stdio)
pancake-pos-mcp (stdio mode)
    ↓ (HTTPS)
Pancake POS API
```

**Deployment Steps:**

1. Install Bun on development machine
2. Copy project to local machine
3. Configure .env with credentials
4. Add MCP server to claude_desktop_config.json
5. Restart Claude Desktop
6. Test via Claude chat

**Pros:**
- Zero infrastructure
- Works offline (for cached resources)
- Simple setup

**Cons:**
- Single-user only
- Not remotely accessible
- Tied to specific machine

---

### Architecture 2: HTTP Server (Single Machine)

**Topology:**
```
Multiple Clients
    ↓ (HTTPS)
pancake-pos-mcp (HTTP mode)
    ↓ (HTTPS)
Pancake POS API
```

**Deployment Steps:**

1. Install Bun on server
2. Copy project to server
3. Configure .env (important: set MCP_AUTH_TOKEN)
4. Start server: `bun run src/index.ts --http`
5. Ensure firewall allows port 3000 (or configured PORT)
6. Clients connect with Bearer token

**Systemd Service (Linux/macOS):**

Create `/etc/systemd/system/pancake-pos-mcp.service`:

```ini
[Unit]
Description=Pancake POS MCP Server
After=network.target

[Service]
Type=simple
User=pancake-mcp
WorkingDirectory=/opt/pancake-pos-mcp
Environment="PATH=/usr/local/bin"
ExecStart=/usr/local/bin/bun run src/index.ts --http
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable pancake-pos-mcp
sudo systemctl start pancake-pos-mcp
sudo systemctl status pancake-pos-mcp
```

View logs:

```bash
sudo journalctl -u pancake-pos-mcp -f
```

**Nginx Reverse Proxy (HTTPS):**

```nginx
server {
    listen 443 ssl http2;
    server_name pancake-mcp.example.com;

    ssl_certificate /etc/letsencrypt/live/pancake-mcp.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/pancake-mcp.example.com/privkey.pem;

    location /health {
        proxy_pass http://localhost:3000;
    }

    location /mcp {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

Restart nginx:

```bash
sudo nginx -t
sudo systemctl restart nginx
```

**Client Usage:**

```bash
curl -X POST \
  -H "Authorization: Bearer your_secret_token" \
  https://pancake-mcp.example.com/mcp
```

**Pros:**
- Multi-user access
- Remote accessibility
- Can scale to multiple clients

**Cons:**
- Requires server infrastructure
- SSL/TLS certificate management
- More operational overhead

---

### Architecture 3: Docker Container

**Optional:** Docker support (not included in base package)

To containerize:

**Dockerfile:**

```dockerfile
FROM oven/bun:latest

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install

COPY src ./src
COPY tsconfig.json ./

ENV NODE_ENV=production
EXPOSE 3000

CMD ["bun", "run", "src/index.ts", "--http"]
```

**Build:**

```bash
docker build -t pancake-pos-mcp:0.1.0 .
```

**Run:**

```bash
docker run -d \
  --name pancake-pos-mcp \
  -p 3000:3000 \
  -e PANCAKE_POS_API_KEY=your_key \
  -e PANCAKE_POS_SHOP_ID=your_shop_id \
  -e MCP_AUTH_TOKEN=your_token \
  pancake-pos-mcp:0.1.0
```

**Docker Compose:**

```yaml
version: '3.8'

services:
  pancake-pos-mcp:
    build: .
    container_name: pancake-pos-mcp
    ports:
      - "3000:3000"
    environment:
      PANCAKE_POS_API_KEY: ${PANCAKE_POS_API_KEY}
      PANCAKE_POS_SHOP_ID: ${PANCAKE_POS_SHOP_ID}
      MCP_AUTH_TOKEN: ${MCP_AUTH_TOKEN}
      PORT: 3000
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 5s
      retries: 3
```

**Start:**

```bash
docker-compose up -d
docker-compose logs -f
```

---

### Architecture 4: Cloudflare Workers (Serverless)

**Topology:**
```
Multiple Clients (worldwide)
    ↓ (HTTPS)
Cloudflare Workers (global edge network)
    ↓ (HTTPS)
Pancake POS API
```

**Prerequisites:**
- Cloudflare account (free or paid)
- Wrangler CLI installed: `npm install -g wrangler`
- Pancake API credentials

**Deployment Steps:**

1. **Login to Cloudflare:**

```bash
wrangler login
# Opens browser to authorize Cloudflare access
```

2. **Configure Secrets:**

```bash
# Set API credentials (stored securely in Cloudflare)
wrangler secret put PANCAKE_POS_API_KEY
# Paste your key and press Ctrl+D

wrangler secret put PANCAKE_POS_SHOP_ID
# Paste your shop ID and press Ctrl+D

# Optional: set MCP auth token
wrangler secret put MCP_AUTH_TOKEN
# Paste your bearer token
```

3. **Deploy:**

```bash
wrangler deploy
# Builds and deploys to Cloudflare Workers
# Output: https://pancake-pos-mcp.your-subdomain.workers.dev
```

4. **Verify Deployment:**

```bash
curl https://pancake-pos-mcp.your-subdomain.workers.dev/health
# Response: {"status":"ok","transport":"streamable-http"}
```

**Usage:**

```bash
# With auth token (if MCP_AUTH_TOKEN is set)
curl -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_token" \
  -d '{"jsonrpc":"2.0","method":"tools/list",...}' \
  https://pancake-pos-mcp.your-subdomain.workers.dev/mcp

# Without auth token (development only)
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list",...}' \
  https://pancake-pos-mcp.your-subdomain.workers.dev/mcp
```

**Custom Domain (Optional):**

```bash
# In Cloudflare dashboard:
# 1. Go to Workers → Routes
# 2. Add route: pancake-mcp.example.com/*
# 3. Service: pancake-pos-mcp
# 4. Zone: example.com

# Test with custom domain
curl https://pancake-mcp.example.com/health
```

**Claude Desktop via mcp-remote:**

Since Claude Desktop uses stdio transport, connect to the Workers endpoint using `mcp-remote` as a bridge:

```json
{
  "mcpServers": {
    "pancake-pos": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://pancake-pos-mcp.your-subdomain.workers.dev/mcp",
        "--header", "Authorization: Bearer your_token"
      ]
    }
  }
}
```

**Local Development:**

```bash
# Copy secrets template
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your credentials

# Start local Workers dev server
bun run dev:workers
# Runs at http://localhost:8787
```

**Performance Characteristics:**

| Metric | Value |
|--------|-------|
| Timeout | 8 seconds (Cloudflare limit) |
| Retries | 2 attempts |
| Rate Limiter | Disabled (per-request model) |
| Regions | Global edge network |
| Cold Start | < 50ms |

**Cost Model:**
- Free tier: 100,000 requests/day
- Paid tier: $0.50/million requests
- No charge for idle time

**Monitoring:**

Cloudflare dashboard → Workers → analytics:
- Requests
- Errors (4xx, 5xx)
- CPU time
- Wall-clock time

**Troubleshooting:**

**Issue:** "Secret not found" on deploy
```bash
wrangler secret list
# Check that all required secrets exist
```

**Issue:** "Worker timeout" on slow Pancake API calls
- Use `POST /statistics` or large paginated lists sparingly
- Consider pre-caching on Bun server instead

**Issue:** "CORS error" from client
- CORS headers are automatically added by worker
- Check that client sends correct `Authorization` header

**Pros:**
- Global CDN, low latency worldwide
- No infrastructure management
- Automatic scaling
- Cheap (pay-per-request)
- Easy rollback (instant deploy)

**Cons:**
- 8s timeout (shorter than Bun 30s)
- No persistent state (per-request lifecycle)
- Reduced retry budget (2 vs 3)
- Cloudflare-specific (vendor lock-in)

---

## Security Best Practices

### 1. Credential Management

**Do:**
- Store credentials in .env file (git-ignored)
- Use environment variables in production
- Rotate API keys regularly
- Use unique MCP_AUTH_TOKEN per environment

**Don't:**
- Commit .env to version control
- Log credentials in error messages
- Use same credentials for dev/staging/prod
- Share credentials via unencrypted channels

### 2. HTTP Transport

**Do:**
- Always use HTTPS in production
- Set strong MCP_AUTH_TOKEN (32+ characters)
- Validate Bearer token on every request
- Monitor failed auth attempts

**Don't:**
- Run HTTP mode on internet-facing server without HTTPS
- Use default or weak auth token
- Skip token validation for "trusted" clients

### 3. Network Access

**Do:**
- Firewall port 3000 to authorized IPs
- Use VPN for remote access
- Rate-limit requests at proxy level
- Monitor for unusual activity

**Don't:**
- Expose port 3000 to 0.0.0.0:*
- Allow unlimited connections per IP
- Skip network segmentation

### 4. API Key Security

**Do:**
- Create separate API keys for different environments
- Monitor Pancake API key usage
- Revoke unused keys
- Store keys in secure vaults (AWS Secrets Manager, HashiCorp Vault)

**Don't:**
- Use production key for testing
- Share key with non-essential services
- Store key in code or config files

---

## Monitoring & Troubleshooting

### Health Check

```bash
# Every 30 seconds
curl http://localhost:3000/health

# Expected response
{"status":"ok","transport":"streamable-http"}
```

### Log Analysis

**Stdio Mode:**
```bash
bun run src/index.ts 2>&1 | tee pancake-mcp.log
```

**HTTP Mode:**
```bash
bun run src/index.ts --http 2>&1 | tee pancake-mcp.log
```

**Log Patterns:**

| Pattern | Meaning | Action |
|---------|---------|--------|
| `Server started on` | Successful startup | OK ✓ |
| `API rate limited` | 1000/min or 10000/hr exceeded | Reduce request frequency |
| `Unauthorized` | Invalid auth token | Check MCP_AUTH_TOKEN |
| `API error 401` | Invalid Pancake credentials | Verify API_KEY and SHOP_ID |
| `Network timeout` | Can't reach Pancake API | Check network, Pancake status |

### Common Issues

#### Issue: "Module not found" on startup

```
Error: Cannot find module "@modelcontextprotocol/sdk"
```

**Solution:**
```bash
bun install
```

#### Issue: "Invalid credentials" from Pancake API

```
API error 401: Unauthorized
```

**Solution:**
1. Verify PANCAKE_POS_API_KEY is correct (check Pancake dashboard)
2. Verify PANCAKE_POS_SHOP_ID is correct
3. Regenerate API key if expired
4. Check that shop is active

#### Issue: Rate limit errors

```
Rate limit exceeded: 1000 requests/minute
```

**Solution:**
- Reduce request frequency
- Batch operations where possible
- Check for infinite loops in Claude prompts

#### Issue: "Connection refused" on HTTP mode

```
Error connecting to localhost:3000
```

**Solution:**
1. Verify server is running: `curl http://localhost:3000/health`
2. Check PORT setting in .env
3. Verify firewall allows port (not blocked by UFW, iptables, etc.)
4. Try different port if 3000 is in use: `PORT=3001 bun run src/index.ts --http`

#### Issue: High memory usage

```
Process consuming >500MB RAM
```

**Solution:**
- Check tool-registry hasn't duplicated tool registrations
- Restart server to clear any memory leaks
- Monitor Pancake API response sizes (large paginated results)

---

## Performance Tuning

### Rate Limiting

Default limits are optimized for normal usage:
- **Per-minute:** 1,000 requests
- **Per-hour:** 10,000 requests

If rate-limited, requests queue automatically. No configuration needed.

### Response Caching

Currently no caching. Future versions may include:
- Cache shipping partners (changes infrequently)
- Cache order statuses and references
- Configurable TTL

### Pagination

Default page sizes:
- Orders list: 30 items/page
- Products list: 30 items/page
- Customers list: 30 items/page

Optimize queries by:
- Requesting only needed fields
- Using filters (search, status, date range)
- Requesting appropriate page size

---

## Maintenance

### Regular Tasks

**Weekly:**
- Check logs for errors
- Verify health check passes
- Monitor API rate limit consumption

**Monthly:**
- Review Pancake API changelog for breaking changes
- Audit access logs
- Validate credentials still work

**Quarterly:**
- Rotate API keys
- Update dependencies (if security updates available)
- Review and update security practices

### Backup & Recovery

**What to backup:**
- `.env` file (credentials)
- Configuration customizations
- Custom tool extensions (if added)

**Recovery:**
1. Install Bun
2. Clone/copy project
3. Restore .env with correct credentials
4. Run `bun install`
5. Start server

---

## Version Updates

### Check for Updates

No auto-update mechanism. To update:

```bash
# Check current version
cat package.json | grep version

# To update:
git pull origin main
bun install
bun run typecheck  # Verify compatibility
```

### Breaking Changes

v0.1.0 is stable. Breaking changes would increment to v0.2.0+.

Check `docs/project-roadmap.md` for planned changes.

---

## Support & Troubleshooting

### Getting Help

1. **Check logs** — `journalctl -u pancake-pos-mcp` or terminal output
2. **Review docs** — Check `./docs` directory
3. **Verify credentials** — Confirm Pancake API key and shop ID
4. **Test health endpoint** — `curl http://localhost:3000/health`
5. **Check Pancake status** — Visit https://pos.pages.fm

### Reporting Issues

Include:
- Error message or log output
- Steps to reproduce
- Deployment mode (stdio vs HTTP)
- Operating system and Bun version

---

**Document Purpose:** Enable seamless deployment of Pancake POS MCP across development, staging, and production environments.

**Last Updated:** 2026-04-11  
**Maintainer:** DevOps & Platform Engineering

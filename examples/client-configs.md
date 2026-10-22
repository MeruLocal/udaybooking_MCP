# Example client configs

The hosted endpoint is `https://mcp.udaybooking.com/mcp` (Streamable HTTP, no authentication, read-only). Use it only after the deployment of this repo's latest build is confirmed; until then run the server locally (see the README).

## Claude Code
```bash
claude mcp add --transport http udaybooking https://mcp.udaybooking.com/mcp
```

## Claude Desktop (local stdio)
```json
{ "mcpServers": { "udaybooking": { "command": "node", "args": ["/path/to/udaybooking_MCP/dist/index.js"] } } }
```

## Cursor (`.cursor/mcp.json`)
```json
{ "mcpServers": { "udaybooking": { "url": "https://mcp.udaybooking.com/mcp" } } }
```

## VS Code (`.vscode/mcp.json`)
```json
{ "servers": { "udaybooking": { "type": "http", "url": "https://mcp.udaybooking.com/mcp" } } }
```

## Questions it is built to answer
- "What are alternatives to Calendly for a small team?" (udaybooking_list_comparisons, then udaybooking_get_page)
- "How does round robin scheduling work?" (udaybooking_search_content)
- "How much does it cost in India and in USD?" (udaybooking_get_pricing)
- "Can it book appointments for me?" (udaybooking_get_automation_capabilities: no)

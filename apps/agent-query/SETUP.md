# Provenance MCP Server — Setup Guide

Connect Claude Desktop to the Provenance platform to query data products,
trust scores, lineage, and SLOs using natural language.

## Prerequisites

- Provenance stack running on EC2 (all services healthy)
- Claude Desktop installed (Mac or Windows)

## Step 1 — Open Claude Desktop Config

**Mac:**
```bash
open ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

**Windows:**
```
%APPDATA%\Claude\claude_desktop_config.json
```

If the file does not exist, create it.

## Step 2 — Add the Provenance MCP Server

Add or merge the following into your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "provenance": {
      "url": "http://54.83.160.49:3002/mcp/sse",
      "apiKey": "provenance-mcp-dev-key-2026"
    }
  }
}
```

## Step 3 — Restart Claude Desktop

Quit Claude Desktop completely and reopen it. The Provenance tools
should appear in the tools menu (hammer icon).

## Step 4 — Test It

Try these prompts in Claude Desktop:

- "What data products does org e9213d00-264f-40ff-b1ee-52241bfe033e have?"
- "Tell me about the Daily Revenue Report"
- "What is the trust score for the Customer 360 product?"
- "Show me the lineage for Daily Revenue Report"

## Available Tools

| Tool | Description |
|---|---|
| `list_products` | List all data products with status and trust scores |
| `get_product` | Get detailed product information |
| `get_trust_score` | Get trust score with component breakdown |
| `get_lineage` | Get upstream sources and downstream consumers |
| `get_slo_summary` | Get SLO health summary |
| `search_products` | Search products by keyword |

## Troubleshooting

- **Tools not appearing:** Verify the MCP server is healthy: `curl http://54.83.160.49:3002/health`
- **Connection refused:** Check that port 3002 is open in the EC2 security group
- **Auth errors:** Verify the apiKey matches MCP_API_KEY in the server config

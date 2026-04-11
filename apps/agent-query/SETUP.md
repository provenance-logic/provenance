# Connecting Claude Desktop to Provenance

This guide walks you through connecting Claude Desktop to the
Provenance data mesh platform. Once connected, you can ask Claude
questions about your data products, trust scores, lineage, and SLOs
using natural language.

## Prerequisites

- **Claude Desktop** installed on your Mac or Windows PC
- **Node.js 18+** installed (needed to run the connection bridge)
  - Mac: `brew install node`
  - Windows: download from https://nodejs.org

## Step 1 — Open your Claude Desktop config file

**Mac:**
Open Terminal and run:
```
open ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

If the file does not exist, create it:
```
mkdir -p ~/Library/Application\ Support/Claude
echo '{}' > ~/Library/Application\ Support/Claude/claude_desktop_config.json
open ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

**Windows:**
Open the file at:
```
%APPDATA%\Claude\claude_desktop_config.json
```

## Step 2 — Add the Provenance server

Paste the following into your config file. If the file already has
other MCP servers, add `"provenance"` inside the existing
`"mcpServers"` block.

```json
{
  "mcpServers": {
    "provenance": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "http://54.83.160.49:3002/mcp/sse"
      ]
    }
  }
}
```

Save the file.

## Step 3 — Restart Claude Desktop

Quit Claude Desktop completely (Cmd+Q on Mac, Alt+F4 on Windows)
and reopen it. The first launch after adding the config may take
a few seconds while it downloads the connection bridge.

## Step 4 — Verify the connection

Look for the hammer icon in the Claude Desktop input area. Click it
and you should see 6 Provenance tools listed:

| Tool | What it does |
|---|---|
| list_products | List all data products with status and trust scores |
| get_product | Get detailed product information |
| get_trust_score | Get trust score with component breakdown |
| get_lineage | Show upstream sources and downstream consumers |
| get_slo_summary | Get SLO health summary |
| search_products | Search products by keyword |

## Step 5 — Try it out

Type any of these into Claude Desktop:

- "What data products does org e9213d00-264f-40ff-b1ee-52241bfe033e have?"
- "What is the trust score for product 93ab2cb6-493f-4035-a387-854039627eaf?"
- "Show me the lineage for the Daily Revenue Report"
- "Search for products related to revenue"

Claude will use the Provenance tools to fetch real data and answer
your questions.

## Troubleshooting

**Tools not appearing in Claude Desktop:**
- Make sure you saved the config file and fully restarted Claude Desktop
- Check that Node.js is installed: run `node --version` in your terminal

**"Connection refused" or timeout errors:**
- Verify the Provenance server is running: open http://54.83.160.49:3002/health in your browser — you should see `{"status":"ok"}`
- Check that your IP is allowed in the EC2 security group

**First launch is slow:**
- The first time, `npx` downloads the `mcp-remote` bridge package. This is a one-time download and takes 5-10 seconds.

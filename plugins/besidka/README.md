# Besidka plugin

This plugin connects an AI client to the Besidka MCP server. It lets the client read and organise your Besidka chats, projects, project knowledge, memory, files and settings.

The MCP server URL is `https://besidka.com/mcp`.

Public tools need no sign-in. They list the models and providers Besidka supports and link to the key guides. Private tools use OAuth 2.1 with dynamic client registration. You approve each permission scope separately, and deleting anything needs its own scope.

For the full tool list and the design decisions, see [`docs/mcp-server.md`](../../docs/mcp-server.md) and [`docs/mcp-marketplaces.md`](../../docs/mcp-marketplaces.md).

## Install in Cursor manually

Add this entry to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "besidka": {
      "type": "streamable-http",
      "url": "https://besidka.com/mcp"
    }
  }
}
```

## Build the ChatGPT upload archive

Run this from the repository root:

```bash
cd plugins/besidka && zip -r ../../besidka-plugin.zip plugin.json mcp.json assets README.md
```

Upload the archive in the ChatGPT plugin submission form, then delete it. The archive is gitignored and must not be committed.

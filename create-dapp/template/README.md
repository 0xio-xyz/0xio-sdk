# __TITLE__

A dapp on the Octra network, built with [`@0xio/sdk`](https://www.npmjs.com/package/@0xio/sdk), Vite, React and TypeScript.

## Run

```bash
npm install
npm run dev
```

Open the page in a browser with the [0xio Wallet extension](https://chromewebstore.google.com/detail/0xio-wallet/anknhjilldkeelailocijnfibefmepcc), or with 0xio Desktop running. Needs Node 20.19 or newer.

| Script | Does |
|--------|------|
| `npm run dev` | Dev server |
| `npm run build` | Typecheck and production build in `dist/` |
| `npm run typecheck` | Typecheck only |
| `npm run preview` | Serve `dist/` |

## What it does

- Detects the wallet, connects, and restores a session on reload
- Shows the address and the OCT balance for the current network
- Switches between Mainnet and Devnet
- Sends OCT with a request id, `wait: 'confirmed'` and a status line
- Follows a send the SDK lost track of (`STATUS_UNKNOWN`) instead of sending again
- Hides sending for watch-only wallets
- Removes its listeners on unmount

## Build with an AI assistant

`AGENTS.md` holds the rules for coding assistants and loads the SDK's own rules from `node_modules/@0xio/sdk/AGENTS.md`. The 0xio docs MCP server is already set up for Claude Code (`.mcp.json`), Cursor (`.cursor/mcp.json`) and VS Code (`.vscode/mcp.json`). To add it elsewhere:

```bash
claude mcp add --transport http 0xio-docs https://docs.0xio.xyz/mcp
```

Full setup: https://docs.0xio.xyz/developers/build-with-ai

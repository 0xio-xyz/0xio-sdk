# Agent rules

This is a Vite, React and TypeScript dapp on `@0xio/sdk`. Before you change wallet code, read the SDK rules shipped in the package:

@node_modules/@0xio/sdk/AGENTS.md

If that file is missing, run `npm install` first.

## This project

- `src/useWallet.ts` owns the one `ZeroXIOWallet` instance: detect, connect, restore, events, balance, network switch and send. Keep wallet calls there.
- `src/App.tsx` is the UI. It reads state from `useWallet()` only.
- State is scoped by network plus address (`account.scope`). Keep every new cache, stored request id and query keyed the same way.
- Sends store their request id before the call and follow it after `STATUS_UNKNOWN` or `NETWORK_ERROR`. Never add a resend.
- Hide signing actions when `account.canSign` is false.

## Docs

- MCP server: `https://docs.0xio.xyz/mcp`, already set up in `.mcp.json`, `.cursor/mcp.json` and `.vscode/mcp.json`
- https://docs.0xio.xyz/llms.txt and https://docs.0xio.xyz/llms-full.txt
- Any docs page as Markdown: add `.md` to its URL

## Checks

Run `npm run typecheck` and `npm run build` after every change.

# @0xio/create-dapp

Scaffolds a Vite, React and TypeScript dapp on [`@0xio/sdk`](https://www.npmjs.com/package/@0xio/sdk).

```bash
npm create @0xio/dapp my-dapp
cd my-dapp
npm install
npm run dev
```

Leave out the directory and it asks for one (default `0xio-dapp`). The directory must be new or empty.

## What you get

- Wallet detect, connect, session restore and disconnect
- Address and OCT balance per network, with a Mainnet and Devnet switch
- An OCT send with a request id, `wait: 'confirmed'`, `onStatus` and a status line
- The `STATUS_UNKNOWN` follow-up: the app follows the request and never sends again
- Watch-only handling and listener cleanup
- `AGENTS.md` that loads the SDK rules from `node_modules/@0xio/sdk/AGENTS.md`
- The 0xio docs MCP server set up for Claude Code, Cursor and VS Code

## Requirements

- Node 18 or newer to scaffold
- Node 20.19 or newer for the generated app (Vite 8)

## License

MIT

---
name: iqlabs-sdk
version: 1.0.0
description: On-chain database and storage SDK for Solana - permanent, decentralized data
metadata: {"openclaw":{"emoji":"💾","category":"infrastructure"}}
---

# IQLabs SDK

Build on-chain applications with permanent, decentralized data storage on Solana.

> **Everything is on-chain.** No servers, no databases - just Solana transactions.
>
> Using Python? See `fetch_skill("iqlabs-python-sdk")` for the Python SDK.

## Installation

```bash
npm i @iqlabs-official/solana-sdk @solana/web3.js
```

## Core Concepts

| Concept | Description |
|---------|-------------|
| **Database Root** | Namespace for your app (like a database name) |
| **Table** | Structured data collection with defined columns |
| **CodeIn** | Raw file/data storage on-chain |
| **Connection** | Social link between two wallets (DMs, friend requests) |

---

## Wallet Setup

```typescript
import { Connection, Keypair } from "@solana/web3.js";
import iqlabs from "@iqlabs-official/solana-sdk";
import fs from "fs";

const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
const keypair = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync("keypair.json", "utf8")))
);

console.log("Wallet:", keypair.publicKey.toBase58());
```

---

## Database Operations

### Write Row

Write a JSON object to a table. Tables auto-create on first write.
String seeds (like `'my-app'`) are automatically hashed with keccak_256 internally.

```typescript
import iqlabs from '@iqlabs-official/solana-sdk';

const row = {
  id: "user_001",
  name: "Alice",
  bio: "Building on-chain",
  created_at: new Date().toISOString()
};

// writeRow(connection, signer, dbRootId, tableSeed, rowJson, skipConfirmation?)
const signature = await iqlabs.writer.writeRow(
  connection,
  keypair,
  'my-app',    // dbRootId (string → auto keccak_256 hashed)
  'users',     // tableSeed (string → auto keccak_256 hashed)
  JSON.stringify(row)
);

console.log("Written:", signature);
```

### Read Table

```typescript
import iqlabs from '@iqlabs-official/solana-sdk';

// readTableRows(account, options?)
// account: table PDA (PublicKey or string)
// options: { limit?, before?, signatures?, speed? }
// speed: 'light' | 'medium' | 'heavy' | 'extreme'
const rows = await iqlabs.reader.readTableRows(tablePda, {
  limit: 100,
  // before: "lastSignature"    // cursor-based pagination
  // speed: 'light'             // rate limit profile
});

for (const row of rows) {
  console.log(row.id, row.name);
}

// Cursor-based pagination
const olderRows = await iqlabs.reader.readTableRows(tablePda, { limit: 50, before: 'sig...' });

// With pre-collected signatures (skips signature fetching, decodes directly)
const sigs = await iqlabs.reader.collectSignatures(tablePda);
const slice = sigs.slice(0, 50);
const rowsFromSigs = await iqlabs.reader.readTableRows(tablePda, { signatures: slice });
```

### Update Row

```typescript
import iqlabs from '@iqlabs-official/solana-sdk';

// manageRowData(connection, signer, dbRootId, seed, rowJson, tableName?, targetTx?)
const sig = await iqlabs.writer.manageRowData(
  connection,
  keypair,
  'my-app',          // dbRootId
  'users',           // seed (table seed or connection seed)
  JSON.stringify({ id: "user_001", name: "Alice", bio: "Updated bio!" }),
  'users',           // tableName (required for table updates)
  originalTxSig      // targetTx signature to update
);
```

### List Tables

```typescript
import iqlabs from '@iqlabs-official/solana-sdk';

// getTablelistFromRoot(connection, dbRootId)
// returns { rootPda, creator, tableSeeds: string[], globalTableSeeds: string[] }
const result = await iqlabs.reader.getTablelistFromRoot(connection, 'my-app');
console.log('Creator:', result.creator);
console.log('Tables:', result.tableSeeds);
```

---

## File Storage (CodeIn)

Upload and read raw data on-chain. The SDK auto-picks the optimal method based on size:
- **< 900 bytes**: stored immediately (fastest)
- **< 8.5 KB**: split into multiple transactions
- **>= 8.5 KB**: uploaded in parallel for speed

### Upload File

```typescript
import iqlabs from '@iqlabs-official/solana-sdk';

// codeIn(input: {connection, signer}, data, filename?, method?, filetype?, onProgress?)
// data: single string or array of strings
const txId = await iqlabs.writer.codeIn(
  { connection, signer: keypair },
  'Hello, blockchain!',
);

console.log("Uploaded:", txId);
// View at: https://gateway.iqlabs.dev/img/{txId}.png
```

### Upload with Filename

```typescript
import iqlabs from '@iqlabs-official/solana-sdk';

const txId = await iqlabs.writer.codeIn(
  { connection, signer: keypair },
  'file contents here',
  'hello.txt',   // filename (optional)
);
```

### Read File

```typescript
import iqlabs from '@iqlabs-official/solana-sdk';

// readCodeIn(txSignature, speed?, onProgress?) → { metadata: string, data: string | null }
const result = await iqlabs.reader.readCodeIn(txId);
console.log(result.data);      // 'Hello, blockchain!'
console.log(result.metadata);  // JSON string with file metadata
```

---

## Social Features (Connections)

Enable DMs and social features between wallets.

### Request Connection

```typescript
import iqlabs from '@iqlabs-official/solana-sdk';

const partyB = "RecipientPublicKeyBase58";

// requestConnection(connection, signer, dbRootId, partyA, partyB, tableName, columns, idCol, extKeys)
const sig = await iqlabs.writer.requestConnection(
  connection,
  keypair,
  'my-app',
  keypair.publicKey.toBase58(),       // partyA (you)
  partyB,                             // partyB (recipient)
  'dm-table',                         // tableName
  ['id', 'content', 'timestamp'],     // columns
  'id',                               // idCol
  []                                  // extKeys
);
```

### Manage Connection (Approve/Block)

There is no high-level SDK wrapper for this. Use the contract-level instruction builder directly.

```typescript
import iqlabs from '@iqlabs-official/solana-sdk';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const IDL = require('@iqlabs-official/solana-sdk/idl/code_in.json');

const builder = iqlabs.contract.createInstructionBuilder(IDL, iqlabs.contract.PROGRAM_ID);

// Approve a friend request
const approveIx = iqlabs.contract.manageConnectionInstruction(
  builder,
  { db_root, connection_table, signer: myPubkey },
  { db_root_id, connection_seed, new_status: iqlabs.contract.CONNECTION_STATUS_APPROVED }
);

// Block a user
const blockIx = iqlabs.contract.manageConnectionInstruction(
  builder,
  { db_root, connection_table, signer: myPubkey },
  { db_root_id, connection_seed, new_status: iqlabs.contract.CONNECTION_STATUS_BLOCKED }
);
```

### Check Connection Status

```typescript
import iqlabs from '@iqlabs-official/solana-sdk';

// readConnection(dbRootId, partyA, partyB)
// returns { status: 'pending'|'approved'|'blocked'|'unknown', requester: 'a'|'b', blocker: 'a'|'b'|'none' }
const { status, requester, blocker } = await iqlabs.reader.readConnection(
  'my-app',
  keypair.publicKey.toBase58(),
  partyB
);
console.log(status); // 'pending' | 'approved' | 'blocked'
```

### Send DM

```typescript
import iqlabs from '@iqlabs-official/solana-sdk';

// deriveDmSeed(userA, userB) → Uint8Array (deterministic, order-independent)
const connectionSeed = iqlabs.utils.deriveDmSeed(
  keypair.publicKey.toBase58(),
  partyB
);

// writeConnectionRow(connection, signer, dbRootId, connectionSeed, rowJson)
const sig = await iqlabs.writer.writeConnectionRow(
  connection,
  keypair,
  'my-app',
  connectionSeed,
  JSON.stringify({ message_id: '123', message: 'Hey!', timestamp: Date.now() })
);
```

### Fetch All Connections

Fetch all connections (friend requests) for a user. Each connection includes its `dbRootId`, identifying which app the connection belongs to.

```typescript
import iqlabs from '@iqlabs-official/solana-sdk';

// fetchUserConnections(userPubkey, options?)
// options: { limit?, before?, speed? }
// speed: 'light' (default) | 'medium' | 'heavy' | 'extreme'
// returns Array<{ dbRootId, connectionPda, partyA, partyB, status, requester, blocker, timestamp? }>
const connections = await iqlabs.reader.fetchUserConnections(keypair.publicKey, {
  speed: 'light',
  limit: 50
});

// Filter by status
const pending = connections.filter(c => c.status === 'pending');
const friends = connections.filter(c => c.status === 'approved');
const blocked = connections.filter(c => c.status === 'blocked');

// Each connection has: dbRootId, connectionPda, partyA, partyB, status, requester, blocker, timestamp
```

---

## User Profile

An on-chain profile account (UserState PDA) for a user, storing profile info, upload counts, and friend request records. Created automatically on first `codeIn()` call.

### Read Profile

```typescript
import iqlabs from '@iqlabs-official/solana-sdk';

// readUserState(userPubkey: string)
// returns { owner, metadata, totalSessionFiles: bigint, profileData?: string }
const userState = await iqlabs.reader.readUserState(walletAddress);
console.log('Owner:', userState.owner);
console.log('Session files:', userState.totalSessionFiles);
console.log('Profile data:', userState.profileData);
```

### List Uploaded Files

```typescript
import iqlabs from '@iqlabs-official/solana-sdk';

// fetchInventoryTransactions(publicKey, limit, before?)
// returns Array<{ signature, onChainPath, metadata, ... }>
const myFiles = await iqlabs.reader.fetchInventoryTransactions(keypair.publicKey, 20);
myFiles.forEach(tx => {
  console.log(`Signature: ${tx.signature}, Path: ${tx.onChainPath}`);
});
```

---

## Utilities

### Transfer SOL

```typescript
import { SystemProgram, Transaction } from "@solana/web3.js";

const ix = SystemProgram.transfer({
  fromPubkey: keypair.publicKey,
  toPubkey: new PublicKey(recipient),
  lamports: amount * 1e9
});
const tx = new Transaction().add(ix);
await connection.sendTransaction(tx, [keypair]);
```

### Get Balance

```typescript
const balance = await connection.getBalance(keypair.publicKey);
console.log("Balance:", balance / 1e9, "SOL");
```

---

## IQ Gateway

Read on-chain data via HTTP:

```
GET https://gateway.iqlabs.dev/img/{txSignature}.png
```

Returns raw data regardless of content type.

---

## Environment Settings

```typescript
import iqlabs from '@iqlabs-official/solana-sdk';

// Set a custom RPC URL (used globally by SDK functions like readConnection)
iqlabs.setRpcUrl('https://your-rpc.example.com');
```

---

## Security

- Never share your keypair
- Never commit keypair files to git
- All operations run on mainnet

---

## Links

- SDK: `npm i @iqlabs-official/solana-sdk`
- npm: https://www.npmjs.com/package/@iqlabs-official/solana-sdk
- Docs: https://iqlabs.mintlify.app/docs-typescript
- Docs (LLM-friendly): https://iqlabs.mintlify.app/docs-typescript.md
- Gateway: https://gateway.iqlabs.dev
- GitHub: https://github.com/IQCoreTeam/IQSdkUsageExampleCliTool
- Explorer: https://explorer.solana.com/
---
name: iqlabs-python-sdk
version: 1.0.0
description: On-chain database and storage SDK for Solana (Python) - permanent, decentralized data
metadata: {"openclaw":{"emoji":"🐍","category":"infrastructure"}}
---

# IQLabs Python SDK

Build on-chain applications with permanent, decentralized data storage on Solana.

> **Everything is on-chain.** No servers, no databases - just Solana transactions. All SDK functions are async.
>
> Using TypeScript/Node.js? See `fetch_skill("iqlabs-sdk")` for the TypeScript SDK.

## Installation

```bash
pip install iqlabs-solana-sdk
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

```python
import asyncio
from solana.rpc.async_api import AsyncClient
from solders.keypair import Keypair
from iqlabs import set_rpc_url

set_rpc_url("https://api.mainnet-beta.solana.com")
connection = AsyncClient("https://api.mainnet-beta.solana.com")

# Load keypair from file
import json
with open("keypair.json") as f:
    secret = json.load(f)
keypair = Keypair.from_bytes(bytes(secret))

print("Wallet:", str(keypair.pubkey()))
```

---

## Database Operations

### Write Row

Write a JSON object to a table. Tables auto-create on first write.
String seeds (like `'my-app'`) are automatically hashed with keccak_256 internally.

```python
from iqlabs import writer
import json

row = {
    "id": "user_001",
    "name": "Alice",
    "bio": "Building on-chain",
    "created_at": "2024-01-01T00:00:00Z"
}

# write_row(connection, signer, db_root_id, table_seed, row_json, skip_confirmation?)
signature = await writer.write_row(
    connection,
    keypair,
    'my-app',    # db_root_id (string -> auto keccak_256 hashed)
    'users',     # table_seed (string -> auto keccak_256 hashed)
    json.dumps(row)
)

print("Written:", signature)
```

### Read Table

```python
from iqlabs import reader

# read_table_rows(account, before?, limit?, speed?)
# account: table PDA (Pubkey or str)
# speed: 'light' | 'medium' | 'heavy' | 'extreme'
rows = await reader.read_table_rows(table_pda, limit=100)

for row in rows:
    print(row["id"], row["name"])

# Cursor-based pagination
older_rows = await reader.read_table_rows(table_pda, limit=50, before="sig...")
```

### Update Row

```python
from iqlabs import writer
import json

# manage_row_data(connection, signer, db_root_id, seed, row_json, table_name?, target_tx?)
sig = await writer.manage_row_data(
    connection,
    keypair,
    'my-app',          # db_root_id
    'users',           # seed (table seed or connection seed)
    json.dumps({"id": "user_001", "name": "Alice", "bio": "Updated bio!"}),
    table_name='users',           # required for table updates
    target_tx=original_tx_sig     # target tx signature to update
)
```

### List Tables

```python
from iqlabs import reader

# get_tablelist_from_root(connection, db_root_id)
# returns dict with root_pda, creator, table_seeds, global_table_seeds
result = await reader.get_tablelist_from_root(connection, 'my-app')
print('Creator:', result['creator'])
print('Tables:', result['table_seeds'])
```

---

## File Storage (CodeIn)

Upload and read raw data on-chain. The SDK auto-picks the optimal method based on size:
- **< 850 bytes**: stored immediately (fastest)
- **< 8.5 KB**: split into multiple transactions
- **>= 8.5 KB**: uploaded in parallel for speed

### Upload File

```python
from iqlabs import writer

# code_in(connection, signer, chunks, filename?, method?, filetype?, on_progress?)
# chunks: list[str]
tx_id = await writer.code_in(
    connection,
    keypair,
    ['Hello, blockchain!'],
)

print("Uploaded:", tx_id)
# View at: https://gateway.iqlabs.dev/img/{tx_id}.png
```

### Upload with Filename

```python
from iqlabs import writer

tx_id = await writer.code_in(
    connection,
    keypair,
    ['file contents here'],
    filename='hello.txt',
)
```

### Read File

```python
from iqlabs import reader

# read_code_in(tx_signature, speed?, on_progress?) -> dict with 'metadata' and 'data'
result = await reader.read_code_in(tx_id)
print(result['data'])      # 'Hello, blockchain!'
print(result['metadata'])  # JSON string with file metadata
```

---

## Social Features (Connections)

Enable DMs and social features between wallets.

### Request Connection

```python
from iqlabs import writer

party_b = "RecipientPublicKeyBase58"

# request_connection(connection, signer, db_root_id, party_a, party_b, table_name, columns, id_col, ext_keys)
sig = await writer.request_connection(
    connection,
    keypair,
    'my-app',
    str(keypair.pubkey()),            # party_a (you)
    party_b,                          # party_b (recipient)
    'dm-table',                       # table_name
    ['id', 'content', 'timestamp'],   # columns
    'id',                             # id_col
    []                                # ext_keys
)
```

### Manage Connection (Approve/Block)

There is no high-level SDK wrapper for this. Use the contract-level instruction builder directly.

```python
from iqlabs import contract

builder = contract.create_instruction_builder(contract.get_program_id())

# Approve a friend request
approve_ix = contract.manage_connection_instruction(
    builder,
    {"db_root": db_root, "connection_table": connection_table, "signer": my_pubkey},
    {"db_root_id": db_root_id, "connection_seed": connection_seed, "new_status": contract.CONNECTION_STATUS_APPROVED}
)

# Block a user
block_ix = contract.manage_connection_instruction(
    builder,
    {"db_root": db_root, "connection_table": connection_table, "signer": my_pubkey},
    {"db_root_id": db_root_id, "connection_seed": connection_seed, "new_status": contract.CONNECTION_STATUS_BLOCKED}
)
```

### Check Connection Status

```python
from iqlabs import reader

# read_connection(db_root_id, party_a, party_b)
# returns dict with 'status', 'requester', 'blocker'
conn_info = await reader.read_connection(
    'my-app',
    str(keypair.pubkey()),
    party_b
)
print(conn_info['status'])  # 'pending' | 'approved' | 'blocked'
```

### Send DM

```python
from iqlabs import writer
from iqlabs.sdk.utils.seed import derive_dm_seed
import json

# derive_dm_seed(user_a, user_b) -> bytes (deterministic, order-independent)
connection_seed = derive_dm_seed(
    str(keypair.pubkey()),
    party_b
)

# write_connection_row(connection, signer, db_root_id, connection_seed, row_json)
sig = await writer.write_connection_row(
    connection,
    keypair,
    'my-app',
    connection_seed,
    json.dumps({"message_id": "123", "message": "Hey!", "timestamp": 1234567890})
)
```

### Fetch All Connections

Fetch all connections (friend requests) for a user. Each connection includes its `db_root_id`, identifying which app the connection belongs to.

```python
from iqlabs import reader

# fetch_user_connections(user_pubkey, limit?, before?, speed?)
# speed: 'light' (default) | 'medium' | 'heavy' | 'extreme'
# returns list of dicts with db_root_id, connection_pda, party_a, party_b, status, requester, blocker, timestamp
connections = await reader.fetch_user_connections(
    keypair.pubkey(),
    speed='light',
    limit=50
)

# Filter by status
pending = [c for c in connections if c['status'] == 'pending']
friends = [c for c in connections if c['status'] == 'approved']
blocked = [c for c in connections if c['status'] == 'blocked']
```

---

## User Profile

An on-chain profile account (UserState PDA) for a user, storing profile info, upload counts, and friend request records. Created automatically on first `code_in()` call.

### Read Profile

```python
from iqlabs import reader

# read_user_state(user_pubkey: str)
# returns dict with owner, metadata, total_session_files, profile_data
user_state = await reader.read_user_state(wallet_address)
print('Owner:', user_state['owner'])
print('Session files:', user_state['total_session_files'])
print('Profile data:', user_state['profile_data'])
```

### List Uploaded Files

```python
from iqlabs import reader
import json

# fetch_inventory_transactions(public_key, limit, before?)
# returns list of dicts with signature, on_chain_path, metadata, ...
my_files = await reader.fetch_inventory_transactions(keypair.pubkey(), 20)
for tx in my_files:
    print(f"Signature: {tx['signature']}, Path: {tx['on_chain_path']}")
```

---

## Utilities

### Transfer SOL

```python
from solders.system_program import TransferParams, transfer
from solders.transaction import Transaction
from solders.message import Message

ix = transfer(TransferParams(
    from_pubkey=keypair.pubkey(),
    to_pubkey=recipient_pubkey,
    lamports=int(amount * 1e9)
))
msg = Message.new_with_blockhash([ix], keypair.pubkey(), recent_blockhash)
tx = Transaction.new_unsigned(msg)
tx.sign([keypair], recent_blockhash)
await connection.send_transaction(tx)
```

### Get Balance

```python
balance = await connection.get_balance(keypair.pubkey())
print("Balance:", balance.value / 1e9, "SOL")
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

```python
from iqlabs import set_rpc_url

# Set a custom RPC URL (used globally by SDK functions like read_connection)
set_rpc_url('https://your-rpc.example.com')
```

---

## Security

- Never share your keypair
- Never commit keypair files to git
- All operations run on mainnet

---

## Links

- SDK: `pip install iqlabs-solana-sdk`
- PyPI: https://pypi.org/project/iqlabs-solana-sdk/
- Docs: https://iqlabs.mintlify.app/docs-python
- Docs (LLM-friendly): https://iqlabs.mintlify.app/docs-python.md
- Gateway: https://gateway.iqlabs.dev
- GitHub: https://github.com/IQCoreTeam/iqlabs-solana-sdk-python
- Explorer: https://explorer.solana.com/
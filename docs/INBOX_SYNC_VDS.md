# Atlas Inbox Sync on a VDS

Status: protocol foundation, network disabled by default.

## First delivery boundary

The first synchronization increment transfers only immutable `inbox.capture`
operations. It does not synchronize or replace the full `atlas_v2_data` JSON.
Domains, projects, tasks, imports, deletes, and layout settings remain local.

This boundary lets Android Capture deliver new entries to Studio without
introducing last-write-wins replacement of a user's complete Atlas.

## Data flow

```text
Android localStorage
  -> pending inbox.capture operations
  -> HTTPS batch push
  -> Atlas Sync API on the VDS
  -> monotonically sequenced Inbox records
  -> HTTPS cursor pull
  -> Desktop Inbox merge by item ID
```

Local capture always completes before a network attempt. A failed request must
leave the operation `pending`. The client may retry the same operation any
number of times. The server must enforce uniqueness by operation ID and Inbox
item ID so retries are idempotent.

The local sync cycle applies acknowledgements and pulled items only after both
network calls finish. If durable local persistence then fails, it restores the
previous operation statuses and Inbox contents in place. A later retry is safe
because the server sees the same operation ID.

## Protocol v1

Push batches contain:

```json
{
  "protocol": 1,
  "deviceId": "phone-device-id",
  "operations": [
    {
      "operationId": "op-uuid",
      "deviceId": "phone-device-id",
      "timestamp": 1786400000000,
      "item": {
        "id": "inbox-uuid",
        "text": "Capture text",
        "rawText": "Capture text",
        "inputType": "text",
        "source": "mobile-capture",
        "status": "new",
        "userHint": "thought",
        "deviceId": "phone-device-id",
        "createdAt": 1786400000000,
        "updatedAt": 1786400000000
      }
    }
  ]
}
```

Pull responses contain records with a decimal string `sequence`. Clients store
the last observed sequence and request records after that cursor. Server
sequence, not a device clock, defines pull order.

If the same item ID arrives with identical data it is a duplicate. If the ID is
the same but content differs, the client records a conflict and does not
overwrite the local item.

## VDS isolation requirements

- Atlas Sync uses its own directory, service identity, secrets, database, and
  database user.
- ChildWatch containers, files, environment variables, and database objects are
  not reused except for an existing PostgreSQL server after an explicit audit.
- PostgreSQL is never exposed to the public network.
- Only the reverse proxy accepts public traffic, using HTTPS.
- API logs contain request IDs and status codes, never capture text or tokens.
- Device credentials are stored as hashes on the server and are individually
  revocable.
- Database backups are copied outside the VDS and restore is tested.

## Deliberately deferred

- automatic network calls and endpoint configuration;
- device pairing and token issuance;
- server storage implementation;
- remote delete/status updates;
- task, project, domain, and full-state synchronization;
- background Android synchronization;
- automatic conflict resolution.

Those pieces are enabled only after the VDS audit and after the local protocol
tests pass on both Studio and the Android bundle.

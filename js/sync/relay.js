// js/sync/relay.js — dev/local relay transport for Sync v1.
//
// This is a TEST/DEV transport, not a production Sync backend. It orders
// pushed operations with a globally monotonic serverSequence and serves pulls
// by cursor, which is exactly the protocol the sync engine needs to prove the
// Inbox vertical slice with two local clients. There is no internet transport
// here, no accounts and no encryption — those belong to a later stage.
//
// Two clients share one relay instance (e.g. two engines in one page, or two
// tabs of the same browser profile through the default localStorage store).

const DEFAULT_KEY = 'atlas-sync-relay-v1';

function defaultStorage(key){
  return {
    get(){
      try {
        const raw = globalThis.localStorage?.getItem(key);
        return raw ? JSON.parse(raw) : { ops: [], nextSeq: 1 };
      } catch (_) {
        return { ops: [], nextSeq: 1 };
      }
    },
    set(data){
      try {
        globalThis.localStorage?.setItem(key, JSON.stringify(data));
      } catch (_) {}
    },
  };
}

export function createLocalRelay(options = {}){
  const store = options.storage || defaultStorage(options.key || DEFAULT_KEY);

  return {
    // pushOperations: dedupe by operationId, assign a global serverSequence,
    // ack immediately (the relay is the durable server in the dev slice).
    async pushOperations(ops){
      const data = store.get();
      const ackedIds = [];
      for (const op of ops) {
        if (data.ops.some(entry => entry.operation.id === op.id)) {
          ackedIds.push(op.id);
          continue;
        }
        data.ops.push({ serverSequence: data.nextSeq++, operation: op });
        ackedIds.push(op.id);
      }
      store.set(data);
      return { ackedIds };
    },

    // pullOperations(cursor): return everything after the cursor, in order.
    // A device never pulls its own operations back (opts.excludeDeviceId).
    async pullOperations(cursor = 0, opts = {}){
      const data = store.get();
      const exclude = opts?.excludeDeviceId;
      const operations = data.ops
        .filter(entry =>
          entry.serverSequence > cursor &&
          (!exclude || entry.operation.deviceId !== exclude)
        )
        .sort((a, b) => a.serverSequence - b.serverSequence);
      const newCursor = operations.length
        ? operations[operations.length - 1].serverSequence
        : cursor;
      return { operations, newCursor };
    },

    // acknowledge: the relay already acks on push; kept for transport-interface parity.
    async acknowledge(){
      return;
    },
  };
}

// The transport contract implemented by createLocalRelay (and any future
// remote transport):
//
//   pushOperations(ops): Promise<{ ackedIds: string[] }>
//   pullOperations(cursor): Promise<{ operations: [{serverSequence, operation}], newCursor }>
//   acknowledge(opIds): Promise<void>
export const SYNC_TRANSPORT_CONTRACT = {
  pushOperations: 'ops[] -> { ackedIds }',
  pullOperations: 'cursor -> { operations, newCursor }',
  acknowledge: 'opIds[] -> void',
};

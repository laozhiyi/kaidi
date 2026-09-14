'use strict';
// An optimistic, per-document transaction simulator. It intentionally lets
// independent callbacks overlap instead of serializing them behind one queue.
function concurrentTransactions(fixture, options = {}) {
  const metrics = { active: 0, maxActive: 0, conflicts: 0, commits: 0, attempts: 0, aborted: 0 };
  const clone = value => value == null ? value : structuredClone(value);
  const plainGet = fixture.store.get;
  const plainSet = fixture.store.set;
  fixture.store.get = async (tx, name, id) => tx && tx.readDocument ? tx.readDocument(name, id) : plainGet(tx, name, id);
  fixture.store.set = async (tx, name, id, row) => tx && tx.writeDocument ? tx.writeDocument(name, id, row) : plainSet(tx, name, id, row);
  async function attemptTransaction(callback) {
      const reads = new Map(), writes = new Map();
      const key = (name, id) => name + ':' + id;
      const tx = {
        readDocument(name, id) {
          const token = key(name, id);
          if (!reads.has(token)) {
            const row = clone(fixture.table(name).get(id) || null);
            reads.set(token, { name, id, row, fingerprint: JSON.stringify(row) });
          }
          return clone(writes.has(token) ? writes.get(token).row : reads.get(token).row);
        },
        writeDocument(name, id, row) {
          tx.readDocument(name, id);
          writes.set(key(name, id), { name, id, row: { ...clone(row), _id: id } });
        },
        collection(name) {
          name = name.replace(/^bx_/, '');
          return { doc: id => ({ get: async () => ({ data: tx.readDocument(name, id) }), set: async ({ data }) => tx.writeDocument(name, id, data) }) };
        }
      };
      metrics.active++;
      metrics.attempts++;
      metrics.maxActive = Math.max(metrics.active, metrics.maxActive);
      try {
        const result = await callback(tx);
        // Optional synthetic commit latency keeps transactions overlapped. It
        // exercises conflict handling; it is not a Tencent Cloud latency model.
        if (options.commitDelayMs) await new Promise(resolve => setTimeout(resolve, options.commitDelayMs));
        const conflict = [...reads.values()].some(read => JSON.stringify(fixture.table(read.name).get(read.id) || null) !== read.fingerprint);
        if (conflict) {
          metrics.conflicts++;
          throw Object.assign(new Error('simulated transaction conflict'), { code: 'DATABASE_TRANSACTION_CONFLICT' });
        }
        for (const write of writes.values()) fixture.table(write.name).set(write.id, write.row);
        metrics.commits++;
        return result;
      } catch (error) {
        if (!error || error.code !== 'DATABASE_TRANSACTION_CONFLICT') metrics.aborted++;
        throw error;
      } finally { metrics.active--; }
  }
  if (options.productionRetries) {
    fixture.store.database().runTransaction = (callback, retryCount) => {
      if (retryCount !== 0) throw Error('SDK retry count must stay disabled');
      return attemptTransaction(callback);
    };
    // Use the actual five-attempt retry/backoff implementation, not a more
    // permissive simulator retry policy, for publish-pressure verification.
    fixture.store.transaction = fixture.load('operation_store.js').transaction;
  } else {
    fixture.store.transaction = async callback => {
      for (let attempt = 0; ; attempt++) {
        try { return await attemptTransaction(callback); }
        catch (error) {
          if (!error || error.code !== 'DATABASE_TRANSACTION_CONFLICT' || attempt >= 9) throw error;
        }
      }
    };
  }
  fixture.store.limit = (pid, identity, action, max, windowMs) => fixture.store.transaction(tx => fixture.store.limitInTransaction(tx, pid, identity, action, max, windowMs));
  return metrics;
}
module.exports = { concurrentTransactions };

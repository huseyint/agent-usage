import test from "node:test";
import assert from "node:assert/strict";
import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query";
import { sessionQueryOptions } from "../src/lib/session-query.ts";
import { defaultQuery } from "../src/lib/usage-types.ts";

function observe(t, fetchView, changes = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const query = { ...defaultQuery, limit: 2, ...changes };
  const observer = new InfiniteQueryObserver(
    client,
    sessionQueryOptions(query, fetchView),
  );
  const unsubscribe = observer.subscribe(() => {});
  t.after(() => {
    unsubscribe();
    client.clear();
  });
  return { observer, query };
}

function page(keys, sessionCount) {
  return {
    sessions: keys.map((key) => ({ key })),
    sessionCount,
    groupTotals: { today: [sessionCount, 1000] },
  };
}

test("appends batches, retains full group totals, and stops at the last session", async (t) => {
  const offsets = [];
  const { observer } = observe(t, async ({ offset, limit }) => {
    offsets.push(offset);
    return page(["a", "b", "c", "d", "e"].slice(offset, offset + limit), 5);
  });
  await observer.refetch();
  await observer.fetchNextPage();
  const result = await observer.fetchNextPage();
  assert.deepEqual(
    result.data.sessions.map((s) => s.key),
    ["a", "b", "c", "d", "e"],
  );
  assert.deepEqual(result.data.groupTotals, { today: [5, 1000] });
  assert.equal(result.hasNextPage, false);
  await observer.fetchNextPage();
  assert.deepEqual(offsets, [0, 2, 4]);
});

test("an empty batch stops further requests even if the reported total is larger", async (t) => {
  const { observer } = observe(t, async () => page([], 10));
  const result = await observer.refetch();
  assert.deepEqual(result.data.sessions, []);
  assert.equal(result.hasNextPage, false);
});

test("a failed batch keeps loaded rows and can retry the same offset", async (t) => {
  let fail = true;
  const offsets = [];
  const { observer } = observe(t, async ({ offset }) => {
    offsets.push(offset);
    if (offset && fail) throw new Error("Unavailable");
    return page(offset ? ["c"] : ["a", "b"], 3);
  });
  await observer.refetch();
  const failed = await observer.fetchNextPage();
  assert.equal(failed.isFetchNextPageError, true);
  assert.deepEqual(
    failed.data.sessions.map((s) => s.key),
    ["a", "b"],
  );
  fail = false;
  const retried = await observer.fetchNextPage();
  assert.deepEqual(
    retried.data.sessions.map((s) => s.key),
    ["a", "b", "c"],
  );
  assert.equal(retried.hasNextPage, false);
  assert.deepEqual(offsets, [0, 2, 2]);
});

test("refresh rebuilds loaded batches and removes sessions that no longer match", async (t) => {
  let keys = ["a", "b", "c", "d"];
  const { observer } = observe(t, async ({ offset, limit }) =>
    page(keys.slice(offset, offset + limit), keys.length),
  );
  await observer.refetch();
  await observer.fetchNextPage();
  keys = ["b"];
  const result = await observer.refetch();
  assert.deepEqual(
    result.data.sessions.map((s) => s.key),
    ["b"],
  );
  assert.equal(result.hasNextPage, false);
});

test("changing filters starts at zero and isolates an in-flight previous batch", async (t) => {
  let resolveOldBatch;
  const { observer, query } = observe(t, async ({ offset }) =>
    offset
      ? new Promise((resolve) => {
          resolveOldBatch = resolve;
        })
      : page(["a", "b"], 3),
  );
  await observer.refetch();
  const pending = observer.fetchNextPage();
  observer.setOptions(
    sessionQueryOptions({ ...query, search: "new" }, async ({ offset }) => {
      assert.equal(offset, 0);
      return page(["new"], 1);
    }),
  );
  assert.equal(observer.getCurrentResult().data, undefined);
  await observer.refetch();
  resolveOldBatch(page(["c"], 3));
  await pending;
  assert.deepEqual(
    observer.getCurrentResult().data.sessions.map((s) => s.key),
    ["new"],
  );
});

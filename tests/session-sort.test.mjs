import test from "node:test";
import assert from "node:assert/strict";
import {
  sessionColumnSort,
  sessionGroupsDescending,
} from "../src/lib/session-sort.ts";

test("clicking the active column reverses its order", () => {
  for (const column of [
    "last",
    "name",
    "provider",
    "project",
    "tokens",
    "cost",
    "periodCost",
  ]) {
    for (const descending of [false, true]) {
      const query = { sort: column, descending, groupBy: "none" };
      const reversed = sessionColumnSort(query, column);
      assert.equal(reversed.sort, column);
      assert.equal(reversed.descending, !descending);
      assert.deepEqual(sessionColumnSort(reversed, column), query);
    }
  }
});

test("switching columns uses alphabetical, newest, or largest first defaults", () => {
  for (const descending of [false, true]) {
    for (const column of [
      "last",
      "name",
      "provider",
      "project",
      "tokens",
      "cost",
      "periodCost",
    ]) {
      const next = sessionColumnSort(
        { sort: "first", descending, groupBy: "day" },
        column,
      );
      assert.equal(next.sort, column);
      assert.equal(
        next.descending,
        ["last", "tokens", "cost", "periodCost"].includes(column),
      );
      assert.equal(
        next.groupBy,
        ["tokens", "cost", "periodCost"].includes(column) ? "none" : "day",
      );
    }
  }
});

test("last activity reverses date groups together with their sessions", () => {
  for (const groupBy of ["day", "week", "month"]) {
    for (const descending of [false, true]) {
      assert.equal(
        sessionGroupsDescending({
          sort: "last",
          groupBy,
          descending,
          descendingGroups: !descending,
        }),
        descending,
      );
    }
  }
});

test("other sorts and non-date groups retain their own group direction", () => {
  for (const [sort, groupBy] of [
    ["name", "day"],
    ["first", "week"],
    ["cost", "month"],
    ["last", "project"],
    ["last", "provider"],
    ["last", "none"],
  ]) {
    for (const descendingGroups of [false, true]) {
      assert.equal(
        sessionGroupsDescending({
          sort,
          groupBy,
          descending: !descendingGroups,
          descendingGroups,
        }),
        descendingGroups,
      );
    }
  }
});

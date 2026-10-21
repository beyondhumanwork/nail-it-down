/**
 * Reading and writing the record through a minimal key/value store.
 *
 * The store interface is the only thing the host adapter has to satisfy, which is what keeps the
 * M0 write-failure check testable: a fake store that rejects `set` proves the mod never claims
 * success on a failed write.
 *
 * Writes are always awaited. The installed host's `store.set` updates its in-memory map *before*
 * awaiting the disk write, so a later `get` says nothing about whether the file was written —
 * the resolved promise is the only honest success signal.
 */

import { readStoredRecord } from './record.ts';
import type { ReadResult, SessionRecord } from './record.ts';

export type KeyValueStore = {
  get(key: string): unknown;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
};

/** Per-mod storage shared by every workspace, so the workspace is part of the key. */
export function storeKeyFor(workspace: string): string {
  return `session.v1:${workspace}`;
}

export function readRecord(store: KeyValueStore, workspace: string): ReadResult {
  return readStoredRecord(store.get(storeKeyFor(workspace)));
}

/** Resolves only after the host confirms the write; rejects when the host fails to save. */
export async function writeRecord(store: KeyValueStore, record: SessionRecord): Promise<void> {
  await store.set(storeKeyFor(record.workspace), record);
}

/** Removes this workspace's record. Used only to roll back a write the host rejected. */
export async function removeRecord(store: KeyValueStore, workspace: string): Promise<void> {
  await store.delete(storeKeyFor(workspace));
}

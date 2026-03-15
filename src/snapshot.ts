/**
 * Snapshot read/write for regression tracking.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import type { Article, Snapshot } from "./types.js";

const CACHE_DIR = join(import.meta.dir, "..", "cache");

function snapshotPath(feedName: string): string {
  return join(CACHE_DIR, `${feedName}.json`);
}

export function loadSnapshot(feedName: string): Snapshot | null {
  const path = snapshotPath(feedName);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Snapshot;
  } catch {
    return null;
  }
}

export function saveSnapshot(feedName: string, articles: Article[]): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  const snapshot: Snapshot = {
    lastSuccess: new Date().toISOString(),
    articleCount: articles.length,
    knownLinks: articles.map((a) => a.link),
    consecutiveErrors: 0,
  };
  writeFileSync(snapshotPath(feedName), JSON.stringify(snapshot, null, 2));
}

export function recordError(feedName: string, error: string): void {
  const existing = loadSnapshot(feedName);
  const snapshot: Snapshot = existing || {
    lastSuccess: "",
    articleCount: 0,
    knownLinks: [],
    consecutiveErrors: 0,
  };
  snapshot.consecutiveErrors++;
  snapshot.lastError = error;
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(snapshotPath(feedName), JSON.stringify(snapshot, null, 2));
}

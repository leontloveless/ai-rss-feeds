import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true }); });

function publish(result: string, verified = "true", failMerge = false, mergeState = "MERGED") {
  const dir = mkdtempSync(join(tmpdir(), "feed-publication-"));
  dirs.push(dir);
  const calls = join(dir, "calls.jsonl");
  const output = join(dir, "output");
  writeFileSync(join(dir, "gh"), `#!${process.execPath}
import { appendFileSync } from "fs";
const args = process.argv.slice(2);
appendFileSync(process.env.GH_CALLS, JSON.stringify(args) + "\\n");
if (args[1] === "create") console.log("https://github.com/example/feeds/pull/1");
if (args[1] === "merge" && process.env.FAIL_MERGE === "true") process.exit(1);
if (args[1] === "view") console.log(args.includes("mergeable") ? "MERGEABLE" : process.env.MERGE_STATE);
`, { mode: 0o755 });
  const execution = Bun.spawnSync(["bash", join(import.meta.dir, "../.github/scripts/publish-feed-pr.sh")], {
    env: {
      ...process.env, PATH: `${dir}:${process.env.PATH}`, GH_CALLS: calls,
      FAIL_MERGE: String(failMerge), RESULT: result, VERIFIED: verified,
      MERGE_STATE: mergeState,
      GITHUB_REPOSITORY: "example/feeds", GITHUB_OUTPUT: output,
      BRANCH: "feed/issue-1", CONFIG_NAME: "example", ISSUE_NUMBER: "1",
      SOURCE_URL: "https://example.com/news/", HEAD_SHA: "a".repeat(40),
    }, stdout: "pipe", stderr: "pipe",
  });
  const read = (path: string) => { try { return readFileSync(path, "utf8"); } catch { return ""; } };
  return {
    exitCode: execution.exitCode,
    calls: read(calls).trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as string[]),
    output: read(output),
  };
}

test("verified native RSS is published without a draft or human merge", () => {
  const result = publish("new_native");
  expect(result.exitCode).toBe(0);
  expect(result.calls).toHaveLength(4);
  expect(result.calls[0].slice(0, 2)).toEqual(["pr", "create"]);
  expect(result.calls[0]).not.toContain("--draft");
  expect(result.calls.find(args => args[1] === "merge")).toEqual([
    "pr", "merge", "https://github.com/example/feeds/pull/1", "--repo", "example/feeds",
    "--merge", "--match-head-commit", "a".repeat(40),
  ]);
  expect(result.output).toContain("published=true");
});

test("generated feeds remain drafts and are never automatically merged", () => {
  const result = publish("new_generated");
  expect(result.exitCode).toBe(0);
  expect(result.calls).toHaveLength(1);
  expect(result.calls[0]).toContain("--draft");
  expect(result.output).toContain("published=false");
});

test("unverified or fallback results cannot create or merge PRs", () => {
  for (const result of [publish("new_native", "false"), publish("agentic_fallback")]) {
    expect(result.exitCode).not.toBe(0);
    expect(result.calls).toEqual([]);
    expect(result.output).not.toContain("published=true");
  }
});

test("a blocked merge fails without claiming publication", () => {
  const result = publish("new_native", "true", true);
  expect(result.exitCode).not.toBe(0);
  expect(result.output).toContain("url=https://github.com/example/feeds/pull/1");
  expect(result.output).not.toContain("published=true");
});

test("a queued but unmerged PR is not reported as published", () => {
  const result = publish("new_native", "true", false, "OPEN");
  expect(result.exitCode).not.toBe(0);
  expect(result.output).not.toContain("published=true");
});

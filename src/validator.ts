/**
 * 6-layer validation for parsed articles and generated RSS.
 */

import RSSParser from "rss-parser";
import { isReachable } from "./fetcher.js";
import type { Article, Snapshot, ValidationResult } from "./types.js";

const MAX_TITLE_LENGTH = 500;
const HTML_TAG_RE = /<[^>]+>/;
const YEAR_MIN = 2000;

function isValidUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Layer 1: Structural validation
 */
function validateStructure(articles: Article[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (articles.length < 1) {
    errors.push("No articles found");
    return { valid: false, errors, warnings };
  }

  for (let i = 0; i < articles.length; i++) {
    const a = articles[i];
    const prefix = `Article[${i}]`;

    // Title checks
    if (!a.title || a.title.trim().length === 0) {
      errors.push(`${prefix}: empty title`);
    } else if (a.title.length > MAX_TITLE_LENGTH) {
      errors.push(`${prefix}: title too long (${a.title.length} chars)`);
    } else if (HTML_TAG_RE.test(a.title)) {
      warnings.push(`${prefix}: title contains HTML tags`);
    }

    // Link checks
    if (!a.link) {
      errors.push(`${prefix}: missing link`);
    } else if (!isValidUrl(a.link)) {
      errors.push(`${prefix}: invalid URL "${a.link}"`);
    } else if (!a.link.startsWith("http")) {
      errors.push(`${prefix}: link is not absolute "${a.link}"`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Layer 2: Deduplication
 */
function validateUnique(articles: Article[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const a of articles) {
    if (seen.has(a.link)) {
      errors.push(`Duplicate link: ${a.link}`);
    }
    seen.add(a.link);
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Layer 3: Date validation (if dates present)
 */
function validateDates(articles: Article[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minDate = new Date(`${YEAR_MIN}-01-01`);

  const dated = articles.filter((a) => a.date != null);
  if (dated.length === 0) {
    warnings.push("No articles have dates");
    return { valid: true, errors, warnings };
  }

  for (let i = 0; i < dated.length; i++) {
    const d = dated[i].date!;
    if (isNaN(d.getTime())) {
      errors.push(`Article[${i}]: unparseable date`);
    } else if (d < minDate) {
      warnings.push(`Article[${i}]: date before ${YEAR_MIN}`);
    } else if (d > tomorrow) {
      warnings.push(`Article[${i}]: date in the future`);
    }
  }

  // Check order: newest first
  for (let i = 1; i < dated.length; i++) {
    if (dated[i].date! > dated[i - 1].date!) {
      warnings.push("Articles are not in newest-first order");
      break;
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Layer 4: Link reachability (spot-check first 3)
 */
async function validateLinks(articles: Article[]): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const toCheck = articles.slice(0, 3);
  let failures = 0;

  for (const a of toCheck) {
    const ok = await isReachable(a.link);
    if (!ok) {
      failures++;
      warnings.push(`Unreachable: ${a.link}`);
    }
  }

  // Allow at most 1 failure out of 3
  if (failures > 1) {
    errors.push(`${failures}/${toCheck.length} links unreachable`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Layer 5: XML validation — parse the generated RSS with rss-parser
 */
async function validateXML(xml: string): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    const parser = new RSSParser();
    const result = await parser.parseString(xml);

    if (!result.items || result.items.length === 0) {
      errors.push("RSS XML has no items");
    }
    if (!result.title) {
      warnings.push("RSS XML missing feed title");
    }
  } catch (err) {
    errors.push(`RSS XML parse failed: ${(err as Error).message}`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Layer 6: Regression check against snapshot
 */
function validateRegression(
  articles: Article[],
  snapshot: Snapshot | null
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!snapshot) {
    return { valid: true, errors, warnings: ["No snapshot for regression check"] };
  }

  // Article count variance
  if (snapshot.articleCount > 0) {
    const ratio = articles.length / snapshot.articleCount;
    if (ratio < 0.5) {
      warnings.push(
        `Article count dropped significantly: ${snapshot.articleCount} → ${articles.length}`
      );
    } else if (ratio > 1.5) {
      warnings.push(
        `Article count increased significantly: ${snapshot.articleCount} → ${articles.length}`
      );
    }
  }

  // Check if known articles disappeared
  if (snapshot.knownLinks.length > 0) {
    const currentLinks = new Set(articles.map((a) => a.link));
    const missing = snapshot.knownLinks.filter((l) => !currentLinks.has(l));
    const missingRatio = missing.length / snapshot.knownLinks.length;
    if (missingRatio > 0.3) {
      warnings.push(
        `${missing.length}/${snapshot.knownLinks.length} known articles disappeared (${(missingRatio * 100).toFixed(0)}%)`
      );
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Merge multiple ValidationResults.
 */
function merge(...results: ValidationResult[]): ValidationResult {
  return {
    valid: results.every((r) => r.valid),
    errors: results.flatMap((r) => r.errors),
    warnings: results.flatMap((r) => r.warnings),
  };
}

/**
 * Run all 6 validation layers.
 */
export async function validate(
  articles: Article[],
  xml: string,
  snapshot: Snapshot | null
): Promise<ValidationResult> {
  const structural = validateStructure(articles);
  if (!structural.valid) return structural; // bail early

  const unique = validateUnique(articles);
  const dates = validateDates(articles);
  const links = await validateLinks(articles);
  const xmlResult = await validateXML(xml);
  const regression = validateRegression(articles, snapshot);

  return merge(structural, unique, dates, links, xmlResult, regression);
}

/**
 * Run quick validation (layers 1-3 only, no network).
 */
export function validateQuick(articles: Article[]): ValidationResult {
  const structural = validateStructure(articles);
  if (!structural.valid) return structural;
  const unique = validateUnique(articles);
  const dates = validateDates(articles);
  return merge(structural, unique, dates);
}

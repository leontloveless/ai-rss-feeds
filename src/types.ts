export interface FeedConfig {
  name: string;
  url: string;
  feed: {
    title: string;
    description: string;
    language: string;
    author?: string;
  };
  selectors: {
    articleList: string;
    title: string;
    date?: string;
    description?: string;
    link: {
      source: string; // "attr:href" | "text"
      prefix?: string;
    };
  };
  dateFormat?: string;
  createdAt: string;
  lastHealed?: string;
}

export interface Snapshot {
  lastSuccess: string;
  articleCount: number;
  knownLinks: string[];
  consecutiveErrors: number;
  lastError?: string;
}

export interface Article {
  title: string;
  link: string;
  date?: Date;
  description?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

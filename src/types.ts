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
  parserMode?: "css" | "json" | "changelog"; // default: "css"
  jsonExtraction?: {
    scriptSelector: string; // e.g., 'script#__NEXT_DATA__'
    dataPath: string; // e.g., 'props.pageProps.posts'
    fields: {
      title: string; // e.g., 'title'
      link: string; // e.g., 'slug.current'
      date?: string; // e.g., 'publishedOn'
      description?: string; // e.g., 'summary'
    };
    linkTemplate?: string; // e.g., 'https://example.com/news/{slug.current}'
  };
  changelogExtraction?: {
    versionPattern?: string; // regex for version headings, default: "^## \\[?(.+?)\\]?"
    datePattern?: string; // regex to extract date from heading, default: tries common formats
    linkTemplate?: string; // e.g., "https://github.com/org/repo/releases/tag/v{version}"
    sections?: string[]; // which ### sections to include, default: all
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

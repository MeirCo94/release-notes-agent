import type { ChatSource, ContextProvider, DraftPublisher, ProductContextSource } from "./adapters/types.js";
import { SlackSource } from "./adapters/sources/slack.js";
import { DiscordSource } from "./adapters/sources/discord.js";
import { FileSource } from "./adapters/sources/file.js";
import { JiraProvider } from "./adapters/context/jira.js";
import { GitHubPrProvider } from "./adapters/context/github.js";
import { LinkedDocsProvider } from "./adapters/context/docs.js";
import { WebsiteProductContext } from "./adapters/context/product.js";
import { NotionPublisher } from "./adapters/publishers/notion.js";
import { GoogleDocsPublisher } from "./adapters/publishers/google-docs.js";
import { MarkdownPublisher } from "./adapters/publishers/markdown.js";
import type { GroupingMode } from "./pipeline/detect.js";
import type { Audience } from "./types.js";

const env = (k: string, fallback?: string) => process.env[k] ?? fallback;
const required = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing ${k}. See .env.example.`);
  return v;
};
const list = (k: string, fallback = "") => (env(k, fallback) ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export interface AppConfig {
  source: ChatSource;
  providers: ContextProvider[];
  publisher: DraftPublisher;
  product: ProductContextSource;
  grouping: GroupingMode;
  timeZone: string;
  audiences: Audience[];
  lookbackDays: number;
  storePath: string;
  /** When set, approved notes are also written here as static JSON for a CDN. */
  feedDir?: string;
}

export function loadConfig(): AppConfig {
  const sourceName = env("CHAT_SOURCE", "file");
  const source: ChatSource =
    sourceName === "slack"
      ? new SlackSource({ token: required("SLACK_BOT_TOKEN"), channelId: required("SLACK_CHANNEL_ID"), workspaceUrl: env("SLACK_WORKSPACE_URL") })
      : sourceName === "discord"
        ? new DiscordSource({ token: required("DISCORD_BOT_TOKEN"), channelId: required("DISCORD_CHANNEL_ID"), guildId: env("DISCORD_GUILD_ID") })
        : new FileSource(env("CHAT_FILE", "fixtures/deploy-announcements.json")!);

  const providers: ContextProvider[] = [];
  const contextNames = list("CONTEXT_PROVIDERS", "jira,github,docs");
  if (contextNames.includes("jira") && env("JIRA_BASE_URL"))
    providers.push(new JiraProvider({ baseUrl: required("JIRA_BASE_URL"), email: required("JIRA_EMAIL"), apiToken: required("JIRA_API_TOKEN"), projectKeys: list("JIRA_PROJECT_KEYS") }));
  if (contextNames.includes("github")) providers.push(new GitHubPrProvider({ token: env("GITHUB_TOKEN") }));
  if (contextNames.includes("docs") && list("DOC_ALLOWED_HOSTS").length)
    providers.push(new LinkedDocsProvider({ allowedHosts: list("DOC_ALLOWED_HOSTS") }));

  const destName = env("DESTINATION", "markdown");
  const publisher: DraftPublisher =
    destName === "notion"
      ? new NotionPublisher({ token: required("NOTION_TOKEN"), dataSourceId: required("NOTION_DATA_SOURCE_ID") })
      : destName === "google-docs"
        ? new GoogleDocsPublisher({ clientId: required("GOOGLE_CLIENT_ID"), clientSecret: required("GOOGLE_CLIENT_SECRET"), refreshToken: required("GOOGLE_REFRESH_TOKEN"), folderId: env("GOOGLE_DRIVE_FOLDER_ID") })
        : new MarkdownPublisher(env("MARKDOWN_OUT_DIR", "out"));

  return {
    source,
    providers,
    publisher,
    product: new WebsiteProductContext({ configPath: env("PRODUCT_CONFIG", "product.json")!, urls: list("PRODUCT_SITE_URLS") }),
    grouping: env("GROUP_BY", "release") === "day" ? "day" : "release",
    timeZone: env("TIME_ZONE", "UTC")!,
    audiences: list("AUDIENCES", "instructor,student,internal") as Audience[],
    lookbackDays: Number(env("LOOKBACK_DAYS", "7")),
    storePath: env("STORE_PATH", "data/store.json")!,
    feedDir: env("FEED_DIR"),
  };
}

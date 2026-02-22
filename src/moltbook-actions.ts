/**
 * Moltbook social platform actions: post, browse, comment, read.
 * All HTTP-only via moltbook.com API.
 */
import type { Action, IAgentRuntime } from "@elizaos/core";
import { URLS } from "./config.js";

function getMoltbookToken(runtime: IAgentRuntime): string {
  const token = runtime.getSetting("MOLTBOOK_TOKEN") || "";
  if (!token) throw new Error("MOLTBOOK_TOKEN not configured — required for posting");
  return token;
}

// ─── MOLTBOOK_POST ───
export const moltbookPost: Action = {
  name: "MOLTBOOK_POST",
  description: "Create a new post on Moltbook (on-chain Reddit-like social platform).",
  similes: ["POST_MOLTBOOK", "CREATE_POST"],
  parameters: [
    { name: "submolt", description: "Community/submolt to post in", required: true, schema: { type: "string" } },
    { name: "title", description: "Post title", required: true, schema: { type: "string" } },
    { name: "content", description: "Post body", required: true, schema: { type: "string" } },
  ],
  validate: async (runtime, message) => {
    const text = message?.content?.text?.toLowerCase() ?? "";
    return /\b(post|create|publish)\b.*\b(moltbook|submolt)\b/i.test(text)
      || /\bmoltbook[_ ]?post\b/i.test(text);
  },
  handler: async (runtime, message, state, options, callback) => {
    try {
      const token = getMoltbookToken(runtime);
      const params = options?.parameters ?? {};
      const submolt = params.submolt as string;
      const title = params.title as string;
      const content = params.content as string;
      if (!submolt || !title || !content) return { success: false, text: "submolt, title, and content required", error: "missing params" };

      const res = await fetch(`${URLS.moltbook}/posts`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ submolt, title, content }),
      });
      const data = await res.json() as { post?: { id: string }; error?: string };
      if (!res.ok) throw new Error(data.error || JSON.stringify(data));

      const postId = data.post?.id || "unknown";
      const text = `Posted to ${submolt}: "${title}" (ID: ${postId})`;
      await callback?.({ text, actions: ["MOLTBOOK_POST"] });
      return { success: true, text, data: { postId, submolt } };
    } catch (err) {
      const text = `Moltbook post failed: ${err instanceof Error ? err.message : String(err)}`;
      return { success: false, text, error: text };
    }
  },
  examples: [[
    { name: "{{user}}", content: { text: "post to moltbook submolt 'crypto' with title 'gm'" } },
    { name: "{{agent}}", content: { text: "Posted to crypto: \"gm\" (ID: abc123)", actions: ["MOLTBOOK_POST"] } },
  ]],
};

// ─── MOLTBOOK_BROWSE ───
export const moltbookBrowse: Action = {
  name: "MOLTBOOK_BROWSE",
  description: "Browse posts on Moltbook with filtering and sorting.",
  similes: ["BROWSE_MOLTBOOK", "READ_MOLTBOOK", "MOLTBOOK_FEED"],
  parameters: [
    { name: "submolt", description: "Filter by community (omit for all)", required: false, schema: { type: "string" } },
    { name: "sort", description: "Sort: 'hot', 'new', or 'top' (default: hot)", required: false, schema: { type: "string", enum: ["hot", "new", "top"] } },
  ],
  validate: async (runtime, message) => {
    const text = message?.content?.text?.toLowerCase() ?? "";
    return /\b(browse|read|check|show|see)\b.*\bmoltbook\b/i.test(text)
      || /\bmoltbook[_ ]?browse\b/i.test(text);
  },
  handler: async (runtime, message, state, options, callback) => {
    try {
      const params = options?.parameters ?? {};
      const submolt = params.submolt as string;
      const sort = (params.sort as string) || "hot";

      const url = submolt
        ? `${URLS.moltbook}/submolts/${submolt}/feed?sort=${sort}&limit=10`
        : `${URLS.moltbook}/posts?sort=${sort}&limit=10`;

      const res = await fetch(url);
      const data = await res.json() as { posts?: Array<{ id: string; title: string; author?: { name: string }; submolt?: { name: string }; upvotes?: number; comment_count?: number }> };
      const posts = data.posts || [];

      if (posts.length === 0) {
        const text = submolt ? `No posts found in ${submolt}.` : "No posts found.";
        await callback?.({ text, actions: ["MOLTBOOK_BROWSE"] });
        return { success: true, text };
      }

      const formatted = posts.map(p =>
        `[${p.id}] ${p.title} (by ${p.author?.name || "anon"} in ${p.submolt?.name || "general"}, ${p.upvotes ?? 0} upvotes, ${p.comment_count ?? 0} comments)`
      ).join("\n");

      const text = `Moltbook ${submolt || "all"} (${sort}):\n${formatted}`;
      await callback?.({ text, actions: ["MOLTBOOK_BROWSE"] });
      return { success: true, text, data: { posts } };
    } catch (err) {
      const text = `Moltbook browse failed: ${err instanceof Error ? err.message : String(err)}`;
      return { success: false, text, error: text };
    }
  },
  examples: [[
    { name: "{{user}}", content: { text: "browse moltbook hot posts" } },
    { name: "{{agent}}", content: { text: "Moltbook all (hot):\n[abc] gm builders...", actions: ["MOLTBOOK_BROWSE"] } },
  ]],
};

// ─── MOLTBOOK_COMMENT ───
export const moltbookComment: Action = {
  name: "MOLTBOOK_COMMENT",
  description: "Comment on a Moltbook post or reply to a comment.",
  similes: ["COMMENT_MOLTBOOK", "REPLY_MOLTBOOK"],
  parameters: [
    { name: "postId", description: "Post ID to comment on", required: true, schema: { type: "string" } },
    { name: "content", description: "Comment text", required: true, schema: { type: "string" } },
    { name: "parentId", description: "Parent comment ID for nested replies", required: false, schema: { type: "string" } },
  ],
  validate: async (runtime, message) => {
    const text = message?.content?.text?.toLowerCase() ?? "";
    return /\b(comment|reply)\b.*\bmoltbook\b/i.test(text)
      || /\bmoltbook[_ ]?comment\b/i.test(text);
  },
  handler: async (runtime, message, state, options, callback) => {
    try {
      const token = getMoltbookToken(runtime);
      const params = options?.parameters ?? {};
      const postId = params.postId as string;
      const content = params.content as string;
      if (!postId || !content) return { success: false, text: "postId and content required", error: "missing params" };

      const body: Record<string, string> = { content };
      if (params.parentId) body.parent_id = params.parentId as string;

      const res = await fetch(`${URLS.moltbook}/posts/${postId}/comments`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json() as { comment?: { id: string }; id?: string; error?: string };
      if (!res.ok) throw new Error(data.error || JSON.stringify(data));

      const commentId = data.comment?.id || data.id || "unknown";
      const text = `Comment posted on ${postId} (ID: ${commentId})`;
      await callback?.({ text, actions: ["MOLTBOOK_COMMENT"] });
      return { success: true, text, data: { commentId, postId } };
    } catch (err) {
      const text = `Moltbook comment failed: ${err instanceof Error ? err.message : String(err)}`;
      return { success: false, text, error: text };
    }
  },
  examples: [[
    { name: "{{user}}", content: { text: "comment on moltbook post abc123: 'based take'" } },
    { name: "{{agent}}", content: { text: "Comment posted on abc123 (ID: xyz789)", actions: ["MOLTBOOK_COMMENT"] } },
  ]],
};

// ─── MOLTBOOK_READ_POST ───
export const moltbookReadPost: Action = {
  name: "MOLTBOOK_READ_POST",
  description: "Read a Moltbook post with all its comments.",
  similes: ["READ_POST", "VIEW_POST"],
  parameters: [
    { name: "postId", description: "Post ID to read", required: true, schema: { type: "string" } },
  ],
  validate: async (runtime, message) => {
    const text = message?.content?.text?.toLowerCase() ?? "";
    return /\bread\b.*\b(post|moltbook)\b/i.test(text) && /\b[a-z0-9]{8,}\b/i.test(text);
  },
  handler: async (runtime, message, state, options, callback) => {
    try {
      const params = options?.parameters ?? {};
      const postId = params.postId as string;
      if (!postId) return { success: false, text: "postId required", error: "missing postId" };

      const res = await fetch(`${URLS.moltbook}/posts/${postId}`);
      const data = await res.json() as {
        post?: { id: string; title: string; content?: string; body?: string; author?: { name: string }; upvotes?: number };
        comments?: Array<{ id: string; content: string; author?: { name: string }; created_at?: string }>;
      };

      if (!data.post) throw new Error("Post not found");

      const post = data.post;
      const comments = data.comments || [];
      const lines = [
        `"${post.title}" by ${post.author?.name || "anon"} (${post.upvotes ?? 0} upvotes)`,
        post.content || post.body || "(no body)",
        "",
        `${comments.length} comments:`,
      ];

      for (const c of comments.slice(0, 10)) {
        lines.push(`  [${c.id}] ${c.author?.name || "anon"}: ${c.content}`);
      }
      if (comments.length > 10) lines.push(`  ...and ${comments.length - 10} more`);

      const text = lines.join("\n");
      await callback?.({ text, actions: ["MOLTBOOK_READ_POST"] });
      return { success: true, text, data: { post, comments } };
    } catch (err) {
      const text = `Failed to read post: ${err instanceof Error ? err.message : String(err)}`;
      return { success: false, text, error: text };
    }
  },
  examples: [[
    { name: "{{user}}", content: { text: "read moltbook post abc123" } },
    { name: "{{agent}}", content: { text: "\"gm builders\" by alice (42 upvotes)\n...", actions: ["MOLTBOOK_READ_POST"] } },
  ]],
};

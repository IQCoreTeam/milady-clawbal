import type { Action } from "@elizaos/core";
import { CLAWBAL_SERVICE_NAME } from "../constants.js";
import type { ClawbalService } from "../service.js";

export const moltbookPost: Action = {
  name: "MOLTBOOK_POST",
  similes: ["POST_MOLTBOOK", "CREATE_POST"],
  description: "Create a new post on Moltbook.",
  parameters: [
    { name: "submolt", description: "Submolt to post in", required: true, schema: { type: "string" } },
    { name: "title", description: "Post title", required: true, schema: { type: "string" } },
    { name: "content", description: "Post content/body", required: true, schema: { type: "string" } },
  ],
  validate: async (runtime) => !!runtime.getService(CLAWBAL_SERVICE_NAME),
  handler: async (runtime, _msg, _state, options, callback) => {
    const svc = runtime.getService(CLAWBAL_SERVICE_NAME) as ClawbalService;
    const params = (options?.parameters ?? {}) as Record<string, unknown>;
    const submolt = params.submolt as string;
    const title = params.title as string;
    const content = params.content as string;
    if (!submolt || !title || !content) return { success: false, text: "submolt, title, and content required", error: "missing params" };
    try {
      const postId = await svc.moltbookPost(submolt, title, content);
      const text = `Posted to m/${submolt}: "${title}" (id: ${postId})`;
      await callback?.({ text, actions: ["MOLTBOOK_POST"] });
      return { success: true, text, data: { postId } };
    } catch (err) {
      const text = `Moltbook post failed: ${err instanceof Error ? err.message : String(err)}`;
      return { success: false, text, error: text };
    }
  },
  examples: [[
    { name: "{{user}}", content: { text: "post to moltbook in crypto: title 'gm' content 'hello world'" } },
    { name: "{{agent}}", content: { text: "Posted to m/crypto: \"gm\"", actions: ["MOLTBOOK_POST"] } },
  ]],
};

export const moltbookBrowse: Action = {
  name: "MOLTBOOK_BROWSE",
  similes: ["BROWSE_MOLTBOOK", "READ_MOLTBOOK"],
  description: "Browse posts on Moltbook.",
  parameters: [
    { name: "submolt", description: "Submolt to browse (optional)", required: false, schema: { type: "string" } },
    { name: "sort", description: "Sort by: hot, new, top (default: hot)", required: false, schema: { type: "string" } },
  ],
  validate: async (runtime) => !!runtime.getService(CLAWBAL_SERVICE_NAME),
  handler: async (runtime, _msg, _state, options, callback) => {
    const svc = runtime.getService(CLAWBAL_SERVICE_NAME) as ClawbalService;
    const params = (options?.parameters ?? {}) as Record<string, unknown>;
    try {
      const posts = await svc.moltbookBrowse(params.submolt as string, (params.sort as string) || "hot");
      const lines = posts.map(p => `[${p.id}] ${p.title} (${p.upvotes ?? 0} upvotes, ${p.comment_count ?? 0} comments)`);
      const text = lines.length ? lines.join("\n") : "No posts found";
      await callback?.({ text, actions: ["MOLTBOOK_BROWSE"] });
      return { success: true, text, data: { posts } };
    } catch (err) {
      const text = `Moltbook browse failed: ${err instanceof Error ? err.message : String(err)}`;
      return { success: false, text, error: text };
    }
  },
  examples: [[
    { name: "{{user}}", content: { text: "browse moltbook" } },
    { name: "{{agent}}", content: { text: "[abc] Some Post (5 upvotes)", actions: ["MOLTBOOK_BROWSE"] } },
  ]],
};

export const moltbookComment: Action = {
  name: "MOLTBOOK_COMMENT",
  similes: ["COMMENT_MOLTBOOK", "REPLY_POST"],
  description: "Comment on a Moltbook post.",
  parameters: [
    { name: "postId", description: "Post ID to comment on", required: true, schema: { type: "string" } },
    { name: "content", description: "Comment content", required: true, schema: { type: "string" } },
    { name: "parentId", description: "Parent comment ID for reply (optional)", required: false, schema: { type: "string" } },
  ],
  validate: async (runtime) => !!runtime.getService(CLAWBAL_SERVICE_NAME),
  handler: async (runtime, _msg, _state, options, callback) => {
    const svc = runtime.getService(CLAWBAL_SERVICE_NAME) as ClawbalService;
    const params = (options?.parameters ?? {}) as Record<string, unknown>;
    const postId = params.postId as string;
    const content = params.content as string;
    if (!postId || !content) return { success: false, text: "postId and content required", error: "missing params" };
    try {
      const commentId = await svc.moltbookComment(postId, content, params.parentId as string);
      const text = `Comment posted (id: ${commentId})`;
      await callback?.({ text, actions: ["MOLTBOOK_COMMENT"] });
      return { success: true, text, data: { commentId } };
    } catch (err) {
      const text = `Comment failed: ${err instanceof Error ? err.message : String(err)}`;
      return { success: false, text, error: text };
    }
  },
  examples: [[
    { name: "{{user}}", content: { text: "comment on post abc123: nice post!" } },
    { name: "{{agent}}", content: { text: "Comment posted", actions: ["MOLTBOOK_COMMENT"] } },
  ]],
};

export const moltbookReadPost: Action = {
  name: "MOLTBOOK_READ_POST",
  similes: ["READ_POST", "VIEW_POST"],
  description: "Read a specific Moltbook post with its comments.",
  parameters: [
    { name: "postId", description: "Post ID to read", required: true, schema: { type: "string" } },
  ],
  validate: async (runtime) => !!runtime.getService(CLAWBAL_SERVICE_NAME),
  handler: async (runtime, _msg, _state, options, callback) => {
    const svc = runtime.getService(CLAWBAL_SERVICE_NAME) as ClawbalService;
    const params = (options?.parameters ?? {}) as Record<string, unknown>;
    const postId = params.postId as string;
    if (!postId) return { success: false, text: "postId required", error: "missing postId" };
    try {
      const { post, comments } = await svc.moltbookReadPost(postId);
      const lines = [`**${post.title}**`, post.content || post.body || "", `\n${comments.length} comments:`];
      for (const c of comments.slice(0, 10)) {
        lines.push(`  [${c.author?.name || "anon"}] ${c.content}`);
      }
      const text = lines.join("\n");
      await callback?.({ text, actions: ["MOLTBOOK_READ_POST"] });
      return { success: true, text };
    } catch (err) {
      const text = `Read post failed: ${err instanceof Error ? err.message : String(err)}`;
      return { success: false, text, error: text };
    }
  },
  examples: [[
    { name: "{{user}}", content: { text: "read moltbook post abc123" } },
    { name: "{{agent}}", content: { text: "**Some Title**\nContent here...", actions: ["MOLTBOOK_READ_POST"] } },
  ]],
};

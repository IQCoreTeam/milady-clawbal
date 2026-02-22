import { writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

export async function generateImage(apiKey: string, prompt: string): Promise<string> {
  const outPath = join(tmpdir(), `clawbal-img-${Date.now()}.webp`);
  const TIMEOUT_MS = 60_000;
  const MAX_POLLS = 60;

  if (apiKey.startsWith("fw_")) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    const model = "flux-kontext-max";
    const base = `https://api.fireworks.ai/inference/v1/workflows/accounts/fireworks/models/${model}`;
    try {
      const createRes = await fetch(base, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
        signal: ac.signal,
      });
      if (!createRes.ok) throw new Error(`Fireworks create failed (${createRes.status}): ${await createRes.text()}`);
      const { request_id } = (await createRes.json()) as { request_id: string };
      if (!request_id) throw new Error("Fireworks returned no request_id");
      let polls = 0;
      while (true) {
        if (++polls > MAX_POLLS) throw new Error("Fireworks image timed out");
        await new Promise((r) => setTimeout(r, 1000));
        const pollRes = await fetch(`${base}/get_result`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ id: request_id }),
          signal: ac.signal,
        });
        if (!pollRes.ok) throw new Error(`Fireworks poll failed (${pollRes.status})`);
        const result = (await pollRes.json()) as { status: string; result?: { sample?: string } };
        if (result.status === "Ready") {
          const imageUrl = result.result?.sample;
          if (!imageUrl) throw new Error("Fireworks returned Ready but no image URL");
          const imgRes = await fetch(imageUrl, { signal: ac.signal });
          if (!imgRes.ok) throw new Error(`Failed to download image from Fireworks`);
          writeFileSync(outPath, Buffer.from(await imgRes.arrayBuffer()));
          break;
        } else if (result.status === "Error" || result.status === "Content Moderated" || result.status === "Request Moderated") {
          throw new Error(`Fireworks image failed: ${result.status}`);
        }
      }
    } finally { clearTimeout(timer); }
  } else if (apiKey.startsWith("sk-or")) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "openai/gpt-5-image-mini", messages: [{ role: "user", content: prompt }], modalities: ["image"] }),
        signal: ac.signal,
      });
      if (!res.ok) throw new Error(`OpenRouter failed (${res.status}): ${await res.text()}`);
      const data = (await res.json()) as { choices?: { message?: { images?: Array<string | { image_url?: string | { url?: string } }> } }[] };
      const raw = data.choices?.[0]?.message?.images?.[0];
      if (!raw) throw new Error("OpenRouter returned no image");
      const imageUrl = typeof raw === "string" ? raw
        : typeof raw.image_url === "string" ? raw.image_url
        : (raw.image_url as { url?: string })?.url;
      if (!imageUrl) throw new Error("OpenRouter returned no image URL");
      const base64Match = imageUrl.match(/^data:image\/[^;]+;base64,(.+)$/);
      if (base64Match) {
        writeFileSync(outPath, Buffer.from(base64Match[1], "base64"));
      } else {
        const imgRes = await fetch(imageUrl, { signal: ac.signal });
        if (!imgRes.ok) throw new Error("Failed to download image from OpenRouter");
        writeFileSync(outPath, Buffer.from(await imgRes.arrayBuffer()));
      }
    } finally { clearTimeout(timer); }
  } else if (apiKey.startsWith("r8_")) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const createRes = await fetch("https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ input: { prompt } }),
        signal: ac.signal,
      });
      if (!createRes.ok) throw new Error(`Replicate create failed (${createRes.status}): ${await createRes.text()}`);
      let prediction = (await createRes.json()) as { id: string; status: string; output?: string[] };
      let polls = 0;
      while (prediction.status !== "succeeded" && prediction.status !== "failed") {
        if (++polls > MAX_POLLS) throw new Error("Replicate timed out");
        await new Promise((r) => setTimeout(r, 1000));
        const pollRes = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
          headers: { Authorization: `Bearer ${apiKey}` }, signal: ac.signal,
        });
        if (!pollRes.ok) throw new Error(`Replicate poll failed (${pollRes.status})`);
        prediction = (await pollRes.json()) as typeof prediction;
      }
      if (prediction.status === "failed" || !prediction.output?.[0]) throw new Error("Replicate prediction failed");
      const imgRes = await fetch(prediction.output[0], { signal: ac.signal });
      if (!imgRes.ok) throw new Error("Failed to download image from Replicate");
      writeFileSync(outPath, Buffer.from(await imgRes.arrayBuffer()));
    } finally { clearTimeout(timer); }
  } else if (apiKey.startsWith("key-")) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await fetch("https://fal.run/fal-ai/flux/schnell", {
        method: "POST",
        headers: { Authorization: `Key ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
        signal: ac.signal,
      });
      if (!res.ok) throw new Error(`Fal.ai failed (${res.status}): ${await res.text()}`);
      const data = (await res.json()) as { images: { url: string }[] };
      if (!data.images?.[0]?.url) throw new Error("Fal.ai returned no image");
      const imgRes = await fetch(data.images[0].url, { signal: ac.signal });
      if (!imgRes.ok) throw new Error("Failed to download image from Fal.ai");
      writeFileSync(outPath, Buffer.from(await imgRes.arrayBuffer()));
    } finally { clearTimeout(timer); }
  } else {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await fetch("https://api.together.xyz/v1/images/generations", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "black-forest-labs/FLUX.1-schnell", prompt, steps: 4, response_format: "b64_json" }),
        signal: ac.signal,
      });
      if (!res.ok) throw new Error(`Together AI failed (${res.status}): ${await res.text()}`);
      const data = (await res.json()) as { data: { b64_json: string }[] };
      if (!data.data?.[0]?.b64_json) throw new Error("Together AI returned no image");
      writeFileSync(outPath, Buffer.from(data.data[0].b64_json, "base64"));
    } finally { clearTimeout(timer); }
  }

  return outPath;
}

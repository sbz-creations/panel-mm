import type { NextRequest } from "next/server";
import {
  activatePicture,
  createPicture,
  getFolderVideos,
  VimeoError,
} from "@/lib/vimeo";

export const runtime = "nodejs";
export const maxDuration = 300;

interface ApplyBody {
  video_ids?: string[];
  folder_id?: string;
  folder_name?: string;
  timecode?: number;
}

const MAX_CONCURRENCY = 4;

interface ProgressEvent {
  type: "start" | "ok" | "error" | "done";
  total?: number;
  current?: number;
  name?: string;
  msg?: string;
  ok?: number;
  fail?: number;
}

function encodeSse(evt: ProgressEvent, encoder: TextEncoder): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(evt)}\n\n`);
}

async function processOne(
  videoId: string,
  timecode: number,
): Promise<void> {
  const pic = await createPicture(videoId, timecode, true);
  const newUri = pic.uri ?? "";
  if (!pic.active && newUri) {
    await activatePicture(newUri);
  }
}

export async function POST(req: NextRequest) {
  let body: ApplyBody;
  try {
    body = (await req.json()) as ApplyBody;
  } catch {
    return Response.json({ detail: "Invalid JSON body" }, { status: 400 });
  }

  const videoIds = Array.isArray(body.video_ids) ? body.video_ids : [];
  const folderId = typeof body.folder_id === "string" ? body.folder_id : "";
  const timecode = typeof body.timecode === "number" ? body.timecode : NaN;

  if (videoIds.length === 0) {
    return Response.json({ detail: "Missing video_ids" }, { status: 400 });
  }
  if (!folderId) {
    return Response.json({ detail: "Missing folder_id" }, { status: 400 });
  }
  if (!Number.isFinite(timecode) || timecode < 0) {
    return Response.json({ detail: "Invalid timecode" }, { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const total = videoIds.length;
      let ok = 0;
      let fail = 0;
      let done = 0;

      // Resolve names for nicer progress messages
      const nameMap = new Map<string, string>();
      try {
        const all = await getFolderVideos(folderId);
        for (const v of all) nameMap.set(v.id, v.name);
      } catch {
        // Non-fatal: fall back to IDs
      }

      controller.enqueue(encodeSse({ type: "start", total }, encoder));

      const queue = [...videoIds];
      const runWorker = async (): Promise<void> => {
        while (queue.length > 0) {
          const vid = queue.shift();
          if (vid === undefined) break;
          const name = nameMap.get(vid) ?? vid;
          try {
            await processOne(vid, timecode);
            ok += 1;
            done += 1;
            controller.enqueue(
              encodeSse({ type: "ok", name, current: done, total }, encoder),
            );
          } catch (err) {
            fail += 1;
            done += 1;
            const message =
              err instanceof VimeoError
                ? err.message
                : err instanceof Error
                  ? err.message
                  : String(err);
            controller.enqueue(
              encodeSse(
                { type: "error", name, msg: message, current: done, total },
                encoder,
              ),
            );
          }
        }
      };

      const workers: Promise<void>[] = [];
      const parallel = Math.min(MAX_CONCURRENCY, total);
      for (let i = 0; i < parallel; i += 1) workers.push(runWorker());
      await Promise.all(workers);

      controller.enqueue(encodeSse({ type: "done", ok, fail, total }, encoder));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}

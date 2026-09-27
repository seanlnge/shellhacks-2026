import { z } from "zod";

import { getHoldingSource } from "~/server/ingestion/import-snapshot";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  ordinal: z.coerce.number().int().min(0).optional(),
  original: z.enum(["1"]).optional(),
});
const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  if (
    [...params.keys()].some(
      (key) =>
        !["id", "ordinal", "original"].includes(key) ||
        params.getAll(key).length !== 1,
    )
  )
    return Response.json(
      { error: "Invalid request" },
      { status: 400, headers },
    );
  const input = paramsSchema.safeParse(Object.fromEntries(params));
  if (
    !input.success ||
    (input.data.original && input.data.ordinal !== undefined)
  )
    return Response.json(
      { error: "Invalid request" },
      { status: 400, headers },
    );
  try {
    const result = await getHoldingSource(input.data.id);
    if (!result)
      return Response.json(
        { error: "Source not found" },
        { status: 404, headers },
      );
    if (input.data.original) {
      if (result.document.provider !== "SEC" || !result.original)
        return Response.json(
          { error: "Original unavailable" },
          { status: 404, headers },
        );
      return new Response(new Uint8Array(result.original), {
        headers: {
          ...headers,
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="sec-${result.document.id}.source"`,
        },
      });
    }
    const { document, chunks } = result;
    const selected =
      input.data.ordinal === undefined
        ? []
        : chunks.filter((chunk) => chunk.ordinal === input.data.ordinal);
    if (input.data.ordinal !== undefined && !selected.length)
      return Response.json(
        { error: "Excerpt not found" },
        { status: 404, headers },
      );
    return Response.json(
      {
        id: document.id,
        assetKey: document.assetKey,
        title: document.title,
        sourceUrl: document.sourceUrl,
        contentScope: document.contentScope,
        contentHash: document.contentHash,
        originalStatus: document.originalStatus,
        publishedAt: document.publishedAt,
        fetchedAt: document.fetchedAt,
        chunkCount: chunks.length,
        chunks: selected,
      },
      { headers },
    );
  } catch {
    return Response.json(
      { error: "Source unavailable" },
      { status: 503, headers },
    );
  }
}

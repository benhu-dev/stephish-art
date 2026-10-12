import { sql } from "@payloadcms/db-postgres";
import { APIError, type PayloadRequest } from "payload";

// Lock before counting to serialize with payment reservation's shared media lock.
export const protectReservedTemplateMedia = async (
  req: PayloadRequest,
  id: number | string,
) => {
  const transactionId = await req.transactionID;
  const session =
    transactionId == null
      ? undefined
      : req.payload.db.sessions?.[String(transactionId)];
  if (!session)
    throw new APIError(
      "A transaction is required to modify template previews.",
      503,
      null,
      true,
    );
  const database = session.db as {
    execute: (query: unknown) => Promise<unknown>;
  };
  await database.execute(
    sql`SELECT id FROM public.template_media WHERE id = ${Number(id)} FOR UPDATE`,
  );
  const reservations = await req.payload.count({
    collection: "checkout-portraits",
    overrideAccess: true,
    req,
    where: { reservedPreviewMedia: { equals: id } },
  });
  if (reservations.totalDocs > 0) {
    throw new APIError(
      "This preview is preserved by a checkout reservation. Upload a new preview instead.",
      409,
      null,
      true,
    );
  }
};

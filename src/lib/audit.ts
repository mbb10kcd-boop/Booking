import { db, schema } from "@/db";
import { newId } from "./ids";

export async function logAudit(
  entityType: string,
  entityId: string,
  action: string,
  detail?: string,
  actorName = "System"
) {
  await db.insert(schema.auditLog).values({
    id: newId("audit"),
    entityType,
    entityId,
    action,
    actorName,
    detail,
  });
}

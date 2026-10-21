import "server-only";
import { fail } from "@/lib/api/http";
import { resolveCatalog, type Catalog } from "@/modules/booking/public/service";

/** API helper: an old (redirected) slug keeps working; unknown and unpublished are the same 404 (BKG-11). */
export async function catalogOr404(slug: string): Promise<Catalog> {
  let r = await resolveCatalog(slug);
  if (r.kind === "redirect") r = await resolveCatalog(r.slug);
  if (r.kind !== "ok") throw fail("NOT_FOUND", "העסק לא נמצא או אינו מקבל תורים כרגע.");
  return r.catalog;
}

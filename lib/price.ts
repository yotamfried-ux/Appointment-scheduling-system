import { formatPrice } from "@/lib/lab/booking-data";

export type PriceMode = "fixed" | "from" | "free" | "hidden";

/** CAT-05: what a customer reads next to a service. `hidden` shows nothing (null) so the layout can leave the line out. */
export function priceLabel(mode: PriceMode | null | undefined, nis: number): string | null {
  switch (mode) {
    case "free": return "ללא עלות";
    case "hidden": return null;
    case "from": return `החל מ-${formatPrice(nis)}`;
    default: return formatPrice(nis);
  }
}

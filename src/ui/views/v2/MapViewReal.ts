// VIEW_MAP_REAL — the legacy "sauce-crm-map" view-type id. The MapViewReal
// class was superseded by the unified Sauce Atlas (VIEW_ATLAS); this id is
// retained only as an alias so saved workspace layouts keep resolving (main.ts
// registers AtlasView for it). Safe to remove once no pinned layouts use it.
import { type ViewTypeId, asViewTypeId } from "@/types/brands";

export const VIEW_MAP_REAL: ViewTypeId = asViewTypeId("sauce-crm-map");

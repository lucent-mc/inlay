import type { ContentMetadata } from "../inventory.js";
import { checkPack } from "./resolve.js";

function category(item: ContentMetadata): string {
  const name = item.path.toLowerCase();
  if (name.startsWith("mods/")) return "mods";
  if (name.startsWith("plugins/")) return "plugins";
  if (name.startsWith("resourcepacks/")) return "resource packs";
  if (name.startsWith("texturepacks/")) return "resource packs";
  if (name.startsWith("shaderpacks/")) return "shader packs";
  if (name.startsWith("datapacks/")) return "data packs";
  if (name.startsWith("config/")) return "configs";
  return "other";
}

function groups(items: ContentMetadata[]) {
  return Object.groupBy(items, category);
}

export async function listPack(root: string, resolved = false) {
  const checked = await checkPack(root);
  return listView(checked, resolved);
}

export function listView(
  checked: Awaited<ReturnType<typeof checkPack>>,
  resolved = false,
  filters: { type?: string; layer?: string } = {},
) {
  const filtered = checked.inventory.content.filter(
    (item) =>
      (!filters.type || category(item) === filters.type) &&
      (!filters.layer || item.owner.toLowerCase().includes(filters.layer.toLowerCase())),
  );
  if (resolved) {
    return {
      lineage: checked.pack.lineage,
      content: groups(filtered),
      dependencies: checked.pack.dependencies,
    };
  }
  return {
    lineage: checked.pack.lineage
      .filter(
        (layer) =>
          !filters.layer ||
          `${layer.name}@${layer.versionId}`.toLowerCase().includes(filters.layer.toLowerCase()),
      )
      .map((layer) => ({
        ...layer,
        content: groups(filtered.filter((content) => content.owner === `${layer.name}@${layer.versionId}`)),
      })),
    dependencies: checked.pack.dependencies,
  };
}

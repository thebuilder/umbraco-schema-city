// A Document Type laid out the way the content editor draws it. The graph lists the
// type's own groups first and then each composition's, so a tab or a group that
// several of them declare under one alias arrives more than once; Umbraco merges
// those into one, and so does this. Pure: no DOM, no React.
import type { PropertyGroup, SchemaNode, SchemaProperty } from "./types";

export type EditorPanel = {
  key: string;
  /** Null for properties that sit on a tab outside any group. */
  name: string | null;
  properties: SchemaProperty[];
};

export type EditorTab = {
  key: string;
  name: string;
  panels: EditorPanel[];
  count: number;
};

/**
 * "Textstring (Umb.PropertyEditorUi.TextBox)": the Data Type an editor picks by name,
 * then the editor behind it. The editor alone when the Data Type has no name.
 */
export function editorLabel(property: SchemaProperty): string {
  const editor = property.editorUiAlias ?? property.editorAlias;
  return property.dataTypeName
    ? `${property.dataTypeName} (${editor})`
    : editor;
}

/** Umbraco's name for the tab that holds root groups once a type has tabs. */
export const GENERIC_TAB = "Generic";

/**
 * Tabs in the order they first appear, groups in each tab likewise. A type with no
 * tabs comes back as one tab keyed "" and named GENERIC_TAB, which the view draws
 * without a tab row, the way Umbraco does. Tabs with no properties are left out.
 *
 * ponytail: the graph keeps each source's order but not Umbraco's sort numbers,
 * so merged tabs and groups follow first appearance, not the editor's interleaving.
 */
export function editorLayout(node: SchemaNode): EditorTab[] {
  const groups = node.groups ?? [];
  // A composition's group can sit in a tab the list only reaches later.
  const tabNames = new Map<string, string>();
  for (const group of groups)
    if (group.type === "Tab" && !tabNames.has(group.alias))
      tabNames.set(group.alias, group.name);

  // Root groups come first, as Umbraco puts the generic tab first.
  const tabs = new Map<string, EditorTab>();
  for (const key of ["", ...groups.map(tabKey)])
    if (!tabs.has(key))
      tabs.set(key, {
        key,
        // A group's tab the graph never sent, from a snapshot taken before the
        // backend sent composition tabs that only hold groups, is named by its alias.
        name: key === "" ? GENERIC_TAB : (tabNames.get(key) ?? key),
        panels: [],
        count: 0,
      });
  for (const group of groups) addGroup(tabs.get(tabKey(group)), group);

  return [...tabs.values()]
    .map((tab) => ({
      ...tab,
      panels: tab.panels.filter((panel) => panel.properties.length > 0),
    }))
    .filter((tab) => tab.panels.length > 0);
}

/** The tab a group is drawn in, or "" for a group that sits in no tab. */
const tabKey = (group: PropertyGroup) =>
  group.type === "Tab" ? group.alias : (group.parentAlias ?? "");

function addGroup(tab: EditorTab | undefined, group: PropertyGroup) {
  if (!tab) return;
  const name = group.type === "Tab" ? null : group.name;
  const key = `${tab.key}/${name === null ? "" : group.alias}`;
  let panel = tab.panels.find((candidate) => candidate.key === key);
  if (!panel) {
    panel = { key, name, properties: [] };
    // A tab's own properties sit above its groups.
    if (name === null) tab.panels.unshift(panel);
    else tab.panels.push(panel);
  }
  panel.properties.push(...group.properties);
  tab.count += group.properties.length;
}

/** Stands in for a composition id when a panel's properties come from several places. */
export const MIXED = "mixed";

/**
 * Where a panel's properties come from: the id of the one composition they all come
 * from, null when they are all the type's own, or MIXED. A panel from one
 * composition says so once on its header; only a mixed one marks its rows.
 */
export function panelSource(panel: EditorPanel): string | null {
  const sources = new Set(
    panel.properties.map((property) => property.fromCompositionId)
  );
  if (sources.size > 1) return MIXED;
  return [...sources][0] ?? null;
}

/**
 * The tab the view opens on: the first with a property of the type's own, since
 * that is what the type adds. A generic tab of folded composed groups says little.
 */
export const firstOwnTab = (tabs: EditorTab[]) =>
  tabs.find((tab) =>
    tab.panels.some((panel) =>
      panel.properties.some((property) => !property.fromCompositionId)
    )
  ) ?? tabs[0];

const count = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * The header's one line: "29 properties, 18 own and 11 from 3 compositions, 3 tabs".
 * Tabs only when the type has a tab row, mandatory only when some are.
 */
export function editorSummary(tabs: EditorTab[]): string {
  const properties = tabs.flatMap((tab) =>
    tab.panels.flatMap((panel) => panel.properties)
  );
  if (properties.length === 0) return "No properties";
  const sources = new Set(
    properties.flatMap((property) =>
      property.fromCompositionId ? [property.fromCompositionId] : []
    )
  );
  const composed = properties.filter(
    (property) => property.fromCompositionId
  ).length;
  const own = properties.length - composed;
  const from = `from ${count(sources.size, "composition")}`;
  const mandatory = properties.filter((property) => property.mandatory).length;
  let origin = `${own} own and ${composed} ${from}`;
  if (composed === 0) origin = "";
  else if (own === 0) origin = `all ${from}`;
  return [
    count(properties.length, "property", "properties"),
    origin,
    tabs.some((tab) => tab.key !== "") ? count(tabs.length, "tab") : "",
    mandatory > 0 ? `${mandatory} mandatory` : "",
  ]
    .filter(Boolean)
    .join(", ");
}

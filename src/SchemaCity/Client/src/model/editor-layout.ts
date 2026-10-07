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
  const tabOf = (group: PropertyGroup) => tabKey(group, tabNames);

  // Root groups come first, as Umbraco puts the generic tab first.
  const tabs = new Map<string, EditorTab>();
  for (const key of ["", ...groups.map(tabOf)])
    if (!tabs.has(key))
      tabs.set(key, {
        key,
        name: tabNames.get(key) ?? GENERIC_TAB,
        panels: [],
        count: 0,
      });
  for (const group of groups) addGroup(tabs.get(tabOf(group)), group);

  return [...tabs.values()]
    .map((tab) => ({
      ...tab,
      panels: tab.panels.filter((panel) => panel.properties.length > 0),
    }))
    .filter((tab) => tab.panels.length > 0);
}

/** The tab a group is drawn in; one whose tab resolves to nothing goes to the top. */
function tabKey(group: PropertyGroup, tabNames: ReadonlyMap<string, string>) {
  if (group.type === "Tab") return group.alias;
  const parent = group.parentAlias ?? "";
  return tabNames.has(parent) ? parent : "";
}

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

// The medium schema as it stood before four planned edits, for the compare test and
// the compare screenshot: Seo Composition had two more properties, Press Release did
// not exist yet, Article's grid offered Element Quote where it now offers Element
// Video, and Blog Post's first text field was a Textarea. Imported as the baseline,
// the comparison reads those four edits back against the medium fixture.
//
// Erasable TypeScript only, so dev/shots.mjs can import it under plain Node.
import type { SchemaGraph, SchemaProperty } from "../src/model/types.ts";

const SEO = "76bccc6e-b746-508a-d797-4df742a7a61b";
const PRESS_RELEASE = "bf7206eb-f246-1061-80b0-97dedde32777";
const ARTICLE = "cbb5a292-699c-0306-5c28-64fa225e1940";
const BLOG_POST = "efe97ed3-eccb-fe5e-5b79-336f4092e275";
const VIDEO = "00da4cdc-96c1-81f0-5fb0-4998f27014fe";
const QUOTE = "42486f7c-60a9-35ad-df00-00d323c4307a";

const seoProperty = (alias: string, name: string): SchemaProperty => ({
  alias,
  name,
  dataTypeId: "0cc0eba1-9960-42c9-bf9b-60e150b429ae",
  dataTypeName: "Textstring",
  editorAlias: "Umbraco.TextBox",
  editorUiAlias: "Umb.PropertyEditorUi.TextBox",
  mandatory: false,
  variesByCulture: false,
  fromCompositionId: null,
  targets: [],
});

export function plannedBaseline(current: SchemaGraph): SchemaGraph {
  const graph: SchemaGraph = structuredClone(current);
  graph.nodes = graph.nodes.filter((node) => node.id !== PRESS_RELEASE);
  graph.edges = graph.edges.filter(
    (edge) => edge.from !== PRESS_RELEASE && edge.to !== PRESS_RELEASE
  );
  const extra = [
    seoProperty("seoRobots", "Robots"),
    seoProperty("seoSchemaMarkup", "Schema markup"),
  ];
  for (const node of graph.nodes)
    for (const group of node.groups) {
      // Every type composing Seo Composition carries its properties too.
      if (node.id === SEO || group.fromCompositionId === SEO) {
        if (group.alias !== "seo") continue;
        const composed = node.id === SEO ? null : SEO;
        group.properties.push(
          ...extra.map((property) => ({
            ...property,
            fromCompositionId: composed,
          }))
        );
        if (composed) node.composedPropertyCount += extra.length;
        else node.ownPropertyCount += extra.length;
      }
      for (const property of group.properties) {
        if (node.id === ARTICLE && property.alias === "articleField02")
          for (const target of property.targets)
            if (target.nodeId === VIDEO) target.nodeId = QUOTE;
        if (node.id === BLOG_POST && property.alias === "blogPostField04")
          Object.assign(property, {
            dataTypeId: "c6bac0dd-4ab9-45b1-8e30-e4b619ee5da3",
            dataTypeName: "Textarea",
            editorAlias: "Umbraco.TextArea",
            editorUiAlias: "Umb.PropertyEditorUi.TextArea",
          });
      }
    }
  for (const edge of graph.edges)
    if (
      edge.from === ARTICLE &&
      edge.propertyAlias === "articleField02" &&
      edge.to === VIDEO
    )
      edge.to = QUOTE;
  return graph;
}

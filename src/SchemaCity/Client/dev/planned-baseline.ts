// The medium schema as it stood before four planned edits, for the compare test and
// the compare screenshot: Seo Composition had two more properties, Press Release did
// not exist yet, Article's grid offered Element Quote where it now offers Element
// Video, and Blog Post's first text field was a Textarea. Imported as the baseline,
// the comparison reads those four edits back against the medium fixture.
//
// Erasable TypeScript only, so dev/shots.mjs can import it under plain Node.
import type {
  SchemaGraph,
  SchemaNode,
  SchemaProperty,
} from "../src/model/types.ts";

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

const EXTRA = [
  seoProperty("seoRobots", "Robots"),
  seoProperty("seoSchemaMarkup", "Schema markup"),
];

/** Seo Composition's two extra properties, on it and on every type composing it. */
function addSeoProperties(node: SchemaNode) {
  const own = node.id === SEO;
  const group = node.groups.find(
    (candidate) =>
      candidate.alias === "seo" && (own || candidate.fromCompositionId === SEO)
  );
  if (!group) return;
  group.properties.push(
    ...EXTRA.map((property) => ({
      ...property,
      fromCompositionId: own ? null : SEO,
    }))
  );
  if (own) node.ownPropertyCount += EXTRA.length;
  else node.composedPropertyCount += EXTRA.length;
}

const propertyOf = (graph: SchemaGraph, nodeId: string, alias: string) =>
  graph.nodes
    .find((node) => node.id === nodeId)
    ?.groups.flatMap((group) => group.properties)
    .find((property) => property.alias === alias);

export function plannedBaseline(current: SchemaGraph): SchemaGraph {
  const graph: SchemaGraph = structuredClone(current);
  graph.nodes = graph.nodes.filter((node) => node.id !== PRESS_RELEASE);
  graph.edges = graph.edges.filter(
    (edge) => edge.from !== PRESS_RELEASE && edge.to !== PRESS_RELEASE
  );
  for (const node of graph.nodes) addSeoProperties(node);
  for (const target of propertyOf(graph, ARTICLE, "articleField02")?.targets ??
    [])
    if (target.nodeId === VIDEO) target.nodeId = QUOTE;
  for (const edge of graph.edges)
    if (edge.from === ARTICLE && edge.propertyAlias === "articleField02")
      edge.to = edge.to === VIDEO ? QUOTE : edge.to;
  Object.assign(propertyOf(graph, BLOG_POST, "blogPostField04") ?? {}, {
    dataTypeId: "c6bac0dd-4ab9-45b1-8e30-e4b619ee5da3",
    dataTypeName: "Textarea",
    editorAlias: "Umbraco.TextArea",
    editorUiAlias: "Umb.PropertyEditorUi.TextArea",
  });
  return graph;
}

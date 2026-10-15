import path from "node:path"
import type { NextConfig } from "next"

/*
 * Slides import Schema City's own scene, layout and model modules from
 * src/SchemaCity/Client rather than copies of them, so the city on a slide is
 * the city in the package. Turbopack only compiles inside its root, so the
 * root is the repository. Those modules import three, React and friends by
 * bare name, and resolving from their folder would find the client's copies or
 * none at all. Two Reacts break hooks and two threes break instanceof, so
 * every shared package is pinned to this app's node_modules.
 */
const shared = [
  "react",
  "react-dom",
  "three",
  "@react-three/fiber",
  "@react-three/drei",
  "@dagrejs/dagre",
]

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(import.meta.dirname, ".."),
    resolveAlias: Object.fromEntries(
      shared.flatMap((name) => [
        [name, `./node_modules/${name}`],
        [`${name}/*`, `./node_modules/${name}/*`],
      ]),
    ),
  },
}

export default nextConfig

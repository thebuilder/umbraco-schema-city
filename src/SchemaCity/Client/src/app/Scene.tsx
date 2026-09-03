import { OrbitControls } from "@react-three/drei";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { SchemaNode } from "../model/types";

const COLUMNS = 4;
const SPACING = 3;
/** One property is one floor, 0.35 units tall, so a 40-property type stays on screen. */
const FLOOR = 0.35;

type Palette = { phosphor: string; signal: string; dim: string };

function Buildings({
  nodes,
  selected,
  onSelect,
  palette,
}: {
  nodes: SchemaNode[];
  selected: string | null;
  onSelect: (id: string) => void;
  palette: Palette;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const [hovered, setHovered] = useState(-1);
  const scratch = useMemo(() => new THREE.Object3D(), []);
  const colour = useMemo(() => new THREE.Color(), []);

  useEffect(() => {
    const instances = mesh.current;
    if (!instances) return;

    const rows = Math.ceil(nodes.length / COLUMNS);
    nodes.forEach((node, i) => {
      const height =
        Math.max(1, node.ownPropertyCount + node.composedPropertyCount) * FLOOR;
      scratch.position.set(
        ((i % COLUMNS) - (COLUMNS - 1) / 2) * SPACING,
        height / 2,
        (Math.floor(i / COLUMNS) - (rows - 1) / 2) * SPACING,
      );
      scratch.scale.set(1.6, height, 1.6);
      scratch.updateMatrix();
      instances.setMatrixAt(i, scratch.matrix);
    });
    instances.instanceMatrix.needsUpdate = true;
    instances.computeBoundingSphere();
  }, [nodes, scratch]);

  useEffect(() => {
    const instances = mesh.current;
    if (!instances) return;

    nodes.forEach((node, i) => {
      colour.set(node.id === selected ? palette.signal : palette.phosphor);
      if (i === hovered) colour.multiplyScalar(1.5);
      instances.setColorAt(i, colour);
    });
    if (instances.instanceColor) instances.instanceColor.needsUpdate = true;
  }, [nodes, selected, hovered, palette, colour]);

  return (
    <instancedMesh
      args={[undefined, undefined, nodes.length]}
      onClick={(event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation();
        const node = nodes[event.instanceId ?? -1];
        if (node) onSelect(node.id);
      }}
      onPointerMove={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        setHovered(event.instanceId ?? -1);
      }}
      onPointerOut={() => setHovered(-1)}
      ref={mesh}
    >
      <boxGeometry />
      <meshStandardMaterial metalness={0.1} roughness={0.45} />
    </instancedMesh>
  );
}

export default function Scene({
  nodes,
  selected,
  onSelect,
}: {
  nodes: SchemaNode[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [palette, setPalette] = useState<Palette | null>(null);

  // The scene colours are the theme's own tokens, read once from an element inside
  // the shadow root, so the city and the chrome can never drift apart.
  useEffect(() => {
    const style = getComputedStyle(host.current as HTMLElement);
    const token = (name: string) => style.getPropertyValue(name).trim();
    setPalette({
      phosphor: token("--phosphor"),
      signal: token("--signal"),
      dim: token("--phosphor-dim"),
    });
  }, []);

  return (
    <div className="absolute inset-0" ref={host}>
      {palette ? (
        <Canvas
          camera={{ far: 500, near: -100, position: [18, 16, 18], zoom: 30 }}
          orthographic
        >
          <ambientLight intensity={1.2} />
          <directionalLight intensity={2.4} position={[8, 16, 6]} />
          <gridHelper args={[26, 10, palette.dim, palette.dim]} />
          <Buildings
            nodes={nodes}
            onSelect={onSelect}
            palette={palette}
            selected={selected}
          />
          <OrbitControls makeDefault />
        </Canvas>
      ) : null}
    </div>
  );
}

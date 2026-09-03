import { OrbitControls } from "@react-three/drei";
import { Canvas, type ThreeEvent, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { SchemaGraph } from "../model/types";
import { cityBounds, layoutCity, type CityBounds, type Placement } from "./layout/city";

/** A flat plate for M1. Floors, roofs and roads replace this once the city is placed. */
const PLATE_HEIGHT = 0.1;

type Palette = { phosphor: string; signal: string; dim: string; amber: string };

function districtColour(district: Placement["district"], palette: Palette): string {
  if (district === "element") return palette.amber;
  if (district === "detached") return palette.dim;
  return palette.phosphor;
}

function Buildings({
  placements,
  selected,
  onSelect,
  palette,
}: {
  placements: Placement[];
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

    placements.forEach((placement, i) => {
      scratch.position.set(placement.position.x, PLATE_HEIGHT / 2, placement.position.z);
      scratch.scale.set(placement.footprint, PLATE_HEIGHT, placement.footprint);
      scratch.updateMatrix();
      instances.setMatrixAt(i, scratch.matrix);
    });
    instances.instanceMatrix.needsUpdate = true;
    instances.computeBoundingSphere();
  }, [placements, scratch]);

  useEffect(() => {
    const instances = mesh.current;
    if (!instances) return;

    placements.forEach((placement, i) => {
      colour.set(
        placement.id === selected ? palette.signal : districtColour(placement.district, palette),
      );
      if (i === hovered) colour.multiplyScalar(1.5);
      instances.setColorAt(i, colour);
    });
    if (instances.instanceColor) instances.instanceColor.needsUpdate = true;
  }, [placements, selected, hovered, palette, colour]);

  return (
    <instancedMesh
      args={[undefined, undefined, placements.length]}
      onClick={(event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation();
        const placement = placements[event.instanceId ?? -1];
        if (placement) onSelect(placement.id);
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

/**
 * ponytail: fits the ortho camera to the city bounds by pixels-per-world-unit, at a
 * fixed isometric angle. It treats the ground span as if the camera looked straight
 * down, so a wide, shallow city gets a bit more air than a square one. Close enough
 * until the camera gets its own flight and framing logic later in M1.
 */
function CameraFrame({ bounds }: { bounds: CityBounds }) {
  const { camera, size } = useThree();

  useEffect(() => {
    const ortho = camera as THREE.OrthographicCamera;
    const span = Math.max(bounds.width, bounds.depth, 4) * 1.5;
    ortho.position.set(bounds.centre.x + span, span * 0.9, bounds.centre.z + span);
    ortho.lookAt(bounds.centre.x, 0, bounds.centre.z);
    ortho.zoom = Math.min(size.width, size.height) / span;
    ortho.updateProjectionMatrix();
  }, [bounds, camera, size]);

  return null;
}

export default function Scene({
  graph,
  selected,
  onSelect,
}: {
  graph: SchemaGraph;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [palette, setPalette] = useState<Palette | null>(null);
  const placements = useMemo(() => layoutCity(graph), [graph]);
  const bounds = useMemo(() => cityBounds(placements), [placements]);

  // The scene colours are the theme's own tokens, read once from an element inside
  // the shadow root, so the city and the chrome can never drift apart.
  useEffect(() => {
    const style = getComputedStyle(host.current as HTMLElement);
    const token = (name: string) => style.getPropertyValue(name).trim();
    setPalette({
      amber: token("--amber"),
      dim: token("--phosphor-dim"),
      phosphor: token("--phosphor"),
      signal: token("--signal"),
    });
  }, []);

  return (
    <div className="absolute inset-0" ref={host}>
      {palette ? (
        <Canvas camera={{ far: 500, near: -100 }} orthographic>
          <ambientLight intensity={1.2} />
          <directionalLight intensity={2.4} position={[8, 16, 6]} />
          <gridHelper
            args={[Math.max(bounds.width, bounds.depth, 4) * 2, 20, palette.dim, palette.dim]}
            position={[bounds.centre.x, 0, bounds.centre.z]}
          />
          <Buildings
            onSelect={onSelect}
            palette={palette}
            placements={placements}
            selected={selected}
          />
          <CameraFrame bounds={bounds} />
          <OrbitControls makeDefault target={[bounds.centre.x, 0, bounds.centre.z]} />
        </Canvas>
      ) : null}
    </div>
  );
}

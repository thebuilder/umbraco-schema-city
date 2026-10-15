"use client"

import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  BoxGeometry,
  CanvasTexture,
  type Color,
  EdgesGeometry,
  type LineBasicMaterial,
  type MeshBasicMaterial,
  type SpriteMaterial,
  SRGBColorSpace,
  Vector3,
} from "three"
import { type ThemeColors, useThemeColors } from "@/deck/parts/theme-colors"

/*
 * fsn, the SGI File System Navigator from 1992, as it looked in the control
 * room. Directories are platforms, files are blocks standing on them, a
 * block's height is its size, and each directory sits behind its parent with a
 * wire running back to it. The tree is the park's own, with one file worth
 * flying to.
 */

interface FsnFile {
  name: string
  size: number
  tone?: "amber" | "signal"
}

interface FsnDir {
  children?: FsnDir[]
  files?: FsnFile[]
  name: string
}

const tree: FsnDir = {
  name: "/",
  files: [
    { name: "unix", size: 1800 },
    { name: ".profile", size: 1 },
  ],
  children: [
    {
      name: "bin",
      files: [
        { name: "sh", size: 120 },
        { name: "ls", size: 90 },
        { name: "fsn", size: 640 },
        { name: "vi", size: 410 },
      ],
    },
    {
      name: "etc",
      files: [
        { name: "passwd", size: 3 },
        { name: "hosts", size: 2 },
        { name: "fstab", size: 1 },
        { name: "motd", size: 1 },
      ],
    },
    {
      name: "home",
      children: [
        {
          name: "nedry",
          files: [
            { name: "whte_rbt.obj", size: 64, tone: "amber" },
            { name: "notes", size: 8 },
            { name: "dodgson.txt", size: 2 },
          ],
        },
        {
          name: "lex",
          files: [
            { name: "games", size: 900 },
            { name: "homework", size: 30 },
          ],
        },
      ],
    },
    {
      name: "usr",
      children: [
        {
          name: "bin",
          files: [
            { name: "awk", size: 160 },
            { name: "grep", size: 110 },
            { name: "make", size: 240 },
            { name: "cc", size: 1300 },
            { name: "tar", size: 180 },
            { name: "sed", size: 70 },
          ],
        },
        {
          name: "park",
          children: [
            {
              name: "security",
              // Back row first. doors stands at the front, where the camera
              // comes down, so nothing taller hides it.
              files: [
                { name: "cameras", size: 1800 },
                { name: "motion.log", size: 5600 },
                { name: "badges.db", size: 340 },
                { name: "fences", size: 220 },
                { name: "doors", size: 48, tone: "signal" },
              ],
            },
            {
              name: "power",
              files: [
                { name: "grid.cfg", size: 4 },
                { name: "generator", size: 260 },
                { name: "breakers", size: 32 },
                { name: "backup", size: 1200 },
              ],
            },
            {
              name: "paddocks",
              files: [
                { name: "rex", size: 900 },
                { name: "raptors", size: 1400 },
                { name: "brachio", size: 600 },
                { name: "dilo", size: 300 },
                { name: "trike", size: 450 },
                { name: "gallimimus", size: 520 },
              ],
            },
            {
              name: "tour",
              files: [
                { name: "jeeps", size: 120 },
                { name: "route.cfg", size: 6 },
                { name: "audio", size: 4200 },
              ],
            },
            {
              name: "genetics",
              files: [
                { name: "frog.seq", size: 9000 },
                { name: "amber.seq", size: 7000 },
                { name: "rex.seq", size: 12000 },
                { name: "raptor.seq", size: 11000 },
              ],
            },
          ],
        },
      ],
    },
    {
      name: "var",
      children: [
        {
          name: "log",
          files: [
            { name: "syslog", size: 8000 },
            { name: "messages", size: 3000 },
            { name: "wtmp", size: 200 },
          ],
        },
      ],
    },
  ],
}

const depthGap = 11
const leafGap = 7.5
const filePitch = 1.15
const fileFoot = 0.72
const deck = 0.35

interface PlacedFile extends FsnFile {
  height: number
  position: [number, number, number]
}

interface PlacedDir {
  files: PlacedFile[]
  name: string
  parent?: PlacedDir
  path: string
  side: number
  x: number
  z: number
}

function leaves(dir: FsnDir): number {
  return dir.children?.length
    ? dir.children.reduce((sum, child) => sum + leaves(child), 0)
    : 1
}

// Each directory takes the width its leaves need and centres itself over its
// children, the way fsn fanned a tree out behind the root.
function place(): PlacedDir[] {
  const out: PlacedDir[] = []

  function visit(
    dir: FsnDir,
    depth: number,
    left: number,
    parent: PlacedDir | undefined,
    path: string
  ) {
    const span = leaves(dir) * leafGap
    const files = dir.files ?? []
    const columns = Math.max(1, Math.ceil(Math.sqrt(files.length)))
    const rows = Math.max(1, Math.ceil(files.length / columns))
    const side = Math.max(2.4, columns * filePitch + 0.7, rows * filePitch + 0.7)
    const x = left + span / 2
    const z = -depth * depthGap
    const placed: PlacedDir = {
      files: files.map((file, index) => {
        const column = index % columns
        const row = Math.floor(index / columns)
        const height = 0.35 + Math.log10(file.size + 1) * 0.85
        return {
          ...file,
          height,
          position: [
            x + (column - (columns - 1) / 2) * filePitch,
            deck + height / 2,
            z + (row - (rows - 1) / 2) * filePitch,
          ],
        }
      }),
      name: dir.name,
      parent,
      path,
      side,
      x,
      z,
    }
    out.push(placed)

    let cursor = left
    for (const child of dir.children ?? []) {
      const childPath = `${path === "/" ? "" : path}/${child.name}`
      visit(child, depth + 1, cursor, placed, childPath)
      cursor += leaves(child) * leafGap
    }
  }

  visit(tree, 0, -(leaves(tree) * leafGap) / 2, undefined, "/")
  return out
}

export const fsnTarget = "/usr/park/security/doors"

const unitBox = new BoxGeometry(1, 1, 1)
const unitEdges = new EdgesGeometry(unitBox)

function Block({
  edge,
  fill,
  position,
  scale,
  fillRef,
  edgeRef,
}: {
  edge: Color
  edgeRef?: React.Ref<LineBasicMaterial>
  fill: Color
  fillRef?: React.Ref<MeshBasicMaterial>
  position: [number, number, number]
  scale: [number, number, number]
}) {
  return (
    <group position={position} scale={scale}>
      <mesh geometry={unitBox}>
        <meshBasicMaterial color={fill} ref={fillRef} />
      </mesh>
      <lineSegments geometry={unitEdges}>
        <lineBasicMaterial color={edge} ref={edgeRef} />
      </lineSegments>
    </group>
  )
}

/*
 * Labels are sprites with the name painted into a texture, rather than DOM laid
 * over the canvas, so they sit in the scene: they shrink with distance and fade
 * into the fog with the platform they name.
 */
function Label({
  color,
  font,
  opacity = 1,
  position,
  size,
  text,
  materialRef,
}: {
  color: Color
  font: string
  materialRef?: React.Ref<SpriteMaterial>
  opacity?: number
  position: [number, number, number]
  size: number
  text: string
}) {
  const { aspect, texture } = useMemo(() => {
    const canvas = document.createElement("canvas")
    const context = canvas.getContext("2d")
    const px = 96
    const face = `600 ${px}px ${font}`
    if (!context) {
      return { aspect: 1, texture: new CanvasTexture(canvas) }
    }
    context.font = face
    canvas.width = Math.ceil(context.measureText(text).width) + px / 2
    canvas.height = Math.ceil(px * 1.4)
    context.font = face
    context.fillStyle = `#${color.getHexString(SRGBColorSpace)}`
    context.textAlign = "center"
    context.textBaseline = "middle"
    context.fillText(text, canvas.width / 2, canvas.height / 2)
    const map = new CanvasTexture(canvas)
    map.colorSpace = SRGBColorSpace
    map.anisotropy = 4
    return { aspect: canvas.width / canvas.height, texture: map }
  }, [color, font, text])

  return (
    <sprite position={position} scale={[size * aspect, size, 1]}>
      <spriteMaterial
        depthWrite={false}
        map={texture}
        opacity={opacity}
        ref={materialRef}
        transparent
      />
    </sprite>
  )
}

function Labels({
  colors,
  dirs,
  font,
}: {
  colors: ThemeColors
  dirs: PlacedDir[]
  font: string
}) {
  return dirs.map((dir) => (
    <group key={dir.path}>
      <Label
        color={colors.primary}
        font={font}
        position={[dir.x, 0.3, dir.z + dir.side / 2 + 0.75]}
        size={0.75}
        text={dir.name}
      />
      {/* An amber file is one somebody left lying around, so it says its name. */}
      {dir.files
        .filter((file) => file.tone === "amber")
        .map((file) => (
          <Label
            color={colors.amber}
            font={font}
            key={file.name}
            position={[
              file.position[0],
              file.position[1] + file.height / 2 + 0.6,
              file.position[2],
            ]}
            size={0.6}
            text={file.name}
          />
        ))}
    </group>
  ))
}

function Wires({ colors, dirs }: { colors: ThemeColors; dirs: PlacedDir[] }) {
  const positions = useMemo(() => {
    const points: number[] = []
    for (const dir of dirs) {
      if (!dir.parent) {
        continue
      }
      points.push(
        dir.parent.x,
        0.02,
        dir.parent.z - dir.parent.side / 2,
        dir.x,
        0.02,
        dir.z + dir.side / 2
      )
    }
    return new Float32Array(points)
  }, [dirs])

  return (
    <lineSegments>
      <bufferGeometry>
        <bufferAttribute args={[positions, 3]} attach="attributes-position" />
      </bufferGeometry>
      <lineBasicMaterial color={colors.primary} />
    </lineSegments>
  )
}

// Mixed in sRGB rather than linear light, so an amount reads the way it looks:
// a fill a fifth of the way to the phosphor is a dark fill, not a lit one.
function mix(a: Color, b: Color, amount: number) {
  const from = a.clone().convertLinearToSRGB()
  const to = b.clone().convertLinearToSRGB()
  return from.lerp(to, amount).convertSRGBToLinear()
}

function City({
  colors,
  dirs,
  focus,
  still,
}: {
  colors: ThemeColors
  dirs: PlacedDir[]
  focus: boolean
  still: boolean
}) {
  const targetFill = useRef<MeshBasicMaterial>(null)
  const targetEdge = useRef<LineBasicMaterial>(null)
  const pedestal = mix(colors.background, colors.card, 0.9)
  const block = mix(colors.background, colors.primary, 0.18)
  const signalFill = mix(colors.background, colors.signal, 0.45)
  const amberFill = mix(colors.background, colors.amber, 0.35)

  useFrame(({ clock }) => {
    if (!(targetFill.current && targetEdge.current)) {
      return
    }
    // The file pulses only once the camera has gone looking for it.
    const pulse = focus && !still ? 0.5 + 0.5 * Math.sin(clock.elapsedTime * 5) : 1
    targetFill.current.color.copy(
      focus ? mix(signalFill, colors.signal, pulse * 0.6) : block
    )
    targetEdge.current.color.copy(focus ? colors.signal : colors.primary)
  })

  return (
    <group>
      {dirs.map((dir) => (
        <group key={dir.path}>
          <Block
            edge={colors.primary}
            fill={pedestal}
            position={[dir.x, deck / 2, dir.z]}
            scale={[dir.side, deck, dir.side]}
          />
          {dir.files.map((file) => {
            const isTarget = `${dir.path}/${file.name}` === fsnTarget
            const tone =
              file.tone === "amber" ? colors.amber : colors.primary
            return (
              <Block
                edge={tone}
                edgeRef={isTarget ? targetEdge : undefined}
                fill={file.tone === "amber" ? amberFill : block}
                fillRef={isTarget ? targetFill : undefined}
                key={file.name}
                position={file.position}
                scale={[fileFoot, file.height, fileFoot]}
              />
            )
          })}
        </group>
      ))}
    </group>
  )
}

function ease(t: number) {
  const k = Math.min(Math.max(t, 0), 1)
  return k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2
}

const flight = 3.6
const boot = 3.2

// Where the camera circles before the focus, as a function of the clock.
function orbit(centre: Vector3, t: number, pos: Vector3, look: Vector3) {
  const a = t * 0.06 - 0.5
  const lift = 1 + 1.6 * (1 - ease(t / boot))
  pos.set(
    centre.x + Math.sin(a) * 34 * lift,
    (14 + Math.sin(a * 1.7) * 2) * lift,
    centre.z + Math.cos(a) * 26 * lift
  )
  look.set(
    centre.x + Math.sin(a + 0.9) * 8,
    0,
    centre.z + Math.cos(a + 0.9) * 5
  )
}

/*
 * Before the focus the camera circles over the tree, low enough to read it and
 * high enough to see how far back it goes, and it can do that for as long as
 * the room is laughing. On focus it climbs out of the circle and comes down on
 * the target file, the way the film cuts from the overview to the door locks.
 */
function Flight({
  focus,
  still,
  target,
  centre,
}: {
  centre: Vector3
  focus: boolean
  still: boolean
  target: Vector3
}) {
  const camera = useThree((state) => state.camera)
  const started = useRef<number | null>(null)
  const from = useMemo(() => ({ look: new Vector3(), pos: new Vector3() }), [])
  const pos = useMemo(() => new Vector3(), [])
  const look = useMemo(() => new Vector3(), [])
  const endPos = useMemo(
    () => target.clone().add(new Vector3(3.6, 4.4, 8.8)),
    [target]
  )
  const endLook = useMemo(
    () => target.clone().add(new Vector3(-0.4, 0.4, 0)),
    [target]
  )

  useFrame(({ clock }) => {
    const t = clock.elapsedTime

    if (still) {
      if (focus) {
        camera.position.copy(endPos)
        camera.lookAt(endLook)
      } else {
        // A still lands on the circle a few seconds in, past the boot.
        orbit(centre, boot + 6, pos, look)
        camera.position.copy(pos)
        camera.lookAt(look)
      }
      return
    }

    orbit(centre, t, pos, look)

    if (!focus) {
      started.current = null
      camera.position.copy(pos)
      camera.lookAt(look)
      return
    }

    if (started.current === null) {
      started.current = t
      from.pos.copy(camera.position)
      from.look.copy(look)
    }
    const k = ease((t - started.current) / flight)
    camera.position.lerpVectors(from.pos, endPos, k)
    camera.position.y += Math.sin(Math.PI * k) * 6
    look.lerpVectors(from.look, endLook, k)
    camera.lookAt(look)
  })

  return null
}

function TargetLabel({
  colors,
  focus,
  font,
  target,
}: {
  colors: ThemeColors
  focus: boolean
  font: string
  target: Vector3
}) {
  const material = useRef<SpriteMaterial>(null)

  useFrame((_, delta) => {
    if (material.current) {
      const goal = focus ? 1 : 0
      material.current.opacity +=
        (goal - material.current.opacity) * Math.min(1, delta * 3)
    }
  })

  return (
    <Label
      color={colors.signal}
      font={font}
      materialRef={material}
      opacity={0}
      position={[target.x + 0.2, target.y + 2.3, target.z + 0.4]}
      size={0.8}
      text="doors"
    />
  )
}

export function FsnScene({
  className,
  focus = false,
  still = false,
}: {
  className?: string
  focus?: boolean
  still?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const colors = useThemeColors(ref)
  const [font, setFont] = useState<string | null>(null)
  const dirs = useMemo(place, [])
  const target = useMemo(() => {
    for (const dir of dirs) {
      for (const file of dir.files) {
        if (`${dir.path}/${file.name}` === fsnTarget) {
          return new Vector3(...file.position)
        }
      }
    }
    return new Vector3()
  }, [dirs])
  const centre = useMemo(() => {
    const xs = dirs.map((dir) => dir.x)
    const zs = dirs.map((dir) => dir.z)
    return new Vector3(
      (Math.min(...xs) + Math.max(...xs)) / 2,
      0,
      (Math.min(...zs) + Math.max(...zs)) / 2
    )
  }, [dirs])

  // The labels are painted once into textures, so they wait for the theme's
  // face to load rather than freezing the fallback into the scene.
  useEffect(() => {
    const element = ref.current
    if (!element) {
      return
    }
    let live = true
    const family =
      getComputedStyle(element).getPropertyValue("--slide-font-mono").trim() ||
      "monospace"
    document.fonts
      .load(`600 96px ${family}`)
      .catch(() => undefined)
      .then(() => {
        if (live) {
          setFont(family)
        }
      })
    return () => {
      live = false
    }
  }, [])

  return (
    <div className={className} ref={ref}>
      {colors && font ? (
        <Canvas
          camera={{ far: 400, fov: 48, near: 0.1, position: [0, 30, 60] }}
          dpr={[1, 2]}
          gl={{ alpha: true, antialias: true, preserveDrawingBuffer: still }}
          // The deck scales its canvas with a CSS transform, and a bounding
          // rect measures the scaled box. The offset size is the 1920x1080 one.
          resize={{ offsetSize: true }}
        >
          <fog args={[colors.background, 35, 110]} attach="fog" />
          <gridHelper
            args={[260, 104, colors.primary, colors.primary]}
            material-opacity={0.08}
            material-transparent
          />
          <Wires colors={colors} dirs={dirs} />
          <City colors={colors} dirs={dirs} focus={focus} still={still} />
          <Labels colors={colors} dirs={dirs} font={font} />
          <TargetLabel
            colors={colors}
            focus={focus}
            font={font}
            target={target}
          />
          <Flight centre={centre} focus={focus} still={still} target={target} />
        </Canvas>
      ) : null}
    </div>
  )
}

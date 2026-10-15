"use client"

import { type ReactNode, useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import styles from "./terminal.module.css"

export interface TerminalEntry {
  command: string
  rows?: readonly ReactNode[]
}

/*
 * A shell that types. Entry n starts typing once `beat` reaches n, its rows
 * print one after another once the command is in, and the idle prompt with the
 * cursor comes back when the last started entry has finished. `still` skips
 * the typing and prints everything at once, for captures and reduced motion.
 * `idle={false}` leaves the prompt off, for a command that takes the screen
 * over rather than handing it back.
 */
export function Terminal({
  beat,
  className,
  entries,
  idle = true,
  prompt,
  still = false,
}: {
  beat: number
  className?: string
  entries: readonly TerminalEntry[]
  idle?: boolean
  prompt: ReactNode
  still?: boolean
}) {
  const started = Math.min(beat + 1, entries.length)
  const [finished, setFinished] = useState(0)

  return (
    <div
      className={cn(
        "font-mono text-[length:var(--slide-code-size)] leading-[1.5]",
        className
      )}
      data-slide-terminal=""
    >
      {entries.slice(0, started).map((entry, index) => (
        <Entry
          entry={entry}
          // biome-ignore lint/suspicious/noArrayIndexKey: entries are authored in order and never reorder
          key={index}
          onDone={() => setFinished((count) => Math.max(count, index + 1))}
          prompt={prompt}
          still={still}
        />
      ))}
      {idle && finished >= started ? (
        <Prompt prompt={prompt}>
          <span aria-hidden className={styles.cursor} />
        </Prompt>
      ) : null}
    </div>
  )
}

function Prompt({ children, prompt }: { children: ReactNode; prompt: ReactNode }) {
  return (
    <div className="whitespace-pre" data-slide-terminal-prompt="">
      <span className="text-primary" style={{ textShadow: "var(--slide-halo)" }}>
        {prompt}
      </span>{" "}
      <span className="text-foreground">{children}</span>
    </div>
  )
}

// A keystroke lands somewhere between these, so the command reads as typed by
// a person rather than printed by a loop.
const keyMin = 45
const keyJitter = 70
const enterPause = 260
const rowPause = 85

function Entry({
  entry,
  onDone,
  prompt,
  still,
}: {
  entry: TerminalEntry
  onDone: () => void
  prompt: ReactNode
  still: boolean
}) {
  const rows = entry.rows ?? []
  const total = entry.command.length
  const [typed, setTyped] = useState(still ? total : 0)
  const [printed, setPrinted] = useState(still ? rows.length : 0)

  useEffect(() => {
    if (still) {
      setTyped(total)
      setPrinted(rows.length)
      return
    }
    if (typed < total) {
      const timer = window.setTimeout(
        () => setTyped(typed + 1),
        keyMin + Math.random() * keyJitter
      )
      return () => window.clearTimeout(timer)
    }
    if (printed < rows.length) {
      const timer = window.setTimeout(
        () => setPrinted(printed + 1),
        printed === 0 ? enterPause : rowPause
      )
      return () => window.clearTimeout(timer)
    }
  }, [still, typed, printed, total, rows.length])

  const done = typed >= total && printed >= rows.length

  useEffect(() => {
    if (done) {
      onDone()
    }
  }, [done, onDone])

  return (
    <div data-slide-terminal-entry="">
      <Prompt prompt={prompt}>
        {entry.command.slice(0, typed)}
        {typed < total ? <span aria-hidden className={styles.cursor} /> : null}
      </Prompt>
      {rows.slice(0, printed).map((row, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: output rows are authored in order and never reorder
        <div data-slide-terminal-row="" key={index}>
          {row}
        </div>
      ))}
    </div>
  )
}

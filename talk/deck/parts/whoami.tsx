"use client"

import { useBeat, useStill } from "@/deck/parts/beats"
import { Terminal } from "@/deck/parts/terminal"

/*
 * The packages at umbraco.thebuilder.dk, as NuGet listed them on 15 October
 * 2026. ls sorts by name, so this does too. The one the talk is about is
 * marked, and its row lights up once the listing is in.
 */
const packages = [
  {
    about: "OIDC tokens instead of a shared API key",
    name: "TheBuilder.ApiOidc",
    version: "0.2.2",
  },
  {
    about: "translation overrides in the backoffice",
    name: "TheBuilder.AppTranslations",
    version: "0.2.0",
  },
  {
    about: "BlurHash and ThumbHash for Image media",
    name: "TheBuilder.BlurPlaceholder",
    version: "0.2.1",
  },
  {
    about: "your content model as a 3D city",
    name: "TheBuilder.SchemaCity",
    tonight: true,
    version: "0.1.4",
  },
  {
    about: "Vercel and Plausible stats in the backoffice",
    name: "TheBuilder.WebAnalytics",
    version: "0.4.3",
  },
]

// whoami, then ls a moment after the name has landed, then the highlight.
const delays = [2600, 6200]

export function Whoami() {
  const beat = useBeat(delays)
  const still = useStill()
  const lit = beat >= 2

  return (
    <section className="flex h-full w-full flex-col justify-start pt-[7.5rem]">
      <Terminal
        beat={beat}
        entries={[
          {
            command: "whoami",
            rows: [
              <p
                className="py-3 font-bold text-[length:var(--slide-heading-size)] text-foreground uppercase leading-[1.1] tracking-[-0.015em]"
                key="name"
                style={{ textShadow: "var(--slide-halo)" }}
              >
                Daniel Schmidt
              </p>,
              <p className="pb-6 text-muted-foreground" key="links">
                github.com/thebuilder · umbraco.thebuilder.dk
              </p>,
            ],
          },
          {
            command: "ls -l ~/packages",
            rows: [
              <p className="text-muted-foreground" key="total">
                {`total ${packages.length}`}
              </p>,
              ...packages.map((item) => (
                <p
                  className={
                    item.tonight && lit
                      ? "grid grid-cols-[13ch_7ch_28ch_1fr] bg-primary text-primary-foreground transition-colors duration-500"
                      : "grid grid-cols-[13ch_7ch_28ch_1fr] text-foreground transition-colors duration-500"
                  }
                  data-slide-terminal-highlight={
                    item.tonight && lit ? "" : undefined
                  }
                  key={item.name}
                >
                  <span className={item.tonight && lit ? "" : "text-muted-foreground"}>
                    {item.tonight ? "-rwxr-xr-x" : "-rw-r--r--"}
                  </span>
                  <span>{item.version}</span>
                  <span className="font-bold">{item.name}</span>
                  <span className={item.tonight && lit ? "" : "text-muted-foreground"}>
                    {`# ${item.about}`}
                  </span>
                </p>
              )),
            ],
          },
        ]}
        prompt="thebuilder@umbraco-dk:~$"
        still={still}
      />
    </section>
  )
}

import { Placeholder } from "@/deck/parts/placeholder"

export function Whoami() {
  return (
    <Placeholder
      label="whoami"
      shows="A prompt types whoami, then ls ~/packages lists the packages from umbraco.thebuilder.dk."
    />
  )
}

import { HeroSlide } from "@/app/slides/blocks"

export function Close() {
  return (
    <HeroSlide
      description="dotnet add package TheBuilder.SchemaCity"
      eyebrow="Schema City"
      meta={[
        "github.com/thebuilder/umbraco-schema-city",
        "umbraco.thebuilder.dk",
      ]}
      title="Your schema is a city. Go look at it."
    />
  )
}

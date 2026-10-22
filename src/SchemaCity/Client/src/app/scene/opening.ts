import { createContext } from "react";

/**
 * Whether the city opens already built, skipping the boot and the establishing shot. A
 * focus asked for at the start opens already gathered, with the camera on it, rather
 * than gathering and flying in from the whole city. The Relationships tab sets it, because it
 * opens every time a type does and the opening would only delay what it is there to
 * show. A context rather than a prop, so it reaches the scene without passing through
 * the app.
 */
export const OpeningSkipped = createContext(false);

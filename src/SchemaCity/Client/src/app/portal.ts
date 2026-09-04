import { createContext, type RefObject, useContext } from "react";

/**
 * Base UI portals default to document.body, which is outside the shadow root the
 * workspace element renders into, so a portalled popup would land outside our
 * stylesheet and lose every token. Dialog, popover and tooltip read this ref and
 * portal into an element we own instead. A ref, not the element, so the portals
 * do not need a second render once the element exists.
 */
export const PortalContainer =
  createContext<RefObject<HTMLElement | null> | null>(null);

export const usePortalContainer = () => useContext(PortalContainer);

import { createContext, type RefObject, useContext } from "react";

/**
 * Base UI portals default to document.body, which is outside the shadow root the
 * workspace element renders into, so a portalled popup would land outside our
 * stylesheet and lose every token. Dialog, popover and tooltip read this ref and
 * portal into an element we own instead. A ref, not the element, so the portals
 * do not need a second render once the element exists.
 *
 * The anchored popups are positioned fixed. Absolute, they sat in the backoffice's
 * overflow-hidden #main, and the frame before a popup flipped above a bottom-bar
 * trigger made #main scrollable. Focusing an item then scrolled it, and the whole
 * workspace jumped up and back.
 */
export const PortalContainer =
  createContext<RefObject<HTMLElement | null> | null>(null);

export const usePortalContainer = () => useContext(PortalContainer);

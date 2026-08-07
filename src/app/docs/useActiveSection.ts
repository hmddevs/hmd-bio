"use client";

import { useEffect, useState } from "react";

/** Where the "you are here" line sits, in pixels from the top of the viewport. */
const READING_LINE = 96;

/**
 * Tracks which section is currently under the reader and keeps the URL hash in
 * step, so any endpoint can be copied out of the address bar and linked to.
 *
 * The rule is deliberately positional rather than "first intersecting section":
 * sections here are tall and sit flush against one another, so a section that
 * has all but scrolled off the top still intersects any sensible observer band
 * by a pixel or two and wins on document order. Taking the last section whose
 * top has passed the reading line has no such edge.
 *
 * `history.replaceState` is used rather than assigning `location.hash`, which
 * would scroll the page and push a history entry for every section crossed.
 */
export function useActiveSection(ids: string[]): string {
  const [active, setActive] = useState("");

  useEffect(() => {
    if (ids.length === 0) return;

    let frame = 0;

    function measure() {
      frame = 0;

      let current = "";
      for (const id of ids) {
        const element = document.getElementById(id);
        if (!element) continue;

        const { top } = element.getBoundingClientRect();
        if (top <= READING_LINE) current = id;
        else break;
      }

      // Before the first section has reached the reading line, the first one is
      // still what the reader is looking at.
      setActive(current || ids[0]);
    }

    function schedule() {
      if (frame === 0) frame = requestAnimationFrame(measure);
    }

    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);

    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [ids]);

  useEffect(() => {
    if (!active || window.location.hash === `#${active}`) return;
    window.history.replaceState(null, "", `#${active}`);
  }, [active]);

  return active;
}

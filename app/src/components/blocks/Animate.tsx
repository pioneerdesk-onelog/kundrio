"use client";

import { MotionConfig, motion, type Variants } from "motion/react";
import type { ReactNode } from "react";
import type { Animation } from "./types";

// Animationen mit Motion. `MotionConfig reducedMotion="user"` schaltet Bewegungen ab, wenn
// Besucher „Bewegung reduzieren“ eingestellt haben (prefers-reduced-motion); dann bleibt nur Einblenden.

const CONTAINER: Record<Exclude<Animation, "none">, Variants> = {
  subtle: {
    hidden: { opacity: 0, y: 14 },
    show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: "easeOut", staggerChildren: 0.06 } },
  },
  expressive: {
    hidden: { opacity: 0, y: 44, scale: 0.97 },
    show: { opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 110, damping: 18, staggerChildren: 0.12 } },
  },
};

const ITEM: Record<Exclude<Animation, "none">, Variants> = {
  subtle: { hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" } } },
  expressive: { hidden: { opacity: 0, y: 28, rotate: -1 }, show: { opacity: 1, y: 0, rotate: 0, transition: { type: "spring", stiffness: 140, damping: 16 } } },
};

export function MotionRoot({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

type Props = { animation?: Animation; editing?: boolean; className?: string; children: ReactNode; as?: "div" | "section" | "header" | "ul" };

/** Blendet einen Block beim Hineinscrollen ein. Im Editor statisch. */
export function Animate({ animation = "none", editing, className, children, as = "div" }: Props) {
  if (animation === "none" || editing) {
    const Tag = as;
    return <Tag className={className}>{children}</Tag>;
  }
  const M = motion[as];
  return (
    <M data-anim="" className={className} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.15 }} variants={CONTAINER[animation]}>
      {children}
    </M>
  );
}

/** Kind-Element für gestaffeltes Einblenden innerhalb von <Animate>. */
export function AnimateItem({ animation = "none", editing, className, children, as = "div" }: Omit<Props, "as"> & { as?: "div" | "li" }) {
  if (animation === "none" || editing) {
    const Tag = as;
    return <Tag className={className}>{children}</Tag>;
  }
  const M = motion[as];
  return (
    <M data-anim="" className={className} variants={ITEM[animation]}>
      {children}
    </M>
  );
}

/** Button/Link mit Hover-Effekt (nur bei „ausdrucksstark“). */
export function HoverLink({ animation = "none", editing, className, href, children }: { animation?: Animation; editing?: boolean; className?: string; href: string; children: ReactNode }) {
  if (animation !== "expressive" || editing) {
    return <a className={className} href={href}>{children}</a>;
  }
  return (
    <motion.a className={className} href={href} whileHover={{ y: -2, scale: 1.02 }} whileTap={{ scale: 0.98 }} transition={{ type: "spring", stiffness: 300, damping: 20 }}>
      {children}
    </motion.a>
  );
}

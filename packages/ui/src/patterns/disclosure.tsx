import type { ReactNode } from "react"
import { Section } from "./section"

/**
 * An occasional part (고급) folded under the same header as every folding section: a band with a chevron, open at first, and
 * what a person folds stays folded (`persistKey`). One look for folding everywhere; this is `Section collapsible` by another name.
 */
export function Disclosure({ children, label = "고급", persistKey }: { children?: ReactNode; label?: ReactNode; persistKey: string }) {
  return (
    <Section collapsible persistKey={persistKey} title={label}>
      {children}
    </Section>
  )
}

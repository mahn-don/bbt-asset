"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

/**
 * Settings sidebar.
 *
 * Client-side only so it can highlight the active route. On narrow screens it
 * becomes a horizontally scrollable row rather than eating vertical space.
 */
export function SettingsNav({
  groups,
  label,
}: {
  groups: { label: string; items: { href: string; label: string }[] }[];
  label: string;
}) {
  const pathname = usePathname();

  return (
    <nav
      aria-label={label}
      className="shrink-0 lg:w-56 lg:border-r lg:border-line lg:pr-4"
    >
      <div className="flex gap-6 overflow-x-auto pb-2 lg:flex-col lg:gap-5 lg:overflow-visible lg:pb-0">
        {groups.map((group) => (
          <div key={group.label} className="min-w-max lg:min-w-0">
            <p className="type-label mb-1.5">{group.label}</p>
            <ul className="flex gap-1 lg:flex-col">
              {group.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cx(
                        "block whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors",
                        active
                          ? "bg-sidebar-active text-accent-ink"
                          : "text-ink-soft hover:bg-neutral-soft hover:text-ink",
                      )}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}

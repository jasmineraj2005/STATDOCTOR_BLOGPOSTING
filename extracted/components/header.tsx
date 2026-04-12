"use client"

import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"

export default function Header({ logoHref }: { logoHref?: string }) {
  const logoUrl = logoHref ?? "https://statdoctor.app/"
  const isExternal = !logoHref
  const pathname = usePathname()
  const inDashboard = pathname?.startsWith("/dashboard") ?? false

  return (
    <header className="relative z-20 flex items-center justify-between p-6">
      {/* Logo */}
      <a
        href={logoUrl}
        {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        className="flex items-center"
      >
        <Image
          src="/statdoctor-logo.png"
          alt="StatDoctor"
          width={180}
          height={45}
          className="brightness-0 invert"
        />
      </a>

      {/* Navigation — only in dashboard section */}
      <nav className="flex items-center gap-1">
        {inDashboard && (
          <>
            <NavLink href="/dashboard" active={pathname === "/dashboard" || pathname?.startsWith("/dashboard/posts")}>
              Posts
            </NavLink>
            <NavLink href="/dashboard/analytics" active={pathname === "/dashboard/analytics"}>
              Analytics
            </NavLink>
          </>
        )}
      </nav>

      {/* Login Button Group with Arrow */}
      <Link
        href="/login"
        id="gooey-btn"
        className="relative flex items-center group"
        style={{ filter: "url(#gooey-filter)" }}
      >
        <button className="absolute right-0 px-3 py-2.5 rounded-full bg-white text-black font-normal text-sm transition-all duration-300 hover:bg-white/90 cursor-pointer h-11 flex items-center justify-center -translate-x-12 group-hover:-translate-x-22 z-0">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 17L17 7M17 7H7M17 7V17" />
          </svg>
        </button>
        <button className="px-8 py-2.5 rounded-full bg-white text-black font-normal text-sm transition-all duration-300 hover:bg-white/90 cursor-pointer h-11 flex items-center z-10">
          Login
        </button>
      </Link>
    </header>
  )
}

function NavLink({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className={`px-4 py-2 text-sm font-light rounded-full transition-colors duration-200 ${
        active
          ? "text-white bg-white/10 border border-white/20"
          : "text-white/60 hover:text-white/90 hover:bg-white/5"
      }`}
    >
      {children}
    </Link>
  )
}

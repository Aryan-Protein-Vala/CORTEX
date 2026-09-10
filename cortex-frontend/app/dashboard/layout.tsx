'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Network, Search, FileCode2, Moon, Sun, ArrowLeft, BrainCircuit } from 'lucide-react'

function ThemeToggle() {
  const [dark, setDark] = useState(false)
  useEffect(() => { const saved = localStorage.getItem('cortex-theme'); const isDark = saved === 'dark'; setDark(isDark); document.documentElement.classList.toggle('dark', isDark) }, [])
  const toggle = () => { const next = !dark; setDark(next); document.documentElement.classList.toggle('dark', next); localStorage.setItem('cortex-theme', next ? 'dark' : 'light') }
  return <button onClick={toggle} className="icon-button" aria-label={`Switch to ${dark ? 'light' : 'dark'} mode`}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  const navItems = [
    { href: '/dashboard', label: 'Overview', icon: Network },
    { href: '/dashboard/brain', label: '3D Hive Mind', icon: BrainCircuit },
    { href: '/dashboard/docs', label: '</> Developer', icon: FileCode2 },
  ]

  return (
    <div className="dash-shell">
      {/* Vertical Sidebar */}
      <aside className="dash-sidebar">
        <div className="dash-sidebar-top">
          <Link href="/" className="logo" style={{ fontSize: '26px' }}>
            Cortex<span>.</span>
          </Link>
          <p className="mono" style={{ margin: '8px 0 0', opacity: 0.7 }}>// external brain</p>
        </div>

        <nav className="dash-nav">
          <p className="eyebrow" style={{ marginBottom: '16px', color: 'var(--accent)' }}>NAVIGATION / 01</p>
          <Link href="/dashboard" className={`dash-nav-item ${pathname === '/dashboard' ? 'active' : ''}`}>
            <Network size={18} />
            Overview
          </Link>

          <Link href="/dashboard/brain" className={`dash-nav-item ${pathname === '/dashboard/brain' ? 'active' : ''}`}>
            <BrainCircuit size={18} />
            3D Hive Mind
          </Link>

          <Link href="/dashboard/docs" className={`dash-nav-item ${pathname === '/dashboard/docs' ? 'active' : ''}`}>
            <FileCode2 size={18} />
            Developer
          </Link>
        </nav>

        <div className="dash-sidebar-bottom">
          <ThemeToggle />
          <Link href="/" className="icon-button" style={{ marginLeft: '12px' }}>
            <ArrowLeft size={18} />
          </Link>
        </div>
      </aside>

      {/* Main Content */}
      <main className="dash-main">
        {children}
      </main>

    </div>
  )
}

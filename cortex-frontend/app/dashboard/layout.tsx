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
          {navItems.map(item => {
            const isActive = pathname === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`dash-nav-item ${isActive ? 'active' : ''}`}
              >
                <item.icon size={18} />
                <span>{item.label}</span>
              </Link>
            )
          })}
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

      <style jsx>{`
        .dash-shell {
          display: flex;
          min-height: 100vh;
          background: var(--background);
          color: var(--foreground);
        }
        .dash-sidebar {
          width: 260px;
          min-height: 100vh;
          padding: 32px 24px;
          border-right: 1px solid var(--border);
          background: var(--surface);
          display: flex;
          flex-direction: column;
          position: sticky;
          top: 0;
          height: 100vh;
        }
        .dash-sidebar-top { margin-bottom: 50px; }
        
        .dash-nav {
          display: flex;
          flex-direction: column;
          gap: 16px;
          flex: 1;
        }
        .dash-nav-item {
          display: flex;
          align-items: center;
          gap: 12px;
          height: 56px;
          padding: 0 20px;
          border-radius: 12px;
          font-size: 14px;
          font-weight: 700;
          color: var(--secondary);
          text-decoration: none;
          background: transparent;
          border: 1px solid var(--border);
          transition: transform .2s, box-shadow .2s, background .2s, color .2s;
        }
        .dash-nav-item:hover {
          color: var(--foreground);
          background: var(--surface);
          transform: translateY(-2px);
          box-shadow: 0 10px 25px rgba(0,0,0,0.05);
        }
        .dash-nav-item.active {
          background: var(--accent);
          border-color: var(--accent);
          color: var(--accent-contrast);
        }
        .dash-nav-item.active:hover {
          box-shadow: 0 10px 25px color-mix(in srgb, var(--accent) 24%, transparent);
        }
        .dash-sidebar-bottom {
          display: flex;
          align-items: center;
          padding-top: 24px;
          border-top: 1px solid var(--border);
        }
        
        .dash-main {
          flex: 1;
          min-height: 100vh;
          overflow-y: auto;
          position: relative;
        }
        @media (max-width: 768px) {
          .dash-sidebar { width: 80px; padding: 24px 12px; }
          .logo span:last-child { display: none; }
          .logo { font-size: 18px !important; }
          .dash-sidebar-top .mono, .dash-nav-item span, .dash-nav .eyebrow { display: none; }
          .dash-nav-item { justify-content: center; padding: 14px; }
          .dash-nav-item:hover { transform: none; }
        }
      `}</style>
    </div>
  )
}

'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Brain, BarChart3, Code2, Zap, Moon, Sun, ArrowLeft } from 'lucide-react'

function ThemeToggle() {
  const [dark, setDark] = useState(false)
  useEffect(() => { const saved = localStorage.getItem('cortex-theme'); const isDark = saved === 'dark'; setDark(isDark); document.documentElement.classList.toggle('dark', isDark) }, [])
  const toggle = () => { const next = !dark; setDark(next); document.documentElement.classList.toggle('dark', next); localStorage.setItem('cortex-theme', next ? 'dark' : 'light') }
  return <button onClick={toggle} className="sidebar-btn" aria-label={`Switch to ${dark ? 'light' : 'dark'} mode`}>{dark ? <Sun size={16} /> : <Moon size={16} />}</button>
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  const navItems = [
    { href: '/dashboard', label: 'Overview', icon: BarChart3, emoji: '📊' },
    { href: '/dashboard/brain', label: 'Neural Network', icon: Brain, emoji: '🧠' },
    { href: '/dashboard/docs', label: '</> Dev Docs', icon: Code2, emoji: '⚡' },
  ]

  return (
    <div className="dash-shell">
      {/* Vertical Sidebar */}
      <aside className="dash-sidebar">
        <div className="dash-sidebar-top">
          <Link href="/" className="dash-logo">
            <Zap size={20} className="dash-logo-icon" />
            <span>CORTEX</span>
          </Link>
          <p className="dash-logo-tag">your ai&apos;s external brain</p>
        </div>

        <nav className="dash-nav">
          {navItems.map(item => {
            const isActive = pathname === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`dash-nav-item ${isActive ? 'active' : ''}`}
              >
                <item.icon size={16} />
                <span>{item.label}</span>
              </Link>
            )
          })}
        </nav>

        <div className="dash-sidebar-bottom">
          <ThemeToggle />
          <Link href="/" className="sidebar-btn">
            <ArrowLeft size={16} />
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
          width: 220px;
          min-height: 100vh;
          padding: 24px 16px;
          border-right: 1px solid var(--border);
          background: var(--surface);
          display: flex;
          flex-direction: column;
          position: sticky;
          top: 0;
          height: 100vh;
        }
        .dash-sidebar-top { margin-bottom: 36px; }
        .dash-logo {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 18px;
          font-weight: 800;
          letter-spacing: -.06em;
          text-decoration: none;
          color: var(--foreground);
        }
        .dash-logo-icon { color: var(--accent); }
        .dash-logo-tag {
          margin: 4px 0 0;
          font: 10px monospace;
          letter-spacing: .08em;
          color: var(--secondary);
        }
        .dash-nav {
          display: flex;
          flex-direction: column;
          gap: 4px;
          flex: 1;
        }
        .dash-nav-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 12px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 500;
          color: var(--secondary);
          text-decoration: none;
          transition: all .2s;
        }
        .dash-nav-item:hover {
          background: var(--muted);
          color: var(--foreground);
        }
        .dash-nav-item.active {
          background: var(--accent);
          color: var(--accent-contrast);
          font-weight: 700;
        }
        .dash-sidebar-bottom {
          display: flex;
          align-items: center;
          gap: 8px;
          padding-top: 16px;
          border-top: 1px solid var(--border);
        }
        :global(.sidebar-btn) {
          display: grid;
          place-items: center;
          width: 36px;
          height: 36px;
          border-radius: 8px;
          border: 1px solid var(--border);
          background: var(--surface);
          color: var(--secondary);
          cursor: pointer;
          transition: all .2s;
        }
        :global(.sidebar-btn:hover) {
          color: var(--foreground);
          border-color: var(--accent);
        }
        .dash-main {
          flex: 1;
          min-height: 100vh;
          overflow-y: auto;
        }
        @media (max-width: 768px) {
          .dash-sidebar { width: 60px; padding: 16px 8px; }
          .dash-logo span, .dash-logo-tag, .dash-nav-item span { display: none; }
          .dash-nav-item { justify-content: center; padding: 10px; }
        }
      `}</style>
    </div>
  )
}

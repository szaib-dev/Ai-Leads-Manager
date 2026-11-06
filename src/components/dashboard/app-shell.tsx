"use client";
import { FaWhatsapp } from "react-icons/fa";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { CountryFolders } from "@/components/leads/country-folders";
import Link from "next/link";
import { SyncIndicator } from "@/components/shared/sync-indicator";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useState, type ReactNode } from "react";
import {
  Archive,
  CalendarClock,
  ChartNoAxesCombined,
  ChevronDown,
  ChevronRight,
  Folder,
  History,
  LayoutDashboard,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PhoneMissed,
  Sparkles,
  Settings2,
  Sun,
  Waves,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWorkspace } from "@/components/providers";
import { ApplicationSettings } from "./settings";
import { SignOutItem } from "@/components/auth/sign-out-item";
const nav = [
  { href: "/dash", label: "Overview", icon: LayoutDashboard },
  { href: "/dash/pages", label: "Lead pages", icon: Folder },
  { href: "/dash/whatsapp", label: "WhatsApp Conversations", icon: FaWhatsapp },
  { href: "/dash/attempts", label: "Attempts", icon: PhoneMissed },
  { href: "/dash/followups", label: "Follow-ups", icon: CalendarClock },
  { href: "/dash/callbacks", label: "Awaiting Callbacks", icon: CalendarClock },
  { href: "/dash/activity", label: "Activity", icon: History },
  { href: "/dash/archive", label: "Archive", icon: Archive },
  { href: "/dash/ai", label: "AI workspace", icon: Sparkles },
];
export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { theme, setTheme } = useTheme();
  const { pages } = useWorkspace();
  const [foldersOpen,setFoldersOpen]=useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const router = useRouter();
  const isAi = path === "/dash/ai";
  function openAssistant() {
    const activePage = pages.find((p) => path === `/dash/pages/${p.id}`);
    router.push(activePage ? `/dash/ai?page=${activePage.id}` : "/dash/ai");
  }
  const current = nav.find((n) => n.href === path) ?? nav.find(n=>n.href === "/dash/pages")!;
  const page = pages.find((p) => path === `/dash/pages/${p.id}`);
  const followups = pages.reduce(
    (total, page) => total + page.followupCount,
    0,
  );
  return (
    <div className={`app-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar">
        <Link href="/dash" className="brand" aria-label="Folio overview">
          <span className="brand-mark">
            <Waves size={23} strokeWidth={2.5} />
          </span>
          <span className="brand-name">
            folio<span>.</span>
          </span>
        </Link>
        <div className="workspace-label">
          <span className="workspace-avatar">S</span>
          <div>
            <strong>My workspace</strong>
            <span>Personal workspace</span>
          </div>
          <ChevronDown size={15} />
        </div>
        <div className="nav-caption">WORKSPACE</div>
        <nav aria-label="Main navigation" className="main-nav">
          {nav.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              title={label}
              aria-label={label}
              aria-current={
                ((href === "/dash" ? path === href : path.startsWith(href)) || (href === "/dash/pages" && path.startsWith("/dash/countries/")))
                  ? "page"
                  : undefined
              }
              className={`nav-item ${((href === "/dash" ? path === href : path.startsWith(href)) || (href === "/dash/pages" && path.startsWith("/dash/countries/"))) ? "active" : ""}`}
            >
              <Icon size={19} />
              <span>{label}</span>
              {label === "Follow-ups" && followups > 0 && (
                <small>{followups}</small>
              )}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="profile"
                style={{ width: "100%", textAlign: "left" }}
                aria-label="Account menu"
              >
                <span className="profile-avatar">SB</span>
                <div>
                  <strong>Personal account</strong>
                  <span>Private workspace</span>
                </div>
                <span className="online-dot" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top">
              <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>
                <Settings2 size={16} />
                Settings
              </DropdownMenuItem>
              <SignOutItem />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
      <div className="main-shell">
        {!isAi && (
          <header className="topbar">
            <div className="breadcrumb">
              <Button
                variant="ghost"
                size="icon"
                className="collapse-button"
                onClick={() => setCollapsed(!collapsed)}
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                {collapsed ? (
                  <PanelLeftOpen size={18} />
                ) : (
                  <PanelLeftClose size={18} />
                )}
              </Button>
              <Link
                href="/dash"
                className="mobile-brand"
                aria-label="Folio overview"
              >
                <Waves size={23} />
              </Link>
              <span className="breadcrumb-root">Workspace</span>
              <ChevronRight size={13} />
              <span className="breadcrumb-current">
                <span className="desktop-nav-label">{current.label}</span>
                <span className="mobile-nav-label">{current.href === "/dash/whatsapp" ? "WhatsApp" : current.label}</span>
              </span>
              {page && (
                <>
                  <ChevronRight size={13} />
                  <span className="breadcrumb-page">{page.name}</span>
                </>
              )}
            </div>
            <div className="topbar-actions">
              <SyncIndicator />
              <Button
                variant="ghost"
                size="icon"
                aria-label="Application settings"
                onClick={() => setSettingsOpen(true)}
              >
                <Settings2 size={18} />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Choose theme">
                    <Sun size={18} className="light-theme-icon" />
                    <Moon size={18} className="dark-theme-icon" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {[
                    { value: "light", label: "Light", icon: Sun },
                    { value: "dark", label: "Dark", icon: Moon },
                    { value: "system", label: "System", icon: Monitor },
                  ].map(({ value, label, icon: Icon }) => (
                    <DropdownMenuItem
                      key={value}
                      onSelect={() => setTheme(value)}
                    >
                      <Icon size={16} />
                      {label}
                      <span className="menu-check">
                        {theme === value ? "✓" : ""}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                variant="outline"
                className="header-ai"
                onClick={() => openAssistant()}
              >
                <Sparkles size={15} />
                AI assistant
              </Button>
              <span className="header-avatar">SB</span>
            </div>
          </header>
        )}
        <main
          id="main-content"
          className={isAi ? "main-content ai-main-content" : "main-content"}
        >
          {children}
          {!isAi && (
            <footer className="content-footer">
              <span>
                <span className="online-dot" />A little more organized. A little
                more connected.
              </span>
              <span>Supabase · Live workspace · Phase 05</span>
            </footer>
          )}
        </main>
      </div>
      <nav className="bottom-nav" aria-label="Mobile navigation">
        {nav.slice(0, 4).map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={
              ((href === "/dash" ? path === href : path.startsWith(href)) || (href === "/dash/pages" && path.startsWith("/dash/countries/")))
                ? "page"
                : undefined
            }
          >
            <Icon size={21} />
            <span>{href === "/dash/whatsapp" ? "WhatsApp" : label === "Lead pages" ? "Leads" : label}</span>
          </Link>
        ))}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="More navigation"
              className={
                path === "/dash/activity" || path === "/dash/archive"
                  ? "more-active"
                  : ""
              }
            >
              <ChartNoAxesCombined size={21} />
              <span>More</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top">
            <DropdownMenuItem onSelect={()=>setFoldersOpen(true)}><Folder size={16}/>Country folders</DropdownMenuItem>
            <DropdownMenuItem asChild><Link href="/dash/callbacks"><CalendarClock size={16} />Awaiting Callbacks</Link></DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/dash/activity">
                <History size={16} />
                Activity
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/dash/archive">
                <Archive size={16} />
                Archive
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openAssistant()}>
              <Sparkles size={16} />
              AI assistant
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>
              <Settings2 size={16} />
              Settings
            </DropdownMenuItem>
            <SignOutItem />
          </DropdownMenuContent>
        </DropdownMenu>
      </nav>
      <Dialog open={foldersOpen} onOpenChange={setFoldersOpen}><DialogContent onClick={event=>{if((event.target as Element).closest("a"))setFoldersOpen(false);}}><DialogTitle>Lead Pages</DialogTitle><DialogDescription>Countries and their lead pages.</DialogDescription><CountryFolders/></DialogContent></Dialog>
      <ApplicationSettings open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
